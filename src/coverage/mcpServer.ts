import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

// ── VS Code native MCP provider ───────────────────────────────────────────

type McpStdioServerDefinitionCtor = new (
  label: string,
  command: string,
  args?: string[],
  env?: Record<string, string | number | null>,
  version?: string,
) => { cwd?: vscode.Uri };

type VsCodeWithMcp = {
  McpStdioServerDefinition?: McpStdioServerDefinitionCtor;
};

type VsCodeLmWithMcp = {
  registerMcpServerDefinitionProvider?: (id: string, provider: unknown) => vscode.Disposable;
};

/**
 * Register the stdio server with VS Code's native MCP provider API so VS Code
 * LM API agents (Copilot, etc.) discover it without any config file changes.
 * Silently skips on VS Code versions that don't support the API.
 */
export function registerVsCodeMcpProvider(context: vscode.ExtensionContext): void {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) return;
  const workspaceRoot = workspaceFolders[0].uri;

  const McpStdioServerDefinition = (vscode as unknown as VsCodeWithMcp).McpStdioServerDefinition;
  const lm = (vscode as unknown as { lm?: VsCodeLmWithMcp }).lm;
  if (!McpStdioServerDefinition || !lm?.registerMcpServerDefinitionProvider) return;

  const serverPath = context.asAbsolutePath('./dist/coverage/mcpServerStdio.js');

  const disposable = lm.registerMcpServerDefinitionProvider('agent-rules-manager', {
    provideMcpServerDefinitions: () => {
      const def = new McpStdioServerDefinition(
        'Agent Rules Manager',
        process.execPath,
        [serverPath],
      );
      def.cwd = workspaceRoot;
      return [def];
    },
  });
  context.subscriptions.push(disposable);
}

// ── Claude Code MCP configurator ──────────────────────────────────────────

/**
 * Write (or update) the agent-rules MCP server entry in .claude/settings.json
 * with user confirmation.
 */
export async function configureMcpForClaude(extensionPath: string): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showWarningMessage('Agent Rules: Open a workspace folder first.');
    return;
  }
  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  const settingsPath = path.join(workspaceRoot, '.claude', 'settings.json');

  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    // File doesn't exist or is unparseable — start from empty object
  }

  const mcpServers = (settings.mcpServers ?? {}) as Record<string, unknown>;
  const serverConfig = {
    type: 'stdio',
    command: 'node',
    args: [path.join(extensionPath, 'dist', 'coverage', 'mcpServerStdio.js')],
  };
  const alreadyConfigured =
    JSON.stringify(mcpServers['agent-rules']) === JSON.stringify(serverConfig);

  if (alreadyConfigured) {
    vscode.window.showInformationMessage(
      'Agent Rules: MCP server is already configured in .claude/settings.json.',
    );
    return;
  }

  const action = mcpServers['agent-rules'] ? 'Update' : 'Add';
  const answer = await vscode.window.showInformationMessage(
    `${action} "agent-rules" MCP server in .claude/settings.json?\n\n${JSON.stringify(serverConfig, null, 2)}`,
    { modal: true },
    action,
  );
  if (answer !== action) return;

  settings.mcpServers = { ...mcpServers, 'agent-rules': serverConfig };
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  vscode.window.showInformationMessage(
    'Agent Rules: MCP server configured. Restart Claude Code to apply.',
  );
}
