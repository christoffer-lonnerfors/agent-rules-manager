import { LogicalRule } from '../types';
import { AgentId, getReadableFormats } from '../agents/agentConfig';
import { RuleIssue } from './ruleIssues';

/**
 * Filter issues to only those relevant to the selected agent.
 *
 * All issues are still computed and stored — this controls display at the
 * logical rule level (badge, tooltip, description). File-level nodes
 * always show their own issues unfiltered.
 *
 * Rules:
 * - No agent selected → return all issues (no filtering)
 * - `missing-primary` → always keep (already agent-scoped by missingPrimary rule)
 * - `diverged-content` → keep only if the rule has files in agent's readable formats
 * - `missing-description` → keep only if the rule is covered by the agent
 * - File-level issues (have ruleId) → keep only if the file's format is readable by the agent
 */
export function filterIssuesForAgent(
  issues: RuleIssue[],
  lr: LogicalRule,
  agentId: AgentId | '',
): RuleIssue[] {
  if (!agentId) {
    return issues;
  }

  const readable = getReadableFormats(agentId as AgentId);
  const agentRuleIds = new Set(
    lr.rules.filter((r) => readable.includes(r.format)).map((r) => r.id),
  );
  const hasAgentFiles = agentRuleIds.size > 0;

  return issues.filter((issue) => {
    // File-level issue: keep only if the file belongs to an agent-readable format
    if (issue.ruleId) {
      return agentRuleIds.has(issue.ruleId);
    }

    // Logical-level issues
    switch (issue.id) {
      case 'missing-primary':
        // Already agent-scoped — always relevant
        return true;
      case 'diverged-content':
        // Only relevant if the agent reads any of the diverged files
        return hasAgentFiles;
      case 'missing-description':
        // Only relevant if the agent can actually read this rule
        return hasAgentFiles;
      default:
        return true;
    }
  });
}
