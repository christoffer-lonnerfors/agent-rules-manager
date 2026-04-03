/**
 * Known issue IDs. New checks add entries here.
 *
 * Naming convention: kebab-case verb-noun, e.g. 'missing-description'.
 */
export type IssueId =
  // Structural / cross-format issues
  | 'diverged-content'      // rule body differs across format versions
  | 'missing-primary'       // no version in the user's primary format
  | 'extension-mismatch'    // file extension doesn't match the format's expected extensions
  // Content quality issues (reserved for upcoming linter checks)
  | 'empty-body'
  | 'missing-description'
  | 'rule-too-large'
  | 'broad-glob'
  | 'dead-glob';

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

