import { AgentId, getAgentConfig, getReadableFormats } from '../../agents/agentConfig';
import { LintCheck } from '../lintCheck';

/**
 * Checks whether the logical rule has at least one file in the
 * selected agent's readable formats with a correct file extension.
 */
export const missingPrimary: LintCheck = {
  name: 'missing-primary',
  category: 'structural',

  run(lr, config) {
    if (!config.agent) {
      return [];
    }

    const readable = getReadableFormats(config.agent as AgentId);
    const effectivelyCovered = lr.rules.some(
      (r) => readable.includes(r.format) && !r.extensionMismatch,
    );
    if (effectivelyCovered) {
      return [];
    }

    const label = getAgentConfig(config.agent as AgentId).label;
    return [
      {
        id: 'missing-primary',
        severity: 'warning',
        message: `Not readable by ${label}`,
      },
    ];
  },
};
