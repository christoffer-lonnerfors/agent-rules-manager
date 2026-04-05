import { RuleIssue } from '../ruleIssues';
import { LintCheck } from '../lintCheck';

/**
 * Checks for rules with empty or near-empty body content.
 */
export const emptyBody: LintCheck = {
  name: 'empty-body',
  category: 'lint',

  run(lr) {
    const issues: RuleIssue[] = [];
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
    return issues;
  },
};
