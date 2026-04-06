import { minimatch } from 'minimatch';
import { ClassifiedFile } from '../scanner/classifiedFile';
import { RuleFormat } from '../types';
import { AgentId, getReadableFormats } from '../agents/agentConfig';
import { estimateTokens } from '../utils/tokenEstimator';

/** Coverage data for a single file */
export interface FileCoverage {
  /** Relative file path from workspace root */
  relativePath: string;
  /** Token cost: always-on + glob-matched */
  tokens: number;
  /** Always-on rules contributing to this file's cost */
  alwaysRules: CoverageRuleInfo[];
  /** Glob-matched rules contributing to this file's cost */
  globRules: CoverageRuleInfo[];
  /** Agent-requested rules (not included in tokens, shown separately) */
  agentRequestedRules: CoverageRuleInfo[];
}

/** Minimal rule info for coverage display */
export interface CoverageRuleInfo {
  /** Rule description or filename */
  name: string;
  /** Estimated token count */
  tokens: number;
  /** Absolute file path (for click-to-open) */
  filePath: string;
  /** Glob patterns (for display, if applicable) */
  globs?: string[];
}

/** A node in the coverage file tree sent to the webview */
export interface CoverageTreeNode {
  /** Relative path from workspace root */
  path: string;
  /** Display name (file or directory name) */
  name: string;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** Token cost (file: exact, directory: max of children) */
  tokens: number;
  /** Children nodes (directories and files) */
  children: CoverageTreeNode[];
  /** Coverage detail (only for files) */
  coverage?: FileCoverage;
}

/** Summary stats for the header bar */
export interface CoverageSummary {
  baselineTokens: number;
  baselineRuleCount: number;
  potentialTokens: number;
  potentialRuleCount: number;
  contextWindowTokens: number;
  hottestFile: { path: string; tokens: number } | null;
}

/** Full state object sent to the webview */
export interface CoverageState {
  summary: CoverageSummary;
  tree: CoverageTreeNode;
  agentLabel: string;
}

/** Precomputed glob rule with its compiled matcher */
interface GlobRule {
  rule: CoverageRuleInfo;
  patterns: string[];
}

/**
 * Analyses indexed rules and workspace files to produce a coverage tree.
 * Pure analysis — reads from RuleIndex, no side effects.
 */
export class CoverageModel {
  private alwaysRules: CoverageRuleInfo[] = [];
  private globRules: GlobRule[] = [];
  private agentRequestedRules: CoverageRuleInfo[] = [];
  private alwaysTokens = 0;
  private potentialTokens = 0;

  /**
   * Classify and index rules from the current RuleIndex.
   * Optionally filters by agent (only rules in formats the agent reads).
   */
  rebuild(rules: ClassifiedFile[], agentId?: AgentId): void {
    this.alwaysRules = [];
    this.globRules = [];
    this.agentRequestedRules = [];
    this.alwaysTokens = 0;
    this.potentialTokens = 0;

    // Filter by agent if specified
    let filtered = rules;
    if (agentId) {
      const readable = getReadableFormats(agentId);
      filtered = rules.filter((r) => readable.includes(r.format));
    }

    // Exclude document format and manual trigger
    filtered = filtered.filter((r) => r.format !== 'document' && r.trigger !== 'manual');

    for (const rule of filtered) {
      const info = toRuleInfo(rule);

      switch (rule.trigger) {
        case 'always':
          this.alwaysRules.push(info);
          this.alwaysTokens += info.tokens;
          break;
        case 'glob':
          if (rule.globs && rule.globs.length > 0) {
            this.globRules.push({ rule: info, patterns: rule.globs });
          } else {
            // Glob trigger but no patterns — treat as always-on
            this.alwaysRules.push(info);
            this.alwaysTokens += info.tokens;
          }
          break;
        case 'agent_requested':
          this.agentRequestedRules.push(info);
          this.potentialTokens += info.tokens;
          break;
        // manual: excluded above
      }
    }
  }

