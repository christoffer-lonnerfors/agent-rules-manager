import * as vscode from 'vscode';
import * as path from 'path';
import { LogicalRule, RuleFormat, FORMAT_LABELS } from '../scanner/scannerTypes';
import { FORMAT_CONFIGS } from '../scanner/formatDetector';
import { RuleIssue } from './ruleIssues';
import { estimateTokens, formatTokenCount } from './tokenEstimator';

/** Lookup: format → expected extensions (derived from FORMAT_CONFIGS) */
const FORMAT_EXTENSIONS = new Map<RuleFormat, string[]>(
  FORMAT_CONFIGS.map(c => [c.format, c.extensions]),
);

/**
 * Configuration that controls which checks run and their thresholds.
 * Passed in so the function stays pure (no vscode.workspace dependency).
 */
export interface IssueComputerConfig {
  /** User's chosen primary format, or '' if none */
  primaryFormat: RuleFormat | '';
  /** Whether divergence detection is enabled */
  detectDivergence: boolean;
  /** Whether lint checks are enabled */
  lintEnabled: boolean;
  /** Token threshold for the rule-too-large check */
  maxRuleTokens: number;
}

/**
 * Compute all issues for a single logical rule.
 *
 * This is the single entry point that replaces the scattered ad-hoc checks
 * in the tree provider. New checks are added here as additional functions.
 */
export async function computeIssues(
  logicalRule: LogicalRule,
  config: IssueComputerConfig,
): Promise<RuleIssue[]> {
  const issues: RuleIssue[] = [];

  // Structural checks (always run)
  checkDivergedContent(logicalRule, config, issues);
  checkMissingPrimary(logicalRule, config, issues);
  checkExtensionMismatch(logicalRule, issues);

  // Lint checks (gated by config)
  if (config.lintEnabled) {
    checkEmptyBody(logicalRule, issues);
    checkMissingDescription(logicalRule, issues);
    checkRuleTooLarge(logicalRule, config, issues);
    await checkBrokenReferences(logicalRule, issues);
  }

  return issues;
}

// ── Individual checks ─────────────────────────────────────────────────

function checkDivergedContent(
  lr: LogicalRule,
  config: IssueComputerConfig,
  issues: RuleIssue[],
): void {
  if (!config.detectDivergence) { return; }
  if (lr.rules.length < 2) { return; }
  if (lr.minSimilarity >= 1.0) { return; }

  const pct = (lr.minSimilarity * 100).toFixed(0);
  issues.push({
    id: 'diverged-content',
    severity: 'warning',
    message: `Content diverged across formats — similarity: ${pct}%`,
  });
}

function checkMissingPrimary(
  lr: LogicalRule,
  config: IssueComputerConfig,
  issues: RuleIssue[],
): void {
  if (!config.primaryFormat) { return; }
  if (lr.formats.includes(config.primaryFormat as RuleFormat)) { return; }

  const label = FORMAT_LABELS[config.primaryFormat as RuleFormat];
  issues.push({
    id: 'missing-primary',
    severity: 'info',
    message: `Missing from ${label}`,
  });
}

function checkExtensionMismatch(
  lr: LogicalRule,
  issues: RuleIssue[],
): void {
  for (const rule of lr.rules) {
    if (rule.extensionMismatch) {
      const expected = (FORMAT_EXTENSIONS.get(rule.format) ?? ['.md']).join(' / ');
      issues.push({
        id: 'extension-mismatch',
        severity: 'warning',
        message: `Wrong file extension — ${FORMAT_LABELS[rule.format]} expects ${expected}`,
        ruleId: rule.id,
      });
    }
  }
}

// ── Lint checks ──────────────────────────────────────────────────────

function checkEmptyBody(
  lr: LogicalRule,
  issues: RuleIssue[],
): void {
  for (const rule of lr.rules) {
    if (rule.bodyLength < 10) {
      issues.push({
        id: 'empty-body',
        severity: 'warning',
        message: `Rule body is empty or near-empty (${rule.bodyLength} chars)`,
        ruleId: rule.id,
      });
    }
  }
}

const MIN_DESCRIPTION_LENGTH = 10;

function checkMissingDescription(
  lr: LogicalRule,
  issues: RuleIssue[],
): void {
  // Only relevant for agent_requested rules — the description is the
  // only signal agents use to decide whether to attach the rule.
  if (lr.trigger !== 'agent_requested') { return; }

  const desc = lr.description?.trim() ?? '';
  if (desc.length === 0) {
    issues.push({
      id: 'missing-description',
      severity: 'warning',
      message: 'Agent-requested rule has no description — agents cannot discover it',
    });
  } else if (desc.length < MIN_DESCRIPTION_LENGTH) {
    issues.push({
      id: 'missing-description',
      severity: 'warning',
      message: `Description is too short (${desc.length} chars) — agents need a clear description to decide when to use this rule`,
    });
  }
}

function checkRuleTooLarge(
  lr: LogicalRule,
  config: IssueComputerConfig,
  issues: RuleIssue[],
): void {
  for (const rule of lr.rules) {
    const tokens = estimateTokens(rule.bodyLength);
    if (tokens > config.maxRuleTokens) {
      issues.push({
        id: 'rule-too-large',
        severity: 'warning',
        message: `Rule body is large (${formatTokenCount(tokens)}) — consider splitting`,
        ruleId: rule.id,
      });
    }
  }
}

async function checkBrokenReferences(
  lr: LogicalRule,
  issues: RuleIssue[],
): Promise<void> {
  for (const rule of lr.rules) {
    if (rule.references.length === 0) { continue; }
    const ruleDir = path.dirname(rule.filePath);
    for (const ref of rule.references) {
      const resolved = path.resolve(ruleDir, ref);
      const exists = await fileExists(vscode.Uri.file(resolved));
      if (!exists) {
        issues.push({
          id: 'broken-reference',
          severity: 'warning',
          message: `Referenced file not found: ${ref}`,
          ruleId: rule.id,
        });
      }
    }
  }
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Check whether a list of issues contains a specific issue ID */
export function hasIssue(issues: RuleIssue[], id: RuleIssue['id']): boolean {
  return issues.some(i => i.id === id);
}

/** Get the highest severity present in a list of issues */
export function maxSeverity(issues: RuleIssue[]): RuleIssue['severity'] | undefined {
  if (issues.length === 0) { return undefined; }
  if (issues.some(i => i.severity === 'error')) { return 'error'; }
  if (issues.some(i => i.severity === 'warning')) { return 'warning'; }
  return 'info';
}

/** Issues that apply to the logical rule as a whole (no ruleId) */
export function getLogicalIssues(issues: RuleIssue[]): RuleIssue[] {
  return issues.filter(i => !i.ruleId);
}

/** Issues that apply to a specific file (has ruleId) */
export function getFileIssues(issues: RuleIssue[], ruleId: string): RuleIssue[] {
  return issues.filter(i => i.ruleId === ruleId);
}

/**
 * De-duplicate file-level issues for display on the logical rule node.
 * When multiple files produce the same issue (same id + message), show
 * it once. Different messages under the same id are preserved (e.g.
 * broken references to different files).
 */
export function dedupeFileIssues(issues: RuleIssue[]): RuleIssue[] {
  const fileIssues = issues.filter(i => i.ruleId);
  const seen = new Map<string, RuleIssue>();
  for (const issue of fileIssues) {
    const key = `${issue.id}::${issue.message}`;
    if (!seen.has(key)) {
      seen.set(key, { ...issue, ruleId: undefined });
    }
  }
  return Array.from(seen.values());
}

