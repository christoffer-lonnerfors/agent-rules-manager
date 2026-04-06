import { LintCheck } from '../lintCheck';

/**
 * Checks whether the rule body has diverged across format versions.
 * Only relevant when a logical rule has 2+ files.
 */
export const divergedContent: LintCheck = {
  name: 'diverged-content',
  category: 'structural',

  run(lr, config) {
    if (!config.detectDivergence) {
      return [];
    }
    if (lr.rules.length < 2) {
      return [];
    }
    if (lr.minSimilarity >= 1.0) {
      return [];
    }

    const pct = (lr.minSimilarity * 100).toFixed(0);
    return [
      {
        id: 'diverged-content',
        severity: 'warning',
        message: `Content diverged across formats — similarity: ${pct}%`,
      },
    ];
  },
};
