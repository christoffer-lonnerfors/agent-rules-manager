import { AgentDefinition } from './agentDefinition';
export type { AgentDefinition } from './agentDefinition';

// ── Agent registry ────────────────────────────────────────────────────

/**
 * Agent definitions — maps each agent to its primary and supported formats.
 * Based on official documentation for each agent.
 */
const _definitions = [
  {
    id: 'cursor' as const,
    label: 'Cursor',
    primaryFormats: ['cursor-rules', 'cursorrules'],
    supportedFormats: ['agents-md'],
  },
  {
    id: 'windsurf' as const,
    label: 'Windsurf',
    primaryFormats: ['windsurf-rules', 'windsurfrules'],
    supportedFormats: [],
  },
  {
    id: 'kiro' as const,
    label: 'Kiro',
    primaryFormats: ['kiro'],
    supportedFormats: [],
  },
  {
    id: 'antigravity' as const,
    label: 'Antigravity',
    primaryFormats: ['antigravity'],
    supportedFormats: [],
  },
  {
    id: 'augment' as const,
    label: 'Augment Code',
    primaryFormats: ['augment-rules', 'augment-guidelines'],
    supportedFormats: ['agents-md', 'claude-md'],
  },
  {
    id: 'claude-code' as const,
    label: 'Claude Code',
    primaryFormats: ['claude-rules', 'claude-local'],
    supportedFormats: ['claude-md', 'agents-md'],
  },
] satisfies AgentDefinition[];

/** Union of all registered agent IDs — derived from the registry, single source of truth */
export type AgentId = (typeof _definitions)[number]['id'];

/** All agent definitions, typed as AgentDefinition[] for general use */
export const AGENT_DEFINITIONS: AgentDefinition[] = _definitions;

/** Get the agent definition for a given agent ID */
export function getAgentDefinition(agentId: AgentId): AgentDefinition {
  return AGENT_DEFINITIONS.find((a) => a.id === agentId)!;
}

/** Get all formats an agent can read (primary + supported) */
export function getReadableFormats(agentId: AgentId): AgentDefinition['primaryFormats'] {
  const def = getAgentDefinition(agentId);
  return [...def.primaryFormats, ...def.supportedFormats];
}

/** Get the default write format for an agent (first primary format) */
export function getDefaultWriteFormat(agentId: AgentId): AgentDefinition['primaryFormats'][number] {
  return getAgentDefinition(agentId).primaryFormats[0];
}

/**
 * Get the effective write format, validating that it's readable by the agent.
 * Falls back to the agent's default write format if the override is invalid.
 */
export function getEffectiveWriteFormat(
  agentId: AgentId,
  writeFormatOverride: AgentDefinition['primaryFormats'][number] | '',
): AgentDefinition['primaryFormats'][number] {
  if (writeFormatOverride) {
    const readable = getReadableFormats(agentId);
    if (readable.includes(writeFormatOverride)) {
      return writeFormatOverride;
    }
  }
  return getDefaultWriteFormat(agentId);
}

/** Check whether a logical rule is covered by any of the agent's readable formats */
export function isRuleCoveredByAgent(
  ruleFormats: AgentDefinition['primaryFormats'],
  agentId: AgentId,
): boolean {
  const readable = getReadableFormats(agentId);
  return ruleFormats.some((f) => readable.includes(f));
}
