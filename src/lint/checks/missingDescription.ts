import { LintCheck } from '../lintCheck';

const MIN_DESCRIPTION_LENGTH = 10;

/**
 * Checks that agent-requested rules have a meaningful description.
 * The description is the only signal agents use to decide whether
 * to attach the rule, so it must be present and non-trivial.
 */
export const missingDescription: LintCheck = {
  name: 'missing-description',
  category: 'lint',

  run(lr) {
    // Only relevant for agent_requested rules
    if (lr.trigger !== 'agent_requested') {
      return [];
    }

    const desc = lr.description?.trim() ?? '';
    if (desc.length === 0) {
      return [
        {
          id: 'missing-description',
          severity: 'warning',
          message: 'Agent-requested rule has no description — agents cannot discover it',
        },
      ];
    }
    if (desc.length < MIN_DESCRIPTION_LENGTH) {
      return [
        {
          id: 'missing-description',
          severity: 'warning',
          message: `Description is too short (${desc.length} chars) — agents need a clear description to decide when to use this rule`,
        },
      ];
    }
    return [];
  },
};
