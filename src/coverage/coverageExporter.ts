import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CoverageModel, CoverageState, CoverageTreeNode } from './coverageModel';
import { RuleStore } from '../logical/ruleStore';
import { AgentId, getAgentDefinition } from '../agents/agentRegistry';

export const DEFAULT_COVERAGE_RELATIVE = '.agent-rules/coverage.json';

// ── Export types ──────────────────────────────────────────────────────────

interface ExportRule {
  name: string;
  tokens: number;
  matchCount: number;
  path: string;
  trigger: 'always' | 'glob' | 'agent_requested';
  globs?: string[];
}

/**
 * A unique combination of rules that co-apply to one or more workspace files.
 * Files sharing the same rule set are grouped into one profile.
 * Sorted by tokens descending — highest-cost profiles first.
 */
interface ExportProfile {
  /** Total token cost for any file in this profile: baseline + all matched glob rules */
  tokens: number;
  /** Rule IDs that apply to every file in this profile (always-on first, then glob-matched) */
  rules: string[];
  /** Number of workspace files with exactly this rule combination */
  count: number;
  /** Paths of all files with this rule combination */
  paths: string[];
}

// ── Analysis result ───────────────────────────────────────────────────────

/** Shared result of running coverage analysis — consumed by exporter and LM tool */
export interface AnalysisResult {
  state: CoverageState;
  model: CoverageModel;
  workspaceRoot: string;
  agentLabel: string;
}

/** Run coverage analysis against the current rule index and workspace files.
 * @param agentIdOverride - When provided, overrides the agent setting from VS Code config.
 */
export async function runAnalysis(
  ruleIndex: RuleStore,
  agentIdOverride?: AgentId,
): Promise<AnalysisResult | undefined> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) return undefined;
  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  const cfg = vscode.workspace.getConfiguration('agentRules');
  const configAgentId = cfg.get<string>('agent', '') as AgentId | '';
  const effectiveAgentId = agentIdOverride ?? (configAgentId || undefined);
  const contextWindowTokens = cfg.get<number>('coverage.contextWindowTokens', 128000);
  const agentLabel = effectiveAgentId ? getAgentDefinition(effectiveAgentId).label : '(all agents)';

  const model = new CoverageModel();
  model.rebuild(ruleIndex.getAll(), effectiveAgentId);

  const uris = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
  const relativePaths = uris
    .map((u) =>
      u.fsPath
        .substring(workspaceRoot.length + 1)
        .split('\\')
        .join('/'),
    )
    .filter((p) => p.length > 0)
    .sort();

  const state = model.buildTree(relativePaths, contextWindowTokens, agentLabel);
  return { state, model, workspaceRoot, agentLabel };
}

// ── JSON builder ──────────────────────────────────────────────────────────

