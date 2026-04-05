import { RuleIssue } from '../ruleIssues';
import { LintCheck } from '../lintCheck';
import { estimateTokens, formatTokenCount } from '../../utils/tokenEstimator';

/**
 * Checks whether a rule's body exceeds the configured token threshold.
 */
export const ruleTooLarge: LintCheck = {
  name: 'rule-too-large',
  category: 'lint',

  run(lr, config) {
    const issues: RuleIssue[] = [];
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
    return issues;
  },
};
