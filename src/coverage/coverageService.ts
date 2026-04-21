import { RuleStore } from '../logical/ruleStore';
import { AgentId } from '../agents/agentRegistry';
import { runAnalysis, buildCoverageJson } from './coverageExporter';

/**
 * Run coverage analysis and return the serialized JSON report string.
 * Returns undefined if no workspace folder is open.
 * Both the LM tool and the MCP server use this as their shared entry point.
 */
export async function runCoverageAnalysis(
  ruleStore: RuleStore,
  agentIdOverride?: AgentId,
): Promise<string | undefined> {
  const result = await runAnalysis(ruleStore, agentIdOverride);
  if (!result) return undefined;
  return buildCoverageJson(result);
}
