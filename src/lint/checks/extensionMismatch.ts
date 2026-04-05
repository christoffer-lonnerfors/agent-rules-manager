import { RuleFormat, FORMAT_LABELS } from '../../types';
import { FORMAT_CONFIGS } from '../../scanner/formatDetector';
import { RuleIssue } from '../ruleIssues';
import { LintCheck } from '../lintCheck';

/** Lookup: format → expected extensions (derived from FORMAT_CONFIGS) */
const FORMAT_EXTENSIONS = new Map<RuleFormat, string[]>(
  FORMAT_CONFIGS.map(c => [c.format, c.extensions]),
);

/**
 * Checks whether files in format directories have the correct extension.
 */
export const extensionMismatch: LintCheck = {
  name: 'extension-mismatch',
  category: 'structural',

  run(lr) {
    const issues: RuleIssue[] = [];
    for (const rule of lr.rules) {
      if (rule.extensionMismatch) {
        const expected = (FORMAT_EXTENSIONS.get(rule.format) ?? ['.md']).join(' / ');
        issues.push({
          id: 'extension-mismatch',
          severity: 'error',
          message: `Wrong file extension — ${FORMAT_LABELS[rule.format]} expects ${expected}`,
          ruleId: rule.id,
        });
      }
    }
    return issues;
  },
};
