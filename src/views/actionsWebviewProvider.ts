import * as vscode from 'vscode';
import {
  LogicalRule, RuleFormat, AgentId,
  AGENT_CONFIGS, FORMAT_LABELS,
  getReadableFormats, getDefaultWriteFormat, getEffectiveWriteFormat,
} from '../scanner/scannerTypes';
import { RuleIndex } from '../index/ruleIndex';
import { computeIssues, filterIssuesForAgent, IssueComputerConfig } from '../lint/issueComputer';
import { RuleIssue } from '../lint/ruleIssues';

/** State object sent to the webview for rendering */
interface ActionsViewState {
  agent: string;
  agents: Array<{ id: string; label: string }>;
  writeFormat: string;
  availableFormats: Array<{ id: string; label: string; isDefault: boolean }>;
  totalRules: number;
  multiFormatCount: number;
  divergedCount: number;
  missingCount: number;
  issueCounts: { errors: number; warnings: number; infos: number };
  issueMessages: { errors: string[]; warnings: string[]; infos: string[] };
}

/** Messages sent from webview → extension */
type WebviewMessage =
  | { type: 'agentChanged'; value: string }
  | { type: 'writeFormatChanged'; value: string }
  | { type: 'addRule' }
  | { type: 'runSyncAll' }
  | { type: 'runAddAllMissing' };