/** Build the compact coverage JSON — rules defined once, files grouped into profiles by rule combination. */
export function buildCoverageJson(result: AnalysisResult): string {
  const { state, model, agentLabel } = result;
  const { summary } = state;

  // ── Step 1: Assign stable IDs to every rule ──────────────────────────────
  const ruleIdMap = new Map<string, string>(); // rule filePath → ID
  const rulesObj: Record<string, ExportRule> = {};
  let counter = 0;

  const ensureId = (filePath: string): string => {
    if (!ruleIdMap.has(filePath)) ruleIdMap.set(filePath, `r${counter++}`);
    return ruleIdMap.get(filePath)!;
  };

  for (const r of model.getBaselineSummary().rules) {
    const id = ensureId(r.filePath);
    rulesObj[id] = {
      name: r.name,
      tokens: r.tokens,
      matchCount: 0,
      path: r.filePath,
      trigger: 'always',
    };
  }

  const seenGlob = new Set<string>();
  for (const node of collectFileNodes(state.tree)) {
    if (!node.coverage) continue;
    for (const r of node.coverage.globRules) {
      if (!seenGlob.has(r.filePath)) {
        seenGlob.add(r.filePath);
        const id = ensureId(r.filePath);
        rulesObj[id] = {
          name: r.name,
          tokens: r.tokens,
          matchCount: 0,
          path: r.filePath,
          trigger: 'glob',
          globs: r.globs,
        };
      }
    }
  }

  for (const r of model.getPotentialSummary().rules) {
    const id = ensureId(r.filePath);
    rulesObj[id] = {
      name: r.name,
      tokens: r.tokens,
      matchCount: 0,
      path: r.filePath,
      trigger: 'agent_requested',
    };
  }

  // ── Step 2: Collect per-file rule sets and compute matchCount per rule ────
  // Build a flat list first (tokens desc) so profiles inherit that ordering
  const flatFiles = collectFileNodes(state.tree)
    .filter((n) => n.coverage !== undefined)
    .map((node) => {
      const cov = node.coverage!;
      const ruleIds = [
        ...cov.alwaysRules
          .map((r) => ruleIdMap.get(r.filePath))
          .filter((id): id is string => id !== undefined),
        ...cov.globRules
          .map((r) => ruleIdMap.get(r.filePath))
          .filter((id): id is string => id !== undefined),
      ];
      return { path: node.path, tokens: node.tokens, rules: ruleIds };
    })
    .sort((a, b) => b.tokens - a.tokens);

  for (const file of flatFiles) {
    for (const ruleId of file.rules) {
      const rule = rulesObj[ruleId];
      if (rule) rule.matchCount += 1;
    }
  }

  // ── Step 3: Sort rules — highest (tokens × matchCount) first ─────────────
  const sortedRulesObj: Record<string, ExportRule> = Object.fromEntries(
    Object.entries(rulesObj).sort(
      ([, a], [, b]) => b.tokens * b.matchCount - a.tokens * a.matchCount,
    ),
  );

  // ── Step 4: Group files into profiles by unique rule combination ──────────
  // Key uses sorted IDs for stability; display order preserved from flatFiles
  const profileMap = new Map<string, ExportProfile>();

  for (const file of flatFiles) {
    const key = [...file.rules].sort().join('\0');
    if (!profileMap.has(key)) {
      profileMap.set(key, { tokens: file.tokens, rules: file.rules, count: 0, paths: [] });
    }
    const profile = profileMap.get(key)!;
    profile.count += 1;
    profile.paths.push(file.path);
  }

  const profiles = Array.from(profileMap.values()).sort((a, b) => b.tokens - a.tokens);
  const totalFiles = flatFiles.length;

  // ── Step 5: Generate plain-language summary ──────────────────────────────
  const summaryText = buildSummary(sortedRulesObj, profiles, totalFiles, summary);

  // ── Step 6: Serialize with mixed density ─────────────────────────────────
  const metaObj = {
    generated: new Date().toISOString(),
    agent: agentLabel,
    contextWindow: summary.contextWindowTokens,
    baseline: { tokens: summary.baselineTokens, ruleCount: summary.baselineRuleCount },
    potential: { tokens: summary.potentialTokens, ruleCount: summary.potentialRuleCount },
    hottestFile: summary.hottestFile,
    agentIntegration: {
      outputPath: DEFAULT_COVERAGE_RELATIVE,
      refreshCommand: 'code --reuse-window --command agentRules.exportCoverageDefault',
    },
  };

  const metaJson = indentAfterFirst(JSON.stringify(metaObj, null, 2), 2);

  const rulesLines = Object.entries(sortedRulesObj)
    .map(([id, rule]) => `    ${JSON.stringify(id)}: ${JSON.stringify(rule)}`)
    .join(',\n');

  const profilesLines = profiles.map((p) => `    ${JSON.stringify(p)}`).join(',\n');

  return (
    `{\n` +
    `  "summary": ${JSON.stringify(summaryText)},\n` +
    `  "meta": ${metaJson},\n` +
    `  "rules": {\n${rulesLines}\n  },\n` +
    `  "fileProfiles": [\n${profilesLines}\n  ]\n` +
    `}`
  );
}

// ── Export commands ───────────────────────────────────────────────────────

