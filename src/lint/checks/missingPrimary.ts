import { AgentId, getAgentDefinition, getReadableFormats } from '../../agents/agentRegistry';
import { CrossFileLintCheck } from '../lintCheck';

/**
 * Checks whether the logical rule has at least one file in the
 * selected agent's readable formats with a correct file extension.
 */
export const missingPrimary: CrossFileLintCheck = {
  name: 'missing-primary',
  category: 'structural',
  applicableFormats: '*',

  run(lr, config) {
    if (!config.agent) {
      return [];
    }

    const readable = getReadableFormats(config.agent as AgentId);
    const effectivelyCovered = lr.rules.some((r) => readable.includes(r.format));
    if (effectivelyCovered) {
      return [];
    }

    const label = getAgentDefinition(config.agent as AgentId).label;
    return [
      {
        id: 'missing-primary',
        severity: 'warning',
        message: `Not readable by ${label}`,
      },
    ];
  },
};