export class ActionsWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'agentRules.actionsView';

  private view?: vscode.WebviewView;
  private logicalRules: LogicalRule[] = [];
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly ruleIndex: RuleIndex) {
    this.logicalRules = ruleIndex.getLogicalRules();

    this.disposables.push(
      ruleIndex.onDidChange(() => {
        this.logicalRules = this.ruleIndex.getLogicalRules();
        this.postState();
      }),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (
          e.affectsConfiguration('agentRules.agent') ||
          e.affectsConfiguration('agentRules.writeFormat') ||
          e.affectsConfiguration('agentRules.detectDivergence')
        ) {
          this.postState();
        }
      }),
    );
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      switch (msg.type) {
        case 'agentChanged':
          vscode.workspace.getConfiguration('agentRules')
            .update('agent', msg.value, vscode.ConfigurationTarget.Workspace);
          break;
        case 'writeFormatChanged':
          vscode.workspace.getConfiguration('agentRules')
            .update('writeFormat', msg.value, vscode.ConfigurationTarget.Workspace);
          break;
        case 'addRule':
          vscode.commands.executeCommand('agentRules.addRule');
          break;
        case 'runSyncAll':
          vscode.commands.executeCommand('agentRules.syncAll');
          break;
        case 'runAddAllMissing':
          vscode.commands.executeCommand('agentRules.addAllMissing');
          break;
      }
    });

    // Send initial state once webview is ready
    // Small delay to let the webview initialise its message listener
    setTimeout(() => this.postState(), 100);

    // Re-send state when the view becomes visible again (VS Code reloads the
    // webview HTML when switching away and back, resetting the JS context)
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        setTimeout(() => this.postState(), 100);
      }
    });
  }

  // ── Public API (used by extension.ts commands) ──────────────────────

  /** Get logical rules not effectively readable by the agent (accounts for extensionMismatch) */
  getMissingRules(agent: AgentId): LogicalRule[] {
    return this.logicalRules.filter(lr => !isEffectivelyCovered(lr, agent));
  }

  /** Get diverged logical rules */
  getDivergedRules(): LogicalRule[] {
    const detectDivergence = vscode.workspace.getConfiguration('agentRules')
      .get<boolean>('detectDivergence', true);
    if (!detectDivergence) { return []; }
    return this.logicalRules.filter(lr => lr.rules.length > 1 && lr.minSimilarity < 1.0);
  }

  dispose(): void {
    for (const d of this.disposables) { d.dispose(); }
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private getAgent(): AgentId | '' {
    return vscode.workspace.getConfiguration('agentRules').get<string>('agent', '') as AgentId | '';
  }

  private async computeState(): Promise<ActionsViewState> {
    const agent = this.getAgent();
    const cfg = vscode.workspace.getConfiguration('agentRules');
    const writeFormatOverride = cfg.get<string>('writeFormat', '') as RuleFormat | '';
    const lintEnabled = cfg.get<boolean>('lint.enabled', true);
    const detectDivergence = cfg.get<boolean>('detectDivergence', true);
    const maxRuleTokens = cfg.get<number>('lint.maxRuleTokens', 2000);

    const agents = AGENT_CONFIGS.map(a => ({ id: a.id, label: a.label }));

    let availableFormats: ActionsViewState['availableFormats'] = [];
    let writeFormat = '';

    if (agent) {
      const readable = getReadableFormats(agent as AgentId);
      const defaultFmt = getDefaultWriteFormat(agent as AgentId);
      writeFormat = getEffectiveWriteFormat(agent as AgentId, writeFormatOverride);

      availableFormats = readable.map(f => ({
        id: f,
        label: FORMAT_LABELS[f],
        isDefault: f === defaultFmt,
      }));
    }

    const divergedCount = this.getDivergedRules().length;
    const missingCount = agent
      ? this.logicalRules.filter(lr => !isEffectivelyCovered(lr, agent as AgentId)).length
      : 0;
    const multiFormatCount = this.logicalRules.filter(lr => lr.rules.length > 1).length;

    // Compute issues across all logical rules
    const issueConfig: IssueComputerConfig = { agent, lintEnabled, detectDivergence, maxRuleTokens };
    const allIssues: RuleIssue[] = [];
    for (const lr of this.logicalRules) {
      const raw = await computeIssues(lr, issueConfig);
      const filtered = filterIssuesForAgent(raw, lr, agent as AgentId | '');
      allIssues.push(...filtered);
    }

    const errors = allIssues.filter(i => i.severity === 'error');
    const warnings = allIssues.filter(i => i.severity === 'warning');
    const infos = allIssues.filter(i => i.severity === 'info');

    return {
      agent,
      agents,
      writeFormat,
      availableFormats,
      totalRules: this.logicalRules.length,
      multiFormatCount,
      divergedCount,
      missingCount,
      issueCounts: { errors: errors.length, warnings: warnings.length, infos: infos.length },
      issueMessages: {
        errors: [...new Set(errors.map(i => i.message))],
        warnings: [...new Set(warnings.map(i => i.message))],
        infos: [...new Set(infos.map(i => i.message))],
      },
    };
  }

  private async postState(): Promise<void> {
    if (!this.view) { return; }
    const state = await this.computeState();
    this.view.webview.postMessage({ type: 'updateState', state });
  }

  private getHtml(): string {
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: transparent;
    padding: 12px 16px;
    line-height: 1.4;
  }

  .section-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-foreground);
    opacity: 0.7;
    margin-bottom: 6px;
  }

  select {
    width: 100%;
    padding: 4px 8px;
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
    border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,0.2)));
    margin: 12px 0;
  }

  /* Primary button (Add Rule) */
  .btn-primary {
    display: block;
    width: 100%;
    padding: 6px 12px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    border: none;
    border-radius: 2px;
    cursor: pointer;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    text-align: center;
  }
  .btn-primary:hover { background: var(--vscode-button-hoverBackground); }

  /* Contextual banners */
  .banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px;
    border-radius: 3px;
    margin-bottom: 6px;
    font-size: 12px;
  }
  .banner-warning {
    background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700) 12%, transparent);
    color: var(--vscode-foreground);
  }
  .banner-info {
    background: color-mix(in srgb, var(--vscode-editorInfo-foreground, #3794ff) 12%, transparent);
    color: var(--vscode-foreground);
  }
  .banner-icon {
    flex-shrink: 0;
    margin-right: 6px;
  }
  .banner-icon-warning { color: var(--vscode-editorWarning-foreground, #cca700); }
  .banner-icon-info { color: var(--vscode-editorInfo-foreground, #3794ff); }
  .banner-text {
    flex: 1;
    min-width: 0;
  }
  .banner-action {
    font-family: var(--vscode-font-family);
    font-size: 11px;
    padding: 2px 8px;
    border: none;
    border-radius: 2px;
    cursor: pointer;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    white-space: nowrap;
    flex-shrink: 0;
    margin-left: 8px;
  }
  .banner-action:hover { background: var(--vscode-button-hoverBackground); }

  .empty-state {
    color: var(--vscode-descriptionForeground);
    font-size: 12px;
    line-height: 1.5;
    margin-top: 4px;
  }

  .footer {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }

  .issue-count { cursor: default; white-space: nowrap; }
  .issue-error { color: var(--vscode-editorError-foreground, #f14c4c); }
  .issue-warning { color: var(--vscode-editorWarning-foreground, #cca700); }
  .issue-info { color: var(--vscode-editorInfo-foreground, #3794ff); }

  .section { margin-bottom: 12px; }
</style>
</head>
<body>
  <div class="section">
    <div class="section-label" title="The AI coding agent you use.">Agent</div>
    <select id="agentSelect" title="Select the AI coding agent you use">
      <option value="">Select an agent…</option>
    </select>
  </div>

  <div id="formatSection" class="section" style="display:none">
    <div class="section-label" title="The format used when creating or syncing rule files.">Target Format</div>
    <select id="formatSelect" title="Choose the format to write rule files in"></select>
  </div>

  <div id="addRuleSection" class="section" style="display:none">
    <button class="btn-primary" id="addRuleBtn" title="Create a new rule file in the target format">+ Add Rule</button>
  </div>

  <div id="bannersSection"></div>

  <div id="emptySection" class="empty-state" style="display:none">
    Select an agent to enable rule creation and coverage checks.
  </div>

  <hr class="divider">
  <div id="footer" class="footer"></div>

<script>
  const vscode = acquireVsCodeApi();

  const agentSelect = document.getElementById('agentSelect');
  const formatSection = document.getElementById('formatSection');
  const formatSelect = document.getElementById('formatSelect');
  const addRuleSection = document.getElementById('addRuleSection');
  const addRuleBtn = document.getElementById('addRuleBtn');
  const bannersSection = document.getElementById('bannersSection');
  const emptySection = document.getElementById('emptySection');
  const footer = document.getElementById('footer');

  agentSelect.addEventListener('change', () => {
    vscode.postMessage({ type: 'agentChanged', value: agentSelect.value });
  });
  formatSelect.addEventListener('change', () => {
    vscode.postMessage({ type: 'writeFormatChanged', value: formatSelect.value });
  });
  addRuleBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'addRule' });
  });

  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type === 'updateState') { render(msg.state); }
  });

  function render(s) {
    // Agent dropdown
    agentSelect.innerHTML = '<option value="">Select an agent…</option>';
    for (const a of s.agents) {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.label;
      if (a.id === s.agent) { opt.selected = true; }
      agentSelect.appendChild(opt);
    }

    const hasAgent = !!s.agent;

    // Format dropdown
    if (hasAgent) {
      formatSection.style.display = '';
      formatSelect.innerHTML = '';
      for (const f of s.availableFormats) {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = f.label + (f.isDefault ? ' (default)' : '');
        if (f.id === s.writeFormat) { opt.selected = true; }
        formatSelect.appendChild(opt);
      }
    } else {
      formatSection.style.display = 'none';
    }

    // Add Rule button
    addRuleSection.style.display = hasAgent ? '' : 'none';

    // Contextual banners (only shown when there's work to do)
    bannersSection.innerHTML = '';
    if (hasAgent) {
      if (s.divergedCount > 0) {
        bannersSection.innerHTML += makeBanner(
          'warning',
          s.divergedCount + ' rule' + (s.divergedCount > 1 ? 's' : '') + ' diverged across formats',
          'Sync',
          'runSyncAll'
        );
      }
      if (s.missingCount > 0) {
        const agentLabel = s.agents.find(a => a.id === s.agent)?.label || s.agent;
        bannersSection.innerHTML += makeBanner(
          'warning',
          s.missingCount + ' rule' + (s.missingCount > 1 ? 's' : '') + ' not readable by ' + escHtml(agentLabel),
          'Add Missing',
          'runAddAllMissing'
        );
      }
    }

    // Empty state
    emptySection.style.display = hasAgent ? 'none' : '';

    // Footer
    if (s.totalRules > 0) {
      const parts = [s.totalRules + ' rule' + (s.totalRules > 1 ? 's' : '')];

      const ic = s.issueCounts;
      const im = s.issueMessages;
      footer.innerHTML = escHtml(parts.join(' · '));

      const issueSpans = [];
      if (ic.errors > 0) {
        issueSpans.push('<span class="issue-count issue-error" title="' + escAttr(im.errors.join('\\n')) + '">⊘ ' + ic.errors + '</span>');
      }
      if (ic.warnings > 0) {
        issueSpans.push('<span class="issue-count issue-warning" title="' + escAttr(im.warnings.join('\\n')) + '">⚠ ' + ic.warnings + '</span>');
      }
      if (ic.infos > 0) {
        issueSpans.push('<span class="issue-count issue-info" title="' + escAttr(im.infos.join('\\n')) + '">ⓘ ' + ic.infos + '</span>');
      }
      if (issueSpans.length > 0) {
        footer.innerHTML += ' · ' + issueSpans.join(' ');
      }
    } else {
      footer.textContent = 'No rules found';
    }
  }

  function makeBanner(type, text, actionLabel, actionType) {
    const iconClass = type === 'warning' ? 'banner-icon-warning' : 'banner-icon-info';
    const icon = type === 'warning' ? '⚠' : 'ⓘ';
    return '<div class="banner banner-' + type + '">' +
      '<span class="banner-icon ' + iconClass + '">' + icon + '</span>' +
      '<span class="banner-text">' + text + '</span>' +
      '<button class="banner-action" onclick="vscode.postMessage({type:\\''+actionType+'\\'})">'+actionLabel+'</button>' +
      '</div>';
  }

  function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function escAttr(str) {
    return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
</script>
</body>
</html>`;
  }
}

// ── Module-level helpers ────────────────────────────────────────────────

/**
 * Stricter coverage check: a rule is effectively covered by an agent only if
 * at least one IndexedRule is in a readable format AND has no extension mismatch.
 * (A file with wrong extension won't be read by the agent at runtime.)
 */
function isEffectivelyCovered(lr: LogicalRule, agentId: AgentId): boolean {
  const readable = getReadableFormats(agentId);
  return lr.rules.some(r => readable.includes(r.format) && !r.extensionMismatch);
}