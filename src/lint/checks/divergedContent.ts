import { CrossFileLintCheck } from '../lintCheck';

/**
 * Checks whether the rule body has diverged across format versions.
 * Only relevant when a logical rule has 2+ files.
 */
export const divergedContent: CrossFileLintCheck = {
  name: 'diverged-content',
  category: 'structural',
  applicableFormats: '*',

  run(lr, config) {
    if (!config.detectDivergence) {
      return [];
    }
    if (lr.rules.length < 2) {
      return [];
    }
    if (!lr.isDiverged) {
      return [];
    }

    const pct = (lr.similarity * 100).toFixed(0);
    return [
      {
        id: 'diverged-content',
        severity: 'warning',
        message: `Content diverged across formats — similarity: ${pct}%`,
      },
    ];
  },
};
