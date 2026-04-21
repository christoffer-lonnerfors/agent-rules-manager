import { AgentDefinition } from './agentDefinition';
import { getFormatDefinition } from '../formats/formatRegistry';
export type { AgentDefinition } from './agentDefinition';
export type { RuleTrigger } from '../formats/formatRegistry';

// ── Agent registry ────────────────────────────────────────────────────

/**
 * Agent definitions — maps each agent to its primary and supported formats.
 * Based on official documentation for each agent.
 */
const _definitions = [
  {
    id: 'cursor' as const,
    label: 'Cursor',
    primaryFormat: 'cursor-rules' as const,
    supportedFormats: ['cursorrules', 'agents-md'] as const,
  },
  {
    id: 'windsurf' as const,
    label: 'Windsurf',
    primaryFormat: 'windsurf-rules' as const,
    supportedFormats: ['windsurfrules', 'agents-md'] as const,
  },
  {
    id: 'kiro' as const,
    label: 'Kiro',
    primaryFormat: 'kiro' as const,
    supportedFormats: [] as const,
  },
  {
    id: 'antigravity' as const,
    label: 'Antigravity',
    primaryFormat: 'antigravity' as const,
    supportedFormats: [] as const,
  },
  {
    id: 'augment' as const,
    label: 'Augment Code',
    primaryFormat: 'augment-rules' as const,
    supportedFormats: ['augment-guidelines', 'agents-md', 'claude-md'] as const,
  },
  {
    id: 'claude-code' as const,
    label: 'Claude Code',
    primaryFormat: 'claude-rules' as const,
    supportedFormats: ['claude-local', 'claude-md', 'agents-md'] as const,
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
export function getReadableFormats(agentId: AgentId): AgentDefinition['supportedFormats'] {
  const def = getAgentDefinition(agentId);
  return [def.primaryFormat, ...def.supportedFormats];
}

/** Get all formats an agent can write to (readable formats that are not marked writable: false) */
export function getWritableFormats(agentId: AgentId): AgentDefinition['supportedFormats'] {
  return getReadableFormats(agentId).filter((f) => getFormatDefinition(f).writable !== false);
}

/** Get the default write format for an agent */
export function getDefaultWriteFormat(agentId: AgentId): AgentDefinition['primaryFormat'] {
  return getAgentDefinition(agentId).primaryFormat;
}

/**
 * Get the effective write format, validating that it's writable by the agent.
 * Falls back to the agent's default write format if the override is invalid.
 */
export function getEffectiveWriteFormat(
  agentId: AgentId,
  writeFormatOverride: string,
): AgentDefinition['primaryFormat'] {
  if (writeFormatOverride) {
    const writable = getWritableFormats(agentId);
    if ((writable as string[]).includes(writeFormatOverride)) {
      return writeFormatOverride as AgentDefinition['primaryFormat'];
    }
  }
  return getDefaultWriteFormat(agentId);
}

/** Check whether a logical rule is covered by any of the agent's readable formats */
export function isRuleCoveredByAgent(ruleFormats: string[], agentId: AgentId): boolean {
  const readable = getReadableFormats(agentId) as string[];
  return ruleFormats.some((f) => readable.includes(f));
}
