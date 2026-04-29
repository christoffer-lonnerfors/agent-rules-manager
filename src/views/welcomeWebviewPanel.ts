import * as vscode from 'vscode';
import {
  AgentId,
  AGENT_DEFINITIONS,
  getWritableFormats,
  getDefaultWriteFormat,
} from '../agents/agentRegistry';
import { FORMAT_LABELS } from '../formats/formatRegistry';
import { installMetaRule } from '../actions/metaRuleInstaller';
import { configureMcpForAgent } from '../coverage/mcpServer';

type WelcomeMessage =
  | {
    type: 'save';
    agentId: string;
    writeFormat: string;
    metaRuleConsent: boolean;
    mcpConsent: boolean;
  }
  | { type: 'cancel' };

interface ConfigOpts {
  initialAgentId: string;
  initialWriteFormat: string;
}

export class WelcomeWebviewPanel {
  static readonly viewType = 'agentRules.welcome';
  private static instance: WelcomeWebviewPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  static createOrShow(
    context: vscode.ExtensionContext,
    opts: ConfigOpts,
  ): void {
    // Always dispose and recreate so the panel shows fresh config values
    if (WelcomeWebviewPanel.instance) {
      WelcomeWebviewPanel.instance.panel.dispose();
    }
    const panel = vscode.window.createWebviewPanel(
      WelcomeWebviewPanel.viewType,
      'Agent Configuration',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: false },
    );
    WelcomeWebviewPanel.instance = new WelcomeWebviewPanel(panel, context, opts);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    opts: ConfigOpts,
  ) {
    this.panel = panel;

    panel.webview.html = this.buildHtml(opts);

    panel.webview.onDidReceiveMessage(
      async (msg: WelcomeMessage) => {
        switch (msg.type) {
          case 'save':
            await this.handleSave(msg);
            panel.dispose();
            break;
          case 'cancel':
            await context.globalState.update('hasSeenWelcome', true);
            panel.dispose();
            break;
        }
      },
      undefined,
      context.subscriptions,
    );

    panel.onDidDispose(() => {
      WelcomeWebviewPanel.instance = undefined;
    });
  }

  private async handleSave(
    msg: Extract<WelcomeMessage, { type: 'save' }>,
  ): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('agentRules');

    if (msg.agentId) {
      await cfg.update('agent', msg.agentId, vscode.ConfigurationTarget.Workspace);
    }

    // Only persist writeFormat when the user chose something other than the agent default
    if (msg.agentId && msg.writeFormat) {
      const defaultFormat = getDefaultWriteFormat(msg.agentId as AgentId);
      const override = msg.writeFormat !== defaultFormat ? msg.writeFormat : '';
      await cfg.update('writeFormat', override, vscode.ConfigurationTarget.Workspace);
    }

    await cfg.update('autoInstallMetaRule', msg.metaRuleConsent, vscode.ConfigurationTarget.Global);
    await cfg.update('autoConfigureMcp', msg.mcpConsent, vscode.ConfigurationTarget.Global);

    await this.context.globalState.update('hasSeenWelcome', true);

    if (msg.metaRuleConsent && msg.agentId) {
      const written = await installMetaRule(this.context.extensionPath, msg.agentId as AgentId, { skipExisting: true });
      if (written.length > 0) {
        await vscode.commands.executeCommand('agentRules.rescan');
      }
    }

    if (msg.mcpConsent && msg.agentId) {
      const agentDef = AGENT_DEFINITIONS.find((a) => a.id === msg.agentId);
      if (agentDef?.supportsMcp) {
        await configureMcpForAgent(msg.agentId, this.context.extensionPath, { silent: true });
      }
    }
  }

  private buildHtml(opts: ConfigOpts): string {
    const { initialAgentId, initialWriteFormat } = opts;
    const cfg = vscode.workspace.getConfiguration('agentRules');
    const metaRuleConsent = cfg.get<boolean>('autoInstallMetaRule', true);
    const mcpConsent = cfg.get<boolean>('autoConfigureMcp', true);

    // Build maps for client-side format switching
    const formatsMap: Record<string, Array<{ id: string; label: string }>> = {};
    const defaultFormatsMap: Record<string, string> = {};
    for (const agent of AGENT_DEFINITIONS) {
      formatsMap[agent.id] = getWritableFormats(agent.id as AgentId).map((f) => ({
        id: f,
        label: FORMAT_LABELS[f] ?? f,
      }));
      defaultFormatsMap[agent.id] = getDefaultWriteFormat(agent.id as AgentId);
    }

    const agentOptions = AGENT_DEFINITIONS.map((a) => {
      const selected = a.id === initialAgentId ? ' selected' : '';
      return `<option value="${a.id}"${selected}>${escapeHtml(a.label)}</option>`;
    }).join('\n      ');

    const initialFormats = initialAgentId ? (formatsMap[initialAgentId] ?? []) : [];
    const initialDefault = defaultFormatsMap[initialAgentId] ?? '';
    const activeFormat = initialWriteFormat || initialDefault;
    const formatOptions = initialFormats
      .map((f) => {
        const selected = f.id === activeFormat ? ' selected' : '';
        const label = escapeHtml(f.label) + (f.id === initialDefault ? ' (default)' : '');
        return `<option value="${f.id}"${selected}>${label}</option>`;
      })
      .join('\n      ');

    const metaCheckedAttr = metaRuleConsent ? ' checked' : '';
    const mcpCheckedAttr = mcpConsent ? ' checked' : '';
    const initialMcpSupported = AGENT_DEFINITIONS.find((a) => a.id === initialAgentId)?.supportsMcp ?? false;
    const mcpHiddenAttr = initialMcpSupported ? '' : ' style="display:none"';

    const mcpSupportMap: Record<string, boolean> = {};
    for (const agent of AGENT_DEFINITIONS) {
      mcpSupportMap[agent.id] = agent.supportsMcp ?? false;
    }

    const formatsMapJson = JSON.stringify(formatsMap);
    const defaultFormatsMapJson = JSON.stringify(defaultFormatsMap);
    const mcpSupportMapJson = JSON.stringify(mcpSupportMap);

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    display: flex;
    justify-content: center;
    padding: 60px 24px;
    min-height: 100vh;
  }
  .container { width: 100%; max-width: 460px; }
  h1 {
    font-size: 22px;
    font-weight: 600;
    margin-bottom: 6px;
  }
  .subtitle {
    font-size: 13px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 32px;
  }
  .field { margin-bottom: 18px; }
  .field-label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.7;
    margin-bottom: 6px;
  }
  select {
    width: 100%;
    padding: 6px 8px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-dropdown-foreground);
    background: var(--vscode-dropdown-background);
    border: 1px solid var(--vscode-dropdown-border);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }
  select:focus { border-color: var(--vscode-focusBorder); }
  .divider {
    border: none;
    border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
    margin: 24px 0;
  }
  .checkboxes {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 28px;
  }
  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    user-select: none;
  }
  .checkbox-row input[type="checkbox"] {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    cursor: pointer;
    accent-color: var(--vscode-button-background);
  }
  .checkbox-row span { font-size: 13px; }
  .actions {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .btn-primary {
    padding: 7px 20px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    font-weight: 500;
    border: none;
    border-radius: 2px;
    cursor: pointer;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  .btn-primary:hover { background: var(--vscode-button-hoverBackground); }
  .btn-link {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--vscode-textLink-foreground);
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    padding: 0;
  }
  .btn-link:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="container">
  <h1>Agent Configuration</h1>
  <p class="subtitle">Choose your target agent and rule format</p>

  <div class="field">
    <label class="field-label" for="agent-select">Agent</label>
    <select id="agent-select">
      <option value="" disabled hidden>— select an agent —</option>
      ${agentOptions}
    </select>
  </div>

  <div class="field">
    <label class="field-label" for="format-select">Write rules in format</label>
    <select id="format-select">
      ${formatOptions}
    </select>
  </div>

  <hr class="divider" />

  <div class="checkboxes">
    <label class="checkbox-row">
      <input type="checkbox" id="meta-rule-cb"${metaCheckedAttr} />
      <span>Add rule-writing guidelines to project rules</span>
    </label>
    <label class="checkbox-row" id="mcp-row"${mcpHiddenAttr}>
      <input type="checkbox" id="mcp-cb"${mcpCheckedAttr} />
      <span>Auto-register MCP tool for supported agents</span>
    </label>
  </div>

  <div class="actions">
    <button class="btn-primary" id="get-started-btn">Save</button>
    <button class="btn-link" id="skip-btn">Cancel</button>
  </div>
</div>
<script>
  const vscode = acquireVsCodeApi();
  const formatsMap = ${formatsMapJson};
  const defaultFormatsMap = ${defaultFormatsMapJson};
  const mcpSupportMap = ${mcpSupportMapJson};

  const agentSelect = document.getElementById('agent-select');
  const formatSelect = document.getElementById('format-select');
  const mcpRow = document.getElementById('mcp-row');

  function updateFormatDropdown(agentId) {
    const formats = formatsMap[agentId] || [];
    const defaultFormat = defaultFormatsMap[agentId] || '';
    formatSelect.innerHTML = formats
      .map(function(f) {
        var label = f.label + (f.id === defaultFormat ? ' (default)' : '');
        return '<option value="' + f.id + '"' + (f.id === defaultFormat ? ' selected' : '') + '>' + label + '</option>';
      })
      .join('');
  }

  function updateMcpRow(agentId) {
    mcpRow.style.display = mcpSupportMap[agentId] ? '' : 'none';
  }

  agentSelect.addEventListener('change', function() {
    updateFormatDropdown(agentSelect.value);
    updateMcpRow(agentSelect.value);
  });

  document.getElementById('get-started-btn').addEventListener('click', function() {
    vscode.postMessage({
      type: 'save',
      agentId: agentSelect.value,
      writeFormat: formatSelect.value,
      metaRuleConsent: document.getElementById('meta-rule-cb').checked,
      mcpConsent: document.getElementById('mcp-cb').checked,
    });
  });

  document.getElementById('skip-btn').addEventListener('click', function() {
    vscode.postMessage({ type: 'cancel' });
  });
</script>
</body>
</html>`;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
