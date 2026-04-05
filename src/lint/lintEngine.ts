import { LogicalRule } from '../scanner/scannerTypes';
import { RuleIssue } from './ruleIssues';
import { LintCheck, LintConfig } from './lintCheck';

// ── Built-in checks ─────────────────────────────────────────────────

import { divergedContent } from './checks/divergedContent';
import { missingPrimary } from './checks/missingPrimary';
import { extensionMismatch } from './checks/extensionMismatch';
import { emptyBody } from './checks/emptyBody';
import { missingDescription } from './checks/missingDescription';
import { ruleTooLarge } from './checks/ruleTooLarge';
import { brokenReference } from './checks/brokenReference';
import { outsideWorkspace } from './checks/outsideWorkspace';

/** All registered lint checks, in execution order. */
const ALL_CHECKS: LintCheck[] = [
  // Structural checks (always run)
  divergedContent,
  missingPrimary,
  extensionMismatch,
  // Lint checks (gated by config.lintEnabled)
  emptyBody,
  missingDescription,
  ruleTooLarge,
  outsideWorkspace,
  brokenReference,
];

// ── Engine ──────────────────────────────────────────────────────────

/**
 * Run all applicable lint checks against a single logical rule.
 *
 * Structural checks always run. Lint checks only run when
 * `config.lintEnabled` is true. Each check returns its own issues
 * (no shared mutable state).
 */
export async function computeIssues(
  logicalRule: LogicalRule,
  config: LintConfig,
): Promise<RuleIssue[]> {
  const issues: RuleIssue[] = [];

  for (const check of ALL_CHECKS) {
    if (check.category === 'lint' && !config.lintEnabled) { continue; }
    const result = await check.run(logicalRule, config);
    issues.push(...result);
  }

  return issues;
}

// Re-export the config type so consumers can import from one place
export type { LintConfig } from './lintCheck';
