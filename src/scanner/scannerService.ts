import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { IndexedRule, CandidateFile, RuleTrigger } from '../types';
import { discoverFiles, discoverCandidates } from './fileDiscovery';
import { parseFrontmatter, extractFirstHeading } from './frontmatterParser';
import { normalizeTrigger } from './triggerNormalizer';
import { extractReferences, extractDiscoveryReferences } from './referenceExtractor';
import { computeMinHash } from '../hashing/minHasher';
import { RuleIndex, generateRuleId } from '../index/ruleIndex';
import { CandidateStore } from './candidateStore';
import { mapWithConcurrency } from '../utils/concurrency';

/** Maximum depth for recursive reference resolution */
const MAX_REFERENCE_DEPTH = 10;

/**
 * Orchestrates workspace scanning: discovers files, parses frontmatter,
 * normalizes triggers, computes MinHash signatures, and populates the index.
 */
export class ScannerService {
  private _onScanStarted = new vscode.EventEmitter<void>();
  private _onScanCompleted = new vscode.EventEmitter<{ count: number; durationMs: number }>();
  readonly onScanStarted = this._onScanStarted.event;
  readonly onScanCompleted = this._onScanCompleted.event;

  private scanning = false;

  constructor(
    private readonly ruleIndex: RuleIndex,
    private readonly candidateStore: CandidateStore,
  ) {}

  get isScanning(): boolean {
    return this.scanning;
  }

  /**
   * Run a full workspace scan. Discovers all rule files, parses them,
   * and replaces the current index.
   * @param options.silent If true, suppress info notifications (used for auto-scans)
   */
  async scan(options?: { silent?: boolean }): Promise<void> {
    const silent = options?.silent ?? false;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      if (!silent) {
        vscode.window.showWarningMessage('Agent Rules Manager: No workspace folder open.');
      }
      return;
    }

    if (this.scanning) {
      if (!silent) {
        vscode.window.showInformationMessage('Agent Rules Manager: Scan already in progress.');
      }
      return;
    }

    this.scanning = true;
    this._onScanStarted.fire();
    const startTime = Date.now();

