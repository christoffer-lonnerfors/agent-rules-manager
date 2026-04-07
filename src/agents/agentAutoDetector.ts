import { ClassifiedFile } from '../scanner/classifiedFile';
import { RuleFormat } from '../formats/formatRegistry';
import { AgentId } from './agentConfig';

/**
 * Maps an agent-specific rule format to its owning agent.
 * Cross-agent formats (agents-md, claude-md) are excluded — they don't
 * indicate a particular agent.
 */
const FORMAT_TO_AGENT: Partial<Record<RuleFormat, AgentId>> = {
  'cursor-rules': 'cursor',
  cursorrules: 'cursor',
  'windsurf-rules': 'windsurf',
  windsurfrules: 'windsurf',
  kiro: 'kiro',
  antigravity: 'antigravity',
  'augment-rules': 'augment',
  'augment-guidelines': 'augment',
  'claude-rules': 'claude-code',
  'claude-local': 'claude-code',
};

/**
 * Analyse the scanned rules and return the agent whose primary format is
 * dominant in the workspace.
 *
 * Returns `undefined` when:
 *   - No agent-specific rule files were found (only cross-agent files or empty).
 *   - There is an exact tie between two or more agents.
 *
 * Only agent-specific formats are considered (cursor, windsurf, kiro, etc.).
 * Cross-agent formats like AGENTS.md and CLAUDE.md are deliberately ignored
 * because they don't imply a particular agent.
 */
export function detectDominantAgent(rules: ClassifiedFile[]): AgentId | undefined {
  const counts = new Map<AgentId, number>();

  for (const rule of rules) {
    const agent = FORMAT_TO_AGENT[rule.format];
    if (agent) {
      counts.set(agent, (counts.get(agent) ?? 0) + 1);
    }
  }

  if (counts.size === 0) {
    return undefined;
  }

  // Find the maximum count
  let maxCount = 0;
  let dominant: AgentId | undefined;
  let tied = false;

  for (const [agent, count] of counts) {
    if (count > maxCount) {
      maxCount = count;
      dominant = agent;
      tied = false;
    } else if (count === maxCount) {
      tied = true;
    }
  }

  // If there's a tie, don't auto-select
  if (tied) {
    return undefined;
  }

  return dominant;
}