/** Export coverage report via save dialog (user-facing command). */
export async function exportCoverageToFile(ruleIndex: RuleStore): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showWarningMessage('Agent Rules: Open a workspace folder first.');
    return;
  }
  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  const result = await runAnalysis(ruleIndex);
  if (!result) {
    vscode.window.showWarningMessage('Agent Rules: Open a workspace folder first.');
    return;
  }

  const defaultUri = vscode.Uri.file(path.join(workspaceRoot, DEFAULT_COVERAGE_RELATIVE));
  const saveUri = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { JSON: ['json'] },
    title: 'Export Coverage Report',
  });
  if (!saveUri) return;

  const json = buildCoverageJson(result);
  fs.mkdirSync(path.dirname(saveUri.fsPath), { recursive: true });
  fs.writeFileSync(saveUri.fsPath, json, 'utf-8');
  await vscode.window.showTextDocument(saveUri);
}

/** Export coverage report to the default path silently (agent / code --command use). */
export async function exportCoverageToDefault(ruleIndex: RuleStore): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) return;
  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  const result = await runAnalysis(ruleIndex);
  if (!result) return;

  const outputPath = path.join(workspaceRoot, DEFAULT_COVERAGE_RELATIVE);
  const json = buildCoverageJson(result);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, json, 'utf-8');
}

// ── Helpers ───────────────────────────────────────────────────────────────

function buildSummary(
  rules: Record<string, ExportRule>,
  profiles: ExportProfile[],
  totalFiles: number,
  summary: CoverageState['summary'],
): string {
  const entries = Object.entries(rules);
  const alwaysCount = entries.filter(([, r]) => r.trigger === 'always').length;
  const globCount = entries.filter(([, r]) => r.trigger === 'glob').length;
  const agentCount = entries.filter(([, r]) => r.trigger === 'agent_requested').length;

  const parts: string[] = [
    `${entries.length} rules: ${alwaysCount} always-on, ${globCount} glob-scoped, ${agentCount} agent-requested. ` +
      `${totalFiles} workspace files across ${profiles.length} coverage profiles. ` +
      `Baseline: ${summary.baselineTokens} tokens on every request.`,
  ];

  // Top rule by tokens × matchCount
  const [topId, topRule] = entries[0] ?? [];
  if (topId && topRule && topRule.matchCount > 0) {
    parts.push(
      `Highest impact: "${topRule.name}" (${topId}) — ${topRule.tokens} tokens × ${topRule.matchCount} files.`,
    );
  }

  // Largest rules by token size (top 3, only those with matches)
  const bySize = entries
    .filter(([, r]) => r.matchCount > 0)
    .sort(([, a], [, b]) => b.tokens - a.tokens)
    .slice(0, 3);
  if (bySize.length > 0) {
    const names = bySize.map(([id, r]) => `"${r.name}" (${id}, ${r.tokens}t)`).join(', ');
    parts.push(`Largest rules: ${names}.`);
  }

  // Broad-scope glob rules (match > 25% of files)
  const broad = entries
    .filter(([, r]) => r.trigger === 'glob' && totalFiles > 0 && r.matchCount / totalFiles > 0.25)
    .slice(0, 3);
  if (broad.length > 0) {
    const names = broad
      .map(
        ([id, r]) =>
          `"${r.name}" (${id}, ${r.matchCount}/${totalFiles} files, globs: ${r.globs?.join(', ')})`,
      )
      .join('; ');
    parts.push(`Broad-scope rules (>25% of files): ${names}.`);
  }

  // Hottest profile
  const hotProfile = profiles[0];
  if (hotProfile && hotProfile.tokens > summary.baselineTokens) {
    const extra = hotProfile.tokens - summary.baselineTokens;
    parts.push(
      `Hottest profile: ${hotProfile.tokens} tokens/file (${extra} above baseline), ` +
        `rules [${hotProfile.rules.join(', ')}], ${hotProfile.count} files.`,
    );
  }

  return parts.join(' ');
}

function indentAfterFirst(json: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return json
    .split('\n')
    .map((line, i) => (i === 0 ? line : pad + line))
    .join('\n');
}

function collectFileNodes(node: CoverageTreeNode): CoverageTreeNode[] {
  if (!node.isDirectory) return [node];
  return node.children.flatMap(collectFileNodes);
}