    try {
      const workspaceRoot = workspaceFolder.uri.fsPath;

      // Phase 1: Candidate discovery (wide net)
      const candidates = await discoverCandidates(workspaceRoot);

      // Phase 2: Pattern classification (existing format-based discovery)
      const discovered = await discoverFiles(workspaceRoot);

      const results = await mapWithConcurrency(
        discovered,
        async (file) => {
          try {
            return await this.processFile(
              file.filePath,
              file.format,
              file.sourceType,
              workspaceRoot,
              file.extensionMismatch,
            );
          } catch (err) {
            console.warn(`Agent Rules Manager: Failed to process ${file.filePath}:`, err);
            return undefined;
          }
        },
        20,
      );
      const rules = results.filter((r): r is IndexedRule => r !== undefined);

      // Phase 3: Reference resolution — promote candidates referenced by resolved rules
      const promoted = await this.resolveReferences(rules, candidates, workspaceRoot);
      rules.push(...promoted);

      // Store unresolved candidates
      const resolvedPaths = new Set(rules.map((r) => r.filePath));
      const unresolved = Array.from(candidates.values()).filter(
        (c) => !resolvedPaths.has(c.filePath),
      );
      this.candidateStore.replaceAll(unresolved);

      await this.ruleIndex.replaceAll(rules);

      const durationMs = Date.now() - startTime;
      this._onScanCompleted.fire({ count: rules.length, durationMs });

      if (!silent) {
        vscode.window.showInformationMessage(
          `Agent Rules Manager: Found ${rules.length} rule(s) in ${durationMs}ms.`,
        );
      }
    } catch (err) {
      console.error('Agent Rules Manager: Scan failed:', err);
      if (!silent) {
        vscode.window.showErrorMessage(`Agent Rules Manager: Scan failed — ${err}`);
      }
    } finally {
      this.scanning = false;
    }
  }

  private async processFile(
    filePath: string,
    format: IndexedRule['format'],
    sourceType: IndexedRule['sourceType'],
    workspaceRoot: string,
    extensionMismatch?: boolean,
  ): Promise<IndexedRule | undefined> {
    const uri = vscode.Uri.file(filePath);
    const stat = await vscode.workspace.fs.stat(uri);
    const contentBytes = await vscode.workspace.fs.readFile(uri);
    const content = Buffer.from(contentBytes).toString('utf-8');

    const { fields, body } = parseFrontmatter(content);
    const {
      trigger,
      globs,
      description: fmDescription,
    } = normalizeTrigger(format, fields, filePath, sourceType, workspaceRoot);

    // Fall back to first markdown heading if no frontmatter description
    const description = fmDescription ?? extractFirstHeading(body);

    const contentHash = computeMinHash(body);
    const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
    const bodyLength = body.trim().length;
    const references = extractReferences(body);

    return {
      id: generateRuleId(filePath),
      filePath,
      fileName: path.basename(filePath),
      fileExtension: path.extname(filePath).toLowerCase(),
      format,
      sourceType,
      trigger,
      description,
      globs,
      contentHash,
      bodyHash,
      bodyLength,
      references,
      fileSize: stat.size,
      lastModified: new Date(stat.mtime).toISOString(),
      rawFrontmatter: Object.keys(fields).length > 0 ? fields : undefined,
      ...(extensionMismatch ? { extensionMismatch: true } : {}),
    };
  }

  /**
   * Phase 3: Recursively resolve references from resolved rules into the candidate pool.
   * Promotes candidates to IndexedRule with format 'document'.
   * Promoted documents inherit trigger/globs from their referencing rules,
   * widened to the broadest scope when multiple rules reference the same document.
   */
  private async resolveReferences(
    resolvedRules: IndexedRule[],
    candidates: Map<string, CandidateFile>,
    workspaceRoot: string,
  ): Promise<IndexedRule[]> {
    const resolvedPaths = new Set(resolvedRules.map((r) => r.filePath));

    // Track which rules reference each candidate: candidatePath → set of referencing IndexedRules
    const referencedBy = new Map<string, IndexedRule[]>();

    // Helper to extract discovery refs from a rule and record them
    const recordReferences = async (rule: IndexedRule) => {
      const ruleDir = path.dirname(rule.filePath);
      const uri = vscode.Uri.file(rule.filePath);
      const contentBytes = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(contentBytes).toString('utf-8');
      const { body } = parseFrontmatter(content);
      const discoveryRefs = extractDiscoveryReferences(body);

      for (const ref of discoveryRefs) {
        const absPath = path.resolve(ruleDir, ref);
        if (!resolvedPaths.has(absPath) && candidates.has(absPath)) {
          const refs = referencedBy.get(absPath) ?? [];
          refs.push(rule);
          referencedBy.set(absPath, refs);
        }
      }
    };

    // Seed from all Phase 2 resolved rules
    for (const rule of resolvedRules) {
      await recordReferences(rule);
    }

    // BFS: promote candidates and follow their references recursively
    const promoted: IndexedRule[] = [];
    const visited = new Set<string>();
    // Queue: [absoluteFilePath, depth]
    const queue: Array<[string, number]> = [];
    for (const filePath of referencedBy.keys()) {
      queue.push([filePath, 1]);
    }

    while (queue.length > 0) {
      const [filePath, depth] = queue.shift()!;
      if (visited.has(filePath)) {
        continue;
      }
      visited.add(filePath);
      resolvedPaths.add(filePath);

      if (depth > MAX_REFERENCE_DEPTH) {
        console.warn(
          `Agent Rules Manager: Reference depth limit (${MAX_REFERENCE_DEPTH}) reached at ${filePath}`,
        );
        continue;
      }

      try {
        const rule = await this.processFile(filePath, 'document', 'directory_rule', workspaceRoot);
        if (rule) {
          // Inherit trigger/globs from referencing rules (widened to broadest scope)
          const referrers = referencedBy.get(filePath) ?? [];
          const inherited = widenTrigger(referrers);
          rule.trigger = inherited.trigger;
          rule.globs = inherited.globs;

          promoted.push(rule);

          // Follow this promoted document's references recursively
          await recordReferences(rule);
          const ruleDir = path.dirname(filePath);
          const contentBytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
          const content = Buffer.from(contentBytes).toString('utf-8');
          const { body } = parseFrontmatter(content);
          const discoveryRefs = extractDiscoveryReferences(body);

          for (const ref of discoveryRefs) {
            const absPath = path.resolve(ruleDir, ref);
            if (!resolvedPaths.has(absPath) && !visited.has(absPath) && candidates.has(absPath)) {
              queue.push([absPath, depth + 1]);
            }
          }
        }
      } catch (err) {
        console.warn(`Agent Rules Manager: Failed to promote referenced file ${filePath}:`, err);
      }
    }

    return promoted;
  }

  dispose(): void {
    this._onScanStarted.dispose();
    this._onScanCompleted.dispose();
  }
}

/**
 * Widen trigger/globs across multiple referencing rules.
 * Priority (broadest wins): always > glob > agent_requested > manual.
 * If any referrer is 'always', the result is 'always' with no globs.
 * If all referrers are 'glob', all their globs are merged.
 */
function widenTrigger(referrers: IndexedRule[]): {
  trigger: RuleTrigger;
  globs: string[] | undefined;
} {
  if (referrers.length === 0) {
    return { trigger: 'always', globs: undefined };
  }

  // If any referrer is 'always', the document is always active
  if (referrers.some((r) => r.trigger === 'always')) {
    return { trigger: 'always', globs: undefined };
  }

  // If any referrer is 'glob', merge all globs
  const globReferrers = referrers.filter((r) => r.trigger === 'glob');
  if (globReferrers.length > 0) {
    const allGlobs = new Set<string>();
    for (const r of globReferrers) {
      if (r.globs) {
        for (const g of r.globs) {
          allGlobs.add(g);
        }
      }
    }
    // If any non-glob referrer exists too, widen to always
    if (referrers.some((r) => r.trigger !== 'glob')) {
      return { trigger: 'always', globs: undefined };
    }
    return { trigger: 'glob', globs: allGlobs.size > 0 ? Array.from(allGlobs) : undefined };
  }

  // If any referrer is 'agent_requested', use that
  if (referrers.some((r) => r.trigger === 'agent_requested')) {
    return { trigger: 'agent_requested', globs: undefined };
  }

  return { trigger: 'manual', globs: undefined };
}
