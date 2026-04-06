import { RuleFormat } from '../types';

// ── Agent concept ──────────────────────────────────────────────────────

/** Supported AI agent identifiers */
export type AgentId = 'cursor' | 'windsurf' | 'kiro' | 'antigravity' | 'augment' | 'claude-code';

/** Configuration for a single AI agent */
export interface AgentConfig {
  /** Agent identifier */
  id: AgentId;
  /** Human-readable label (used in UI) */
  label: string;
  /** Agent-specific format(s) where new rules are written by default */
  primaryFormats: RuleFormat[];
  /** Cross-agent formats this agent also reads at runtime */
  supportedFormats: RuleFormat[];
}

/**
 * Agent configurations — maps each agent to its primary and supported formats.
 * Based on official documentation for each agent.
 */
export const AGENT_CONFIGS: AgentConfig[] = [
  {
    id: 'cursor',
    label: 'Cursor',
    primaryFormats: ['cursor-rules', 'cursorrules'],
    supportedFormats: ['agents-md'],
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    primaryFormats: ['windsurf-rules', 'windsurfrules'],
    supportedFormats: [],
  },
  {
    id: 'kiro',
    label: 'Kiro',
    primaryFormats: ['kiro'],
    supportedFormats: [],
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    primaryFormats: ['antigravity'],
    supportedFormats: [],
  },
  {
    id: 'augment',
    label: 'Augment Code',
    primaryFormats: ['augment-rules', 'augment-guidelines'],
    supportedFormats: ['agents-md', 'claude-md'],
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    primaryFormats: ['claude-rules', 'claude-local'],
    supportedFormats: ['claude-md', 'agents-md'],
  },
];

/** Get the agent config for a given agent ID */
export function getAgentConfig(agentId: AgentId): AgentConfig {
  return AGENT_CONFIGS.find((a) => a.id === agentId)!;
}

/** Get all formats an agent can read (primary + supported) */
export function getReadableFormats(agentId: AgentId): RuleFormat[] {
  const config = getAgentConfig(agentId);
  return [...config.primaryFormats, ...config.supportedFormats];
}

/** Get the default write format for an agent (first primary format) */
export function getDefaultWriteFormat(agentId: AgentId): RuleFormat {
  return getAgentConfig(agentId).primaryFormats[0];
}

/**
 * Get the effective write format, validating that it's readable by the agent.
 * Falls back to the agent's default write format if the override is invalid.
 */
export function getEffectiveWriteFormat(
  agentId: AgentId,
  writeFormatOverride: RuleFormat | '',
): RuleFormat {
  if (writeFormatOverride) {
    const readable = getReadableFormats(agentId);
    if (readable.includes(writeFormatOverride)) {
      return writeFormatOverride;
    }
  }
  return getDefaultWriteFormat(agentId);
}

/** Check whether a logical rule is covered by any of the agent's readable formats */
export function isRuleCoveredByAgent(ruleFormats: RuleFormat[], agentId: AgentId): boolean {
  const readable = getReadableFormats(agentId);
  return ruleFormats.some((f) => readable.includes(f));
}
