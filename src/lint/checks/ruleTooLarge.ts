import { FileLintCheck } from '../lintCheck';
import { FileDiagnostic } from '../../scanner/classifiedFile';
import { estimateTokens, formatTokenCount } from '../../utils/tokenEstimator';

/**
 * Checks whether a rule's body exceeds the configured token threshold.
 */
export const ruleTooLarge: FileLintCheck = {
  id: 'rule-too-large',
  name: 'rule-too-large',
  category: 'lint',
  applicableFormats: '*',

  run(file, config) {
    const diagnostics: FileDiagnostic[] = [];
    const tokens = estimateTokens(file.bodyLength);
    if (tokens > config.maxRuleTokens) {
      diagnostics.push({
        id: 'rule-too-large',
        severity: 'warning',
        message: `Rule body is large (${formatTokenCount(tokens)}) — consider splitting`,
      });
    }
    return diagnostics;
  },
};
