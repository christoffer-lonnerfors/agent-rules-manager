import { LogicalRule, RuleFormat } from '../scanner/scannerTypes';
import { RuleIssue } from './ruleIssues';
import { FORMAT_LABELS } from '../views/ruleTreeProvider';

/**
 * Configuration that controls which checks run and their thresholds.
 * Passed in so the function stays pure (no vscode.workspace dependency).
 */
export interface IssueComputerConfig {
  /** User's chosen primary format, or '' if none */
  primaryFormat: RuleFormat | '';
  /** Whether divergence detection is enabled */
  detectDivergence: boolean;
}

/**
 * Compute all issues for a single logical rule.
 *
 * This is the single entry point that replaces the scattered ad-hoc checks
 * in the tree provider. New checks are added here as additional functions.
 */
export function computeIssues(
  logicalRule: LogicalRule,
  config: IssueComputerConfig,
): RuleIssue[] {
  const issues: RuleIssue[] = [];

  checkDivergedContent(logicalRule, config, issues);
  checkMissingPrimary(logicalRule, config, issues);
  checkExtensionMismatch(logicalRule, issues);

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
      const expected = rule.format === 'cursor' ? '.mdc / .md' : '.md';
      issues.push({
        id: 'extension-mismatch',
        severity: 'warning',
        message: `Wrong file extension — ${FORMAT_LABELS[rule.format]} expects ${expected}`,
        ruleId: rule.id,
      });
    }
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

