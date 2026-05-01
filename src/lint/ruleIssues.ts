/**
 * Known issue IDs. New checks add entries here.
 *
 * Naming convention: kebab-case verb-noun, e.g. 'missing-description'.
 */
export type IssueId =
  // Structural / cross-format issues
  | 'diverged-content' // rule body differs across format versions
  | 'missing-primary' // no version in the user's primary format
  // Content quality issues
  | 'empty-body'
  | 'missing-description'
  | 'rule-too-large'
  | 'broken-reference' // rule body references a file that doesn't exist
  | 'outside-workspace'; // rule body references a file outside the workspace

export type IssueSeverity = 'error' | 'warning' | 'info';

/**
 * A single issue detected on a logical rule or one of its constituent files.
 */
export interface RuleIssue {
  /** Which check produced this issue */
  id: IssueId;

  /** error > warning > info */
  severity: IssueSeverity;

  /** Human-readable explanation shown in tooltips / UI */
  message: string;

  /**
   * If set, the issue applies to a specific IndexedRule file (by ID).
   * If undefined, the issue applies to the logical rule as a whole.
   */
  ruleId?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Check whether a list of issues contains a specific issue ID */
export function hasIssue(issues: RuleIssue[], id: RuleIssue['id']): boolean {
  return issues.some((i) => i.id === id);
}

/** Get the highest severity present in a list of issues */
export function maxSeverity(issues: RuleIssue[]): RuleIssue['severity'] | undefined {
  if (issues.length === 0) {
    return undefined;
  }
  if (issues.some((i) => i.severity === 'error')) {
    return 'error';
  }
  if (issues.some((i) => i.severity === 'warning')) {
    return 'warning';
  }
  return 'info';
}

/** Issues that apply to the logical rule as a whole (no ruleId) */
export function getLogicalIssues(issues: RuleIssue[]): RuleIssue[] {
  return issues.filter((i) => !i.ruleId);
}

/** Issues that apply to a specific file (has ruleId) */
export function getFileIssues(issues: RuleIssue[], ruleId: string): RuleIssue[] {
  return issues.filter((i) => i.ruleId === ruleId);
}

/**
 * De-duplicate file-level issues for display on the logical rule node.
 * When multiple files produce the same issue (same id + message), show
 * it once. Different messages under the same id are preserved (e.g.
 * broken references to different files).
 */
export function dedupeFileIssues(issues: RuleIssue[]): RuleIssue[] {
  const fileIssues = issues.filter((i) => i.ruleId);
  const seen = new Map<string, RuleIssue>();
  for (const issue of fileIssues) {
    const key = `${issue.id}::${issue.message}`;
    if (!seen.has(key)) {
      seen.set(key, { ...issue, ruleId: undefined });
    }
  }
  return Array.from(seen.values());
}
