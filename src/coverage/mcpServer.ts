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

// ── Shared MCP config file writer ─────────────────────────────────────────

type ConfigureOptions = { silent?: boolean };

async function configureMcpInFile(
  workspaceRoot: string,
  configRelPath: string,
  serverKey: string,
  serverConfig: Record<string, unknown>,
  agentLabel: string,
  options?: ConfigureOptions,
): Promise<void> {
  const settingsPath = path.join(workspaceRoot, configRelPath);

  let settings: Record<string, unknown> = {};
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    // File doesn't exist or is unparseable — start from empty object
  }

  const mcpServers = (settings.mcpServers ?? {}) as Record<string, unknown>;
  const alreadyConfigured =
    JSON.stringify(mcpServers[serverKey]) === JSON.stringify(serverConfig);

  if (alreadyConfigured) {
    if (!options?.silent) {
      vscode.window.showInformationMessage(
        `Agent Rules: MCP server is already configured in ${configRelPath}.`,
      );
    }
    return;
  }

  if (!options?.silent) {
    const action = mcpServers[serverKey] ? 'Update' : 'Add';
    const answer = await vscode.window.showInformationMessage(
      `${action} "agent-rules" MCP server in ${configRelPath}?\n\n${JSON.stringify(serverConfig, null, 2)}`,
      { modal: true },
      action,
    );
    if (answer !== action) return;
  }

  settings.mcpServers = { ...mcpServers, [serverKey]: serverConfig };
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');

  if (!options?.silent) {
    vscode.window.showInformationMessage(
      `Agent Rules: MCP server configured for ${agentLabel}. Restart ${agentLabel} to apply.`,
    );
  }
}

// ── Per-agent MCP configurators ───────────────────────────────────────────

/**
 * Write (or update) the agent-rules MCP server entry in .claude/settings.json
 * with user confirmation.
 */
export async function configureMcpForClaude(
  extensionPath: string,
  options?: ConfigureOptions,
): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    if (!options?.silent) {
      vscode.window.showWarningMessage('Agent Rules: Open a workspace folder first.');
    }
    return;
  }
  await configureMcpInFile(
    workspaceFolders[0].uri.fsPath,
    '.claude/settings.json',
    'agent-rules',
    {
      type: 'stdio',
      command: 'node',
      args: [path.join(extensionPath, 'dist', 'coverage', 'mcpServerStdio.js')],
    },
    'Claude Code',
    options,
  );
}

/**
 * Write (or update) the agent-rules MCP server entry in .cursor/mcp.json
 * with user confirmation.
 */
export async function configureMcpForCursor(
  extensionPath: string,
  options?: ConfigureOptions,
): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    if (!options?.silent) {
      vscode.window.showWarningMessage('Agent Rules: Open a workspace folder first.');
    }
    return;
  }
  await configureMcpInFile(
    workspaceFolders[0].uri.fsPath,
    '.cursor/mcp.json',
    'agent-rules',
    {
      command: 'node',
      args: [path.join(extensionPath, 'dist', 'coverage', 'mcpServerStdio.js')],
    },
    'Cursor',
    options,
  );
}

/**
 * Write (or update) the agent-rules MCP server entry in
 * .codeium/windsurf/mcp_config.json with user confirmation.
 */
export async function configureMcpForWindsurf(
  extensionPath: string,
  options?: ConfigureOptions,
): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    if (!options?.silent) {
      vscode.window.showWarningMessage('Agent Rules: Open a workspace folder first.');
    }
    return;
  }
  await configureMcpInFile(
    workspaceFolders[0].uri.fsPath,
    '.codeium/windsurf/mcp_config.json',
    'agent-rules',
    {
      command: 'node',
      args: [path.join(extensionPath, 'dist', 'coverage', 'mcpServerStdio.js')],
    },
    'Windsurf',
    options,
  );
}

/**
 * Dispatch to the correct per-agent MCP configurator.
 * Returns false if the agent does not have a known configurator.
 */
export async function configureMcpForAgent(
  agentId: string,
  extensionPath: string,
  options?: ConfigureOptions,
): Promise<boolean> {
  switch (agentId) {
    case 'claude-code':
      await configureMcpForClaude(extensionPath, options);
      return true;
    case 'cursor':
      await configureMcpForCursor(extensionPath, options);
      return true;
    case 'windsurf':
      await configureMcpForWindsurf(extensionPath, options);
      return true;
    default:
      return false;
  }
}
