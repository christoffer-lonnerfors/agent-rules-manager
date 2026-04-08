import { LogicalRule } from '../logical/logicalRule';
import { RuleIssue } from './ruleIssues';
import { FileLintCheck, CrossFileLintCheck, LintConfig } from './lintCheck';
import { ClassifiedFile, FileDiagnostic } from '../scanner/classifiedFile';

// ── Built-in file-level checks ──────────────────────────────────────

import { emptyBody } from './checks/emptyBody';
import { missingDescription } from './checks/missingDescription';
import { ruleTooLarge } from './checks/ruleTooLarge';
import { brokenReference } from './checks/brokenReference';
import { outsideWorkspace } from './checks/outsideWorkspace';

// ── Built-in cross-file checks ──────────────────────────────────────

import { divergedContent } from './checks/divergedContent';
import { missingPrimary } from './checks/missingPrimary';

/** All registered file-level lint checks */
const FILE_CHECKS: FileLintCheck[] = [
  // Lint (gated by config.lintEnabled)
  emptyBody,
  missingDescription,
  ruleTooLarge,
  outsideWorkspace,
  brokenReference,
];

/** All registered cross-file lint checks */
const CROSS_FILE_CHECKS: CrossFileLintCheck[] = [
  // Structural (always run)
  divergedContent,
  missingPrimary,
];

// ── File-level engine ────────────────────────────────────────────────

/**
 * Run all applicable file-level lint checks against a single classified file.
 * Returns diagnostics to attach to the file.
 */
export async function computeFileDiagnostics(
  file: ClassifiedFile,
  config: LintConfig,
): Promise<FileDiagnostic[]> {
  const diagnostics: FileDiagnostic[] = [];

  for (const check of FILE_CHECKS) {
    if (check.category === 'lint' && !config.lintEnabled) {
      continue;
    }
    if (check.applicableFormats !== '*' && !check.applicableFormats.includes(file.format)) {
      continue;
    }
    const result = await check.run(file, config);
    diagnostics.push(...result);
  }

  return diagnostics;
}

// ── Cross-file engine ────────────────────────────────────────────────

/**
 * Run all applicable cross-file lint checks against a single logical rule.
 * Structural checks always run. Lint checks only run when
 * `config.lintEnabled` is true.
 */
export async function computeIssues(
  logicalRule: LogicalRule,
  config: LintConfig,
): Promise<RuleIssue[]> {
  const issues: RuleIssue[] = [];

  for (const check of CROSS_FILE_CHECKS) {
    if (check.category === 'lint' && !config.lintEnabled) {
      continue;
    }
    if (
      check.applicableFormats !== '*' &&
      !logicalRule.formats.some((f) => (check.applicableFormats as string[]).includes(f))
    ) {
      continue;
    }
    const result = await check.run(logicalRule, config);
    issues.push(...result);
  }

  return issues;
}

// Re-export the config type so consumers can import from one place
export type { LintConfig } from './lintCheck';
