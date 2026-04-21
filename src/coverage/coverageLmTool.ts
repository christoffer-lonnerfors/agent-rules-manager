import * as vscode from 'vscode';
import { RuleStore } from '../logical/ruleStore';
import { AgentId, AGENT_DEFINITIONS } from '../agents/agentRegistry';
import { runCoverageAnalysis } from './coverageService';

interface AnalyzeCoverageInput {
  agentId?: string;
}

/**
 * Register the coverage analysis Language Model Tool.
 * Silently skips registration on VS Code versions older than 1.90 (no lm.registerTool).
 */
export function registerCoverageLmTool(
  ruleIndex: RuleStore,
  context: vscode.ExtensionContext,
): void {
  const lm = (
    vscode as unknown as {
      lm?: { registerTool?: (name: string, tool: unknown) => vscode.Disposable };
    }
  ).lm;
  if (!lm?.registerTool) return;

  const tool = {
    async invoke(
      options: { input: AnalyzeCoverageInput },
      _token: vscode.CancellationToken,
    ): Promise<{ content: Array<{ type: string; value: string }> }> {
      const error = (msg: string) => ({
        content: [{ type: 'text', value: JSON.stringify({ error: msg }) }],
      });

      const inputAgentId = options.input.agentId;
      if (inputAgentId && !AGENT_DEFINITIONS.find((a) => a.id === inputAgentId)) {
        const valid = AGENT_DEFINITIONS.map((a) => a.id).join(', ');
        return error(`Unknown agentId "${inputAgentId}". Valid values: ${valid}`);
      }

      const cfg = vscode.workspace.getConfiguration('agentRules');
      const configAgentId = cfg.get<string>('agent', '') as AgentId | '';
      const resolvedAgentId = (inputAgentId || configAgentId || undefined) as AgentId | undefined;

      const json = await runCoverageAnalysis(ruleIndex, resolvedAgentId);
      if (!json) return error('No workspace folder open.');

      return { content: [{ type: 'text', value: json }] };
    },
  };

  const disposable = lm.registerTool('agentRulesManager_analyzeCoverage', tool);
  context.subscriptions.push(disposable);
}