  /** Compute coverage for a single file path (relative to workspace root) */
  getFileCoverage(relativePath: string): FileCoverage {
    const matchedGlobs: CoverageRuleInfo[] = [];

    for (const gr of this.globRules) {
      const matches = gr.patterns.some((pattern) =>
        minimatch(relativePath, pattern, { dot: true }),
      );
      if (matches) {
        matchedGlobs.push({ ...gr.rule, globs: gr.patterns });
      }
    }

    const globTokens = matchedGlobs.reduce((sum, r) => sum + r.tokens, 0);

    return {
      relativePath,
      tokens: this.alwaysTokens + globTokens,
      alwaysRules: this.alwaysRules,
      globRules: matchedGlobs,
      agentRequestedRules: this.agentRequestedRules,
    };
  }

  /**
   * Build the full coverage tree from a list of workspace file paths.
   * @param filePaths Relative paths from workspace root
   * @param contextWindowTokens Context window size for summary
   * @param agentLabel Display label for the agent (or empty)
   */
  buildTree(filePaths: string[], contextWindowTokens: number, agentLabel: string): CoverageState {
    // 1. Compute per-file coverage
    const fileCoverages = new Map<string, FileCoverage>();
    for (const fp of filePaths) {
      fileCoverages.set(fp, this.getFileCoverage(fp));
    }

    // 2. Build directory tree structure
    const root: CoverageTreeNode = {
      path: '',
      name: '',
      isDirectory: true,
      tokens: 0,
      children: [],
    };

    for (const fp of filePaths) {
      const parts = fp.split('/');
      let current = root;

      // Create/navigate directory nodes
      for (let i = 0; i < parts.length - 1; i++) {
        const dirPath = parts.slice(0, i + 1).join('/');
        let child = current.children.find((c) => c.isDirectory && c.path === dirPath);
        if (!child) {
          child = {
            path: dirPath,
            name: parts[i],
            isDirectory: true,
            tokens: 0,
            children: [],
          };
          current.children.push(child);
        }
        current = child;
      }

      // Add file node
      const coverage = fileCoverages.get(fp)!;
      current.children.push({
        path: fp,
        name: parts[parts.length - 1],
        isDirectory: false,
        tokens: coverage.tokens,
        children: [],
        coverage,
      });
    }

    // 3. Sort children (directories first, then alphabetical) and propagate max-child costs
    sortAndPropagate(root);

    // 4. Find hottest file
    let hottestFile: { path: string; tokens: number } | null = null;
    for (const [fp, cov] of fileCoverages) {
      if (!hottestFile || cov.tokens > hottestFile.tokens) {
        hottestFile = { path: fp, tokens: cov.tokens };
      }
    }

    return {
      summary: {
        baselineTokens: this.alwaysTokens,
        baselineRuleCount: this.alwaysRules.length,
        potentialTokens: this.potentialTokens,
        potentialRuleCount: this.agentRequestedRules.length,
        contextWindowTokens,
        hottestFile,
      },
      tree: root,
      agentLabel,
    };
  }

  /** Get baseline summary */
  getBaselineSummary(): { rules: CoverageRuleInfo[]; totalTokens: number } {
    return { rules: this.alwaysRules, totalTokens: this.alwaysTokens };
  }

  /** Get potential summary */
  getPotentialSummary(): { rules: CoverageRuleInfo[]; totalTokens: number } {
    return { rules: this.agentRequestedRules, totalTokens: this.potentialTokens };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function toRuleInfo(rule: ClassifiedFile): CoverageRuleInfo {
  return {
    name: rule.description || rule.fileName,
    tokens: estimateTokens(rule.bodyLength),
    filePath: rule.filePath,
    globs: rule.globs,
  };
}

/** Sort children and propagate max-child token cost upward */
function sortAndPropagate(node: CoverageTreeNode): number {
  if (!node.isDirectory) {
    return node.tokens;
  }

  let maxTokens = 0;
  for (const child of node.children) {
    const childTokens = sortAndPropagate(child);
    if (childTokens > maxTokens) {
      maxTokens = childTokens;
    }
  }

  // Sort: directories first, then alphabetical
  node.children.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  node.tokens = maxTokens;
  return maxTokens;
}
