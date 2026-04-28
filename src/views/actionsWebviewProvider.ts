import * as vscode from 'vscode';
import * as path from 'path';
import { LogicalRule } from '../logical/logicalRule';
import { RuleFormat, RuleTrigger, FORMAT_LABELS } from '../formats/formatRegistry';
import {
  AgentId,
  AGENT_DEFINITIONS,
  getReadableFormats,
  getEffectiveWriteFormat,
} from '../agents/agentRegistry';
import { RuleStore } from '../logical/ruleStore';
import { computeIssues, LintConfig } from '../lint/lintEngine';
import { filterIssuesForAgent } from '../lint/agentFilter';
import { RuleIssue } from '../lint/ruleIssues';
import { FORMAT_DEFINITIONS } from '../formats/formatRegistry';
import { createRuleFile } from '../actions/ruleWriter';

/** State object sent to the webview for rendering */
interface ActionsViewState {
  agent: string;
  agentLabel: string;
  agentInitials: string;
  writeFormat: string;
  writeFormatLabel: string;
  totalRules: number;
  multiFormatCount: number;
  divergedCount: number;
  missingCount: number;
  issueCounts: { errors: number; warnings: number; infos: number };
  issueMessages: { errors: string[]; warnings: string[]; infos: string[] };
  metaRuleInstalled: boolean;
}

/** State for the create-rule form */
interface CreateFormState {
  /** Whether this is a hierarchical format (AGENTS.md, CLAUDE.md) */
  isHierarchical: boolean;
  /** The fixed location label for directory-based formats (e.g. ".cursor/rules/") */
  fixedLocation: string;
  /** Human-readable format label */
  formatLabel: string;
  /** File extension for directory-based formats (e.g. ".mdc", ".md") */
  fileExtension: string;
  /** Fixed filename for hierarchical formats (e.g. "AGENTS.md") */
  fixedFileName: string;
}

/** Messages sent from webview → extension */
type WebviewMessage =
  | { type: 'openAgentConfig'; reason?: 'noAgent' }
  | { type: 'addRule' }
  | { type: 'showCoverage' }
  | { type: 'runSyncAll' }
  | { type: 'runAddAllMissing' }
  | { type: 'installMetaRule' }
  | { type: 'cancelCreate' }
  | { type: 'createRule'; name: string; trigger: string; location: string }
  | { type: 'browseFolderForRule' };

export class ActionsWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'agentRules.actionsView';

  private view?: vscode.WebviewView;
  private logicalRules: LogicalRule[] = [];
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly ruleIndex: RuleStore, private readonly extensionUri: vscode.Uri) {
    this.logicalRules = ruleIndex.getLogicalRules();

    this.disposables.push(
      ruleIndex.onDidChange(() => {
        this.logicalRules = this.ruleIndex.getLogicalRules();
        this.postState();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
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

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'resources'),
      ],
    };
    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      switch (msg.type) {
        case 'openAgentConfig':
          if (msg.reason === 'noAgent') {
            vscode.window.showInformationMessage(
              'Select an agent and format to use this action.',
            );
          }
          vscode.commands.executeCommand('agentRules.getStarted');
          break;
        case 'addRule':
          this.showCreateForm();
          break;
        case 'cancelCreate':
          this.postState();
          break;
        case 'createRule':
          await this.handleCreateRule(msg.name, msg.trigger as RuleTrigger, msg.location);
          break;
        case 'browseFolderForRule':
          await this.handleBrowseFolder();
          break;
        case 'showCoverage':
          vscode.commands.executeCommand('agentRules.showCoverage');
          break;
        case 'runSyncAll':
          vscode.commands.executeCommand('agentRules.syncAll');
          break;
        case 'runAddAllMissing':
          vscode.commands.executeCommand('agentRules.addAllMissing');
          break;
        case 'installMetaRule':
          vscode.commands.executeCommand('agentRules.installMetaRule');
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
    return this.logicalRules.filter((lr) => !isEffectivelyCovered(lr, agent));
  }

  /** Trigger the create-rule form from an external command (e.g. tree view + button) */
  triggerCreateForm(): void {
    // Small delay to let the webview become visible if it was just focused
    setTimeout(() => this.showCreateForm(), 150);
  }

  /** Get diverged logical rules */
  getDivergedRules(): LogicalRule[] {
    const detectDivergence = vscode.workspace
      .getConfiguration('agentRules')
      .get<boolean>('detectDivergence', true);
    if (!detectDivergence) {
      return [];
    }
    return this.logicalRules.filter((lr) => lr.isDiverged);
  }

  dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
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

    let writeFormat = '';

    const agentDef = agent ? AGENT_DEFINITIONS.find((a) => a.id === agent) : undefined;
    const agentLabel = agentDef?.label ?? '';
    const agentInitials = agentDef?.iconInitials ?? '';

    if (agent) {
      writeFormat = getEffectiveWriteFormat(agent as AgentId, writeFormatOverride);
    }

    const writeFormatLabel = writeFormat ? (FORMAT_LABELS[writeFormat as RuleFormat] ?? '') : '';

    const divergedCount = this.getDivergedRules().length;
    const missingCount = agent
      ? this.logicalRules.filter((lr) => !isEffectivelyCovered(lr, agent as AgentId)).length
      : 0;
    const multiFormatCount = this.logicalRules.filter((lr) => lr.rules.length > 1).length;

    // Compute issues across all logical rules
    const issueConfig: LintConfig = { agent, lintEnabled, detectDivergence, maxRuleTokens };
    const allIssues: RuleIssue[] = [];
    for (const lr of this.logicalRules) {
      const raw = await computeIssues(lr, issueConfig);
      const filtered = filterIssuesForAgent(raw, lr, agent as AgentId | '');
      allIssues.push(...filtered);
    }

    const errors = allIssues.filter((i) => i.severity === 'error');
    const warnings = allIssues.filter((i) => i.severity === 'warning');
    const infos = allIssues.filter((i) => i.severity === 'info');

    return {
      agent,
      agentLabel,
      agentInitials,
      writeFormat,
      writeFormatLabel,
      totalRules: this.logicalRules.length,
      multiFormatCount,
      divergedCount,
      missingCount,
      issueCounts: { errors: errors.length, warnings: warnings.length, infos: infos.length },
      issueMessages: {
        errors: [...new Set(errors.map((i) => i.message))],
        warnings: [...new Set(warnings.map((i) => i.message))],
        infos: [...new Set(infos.map((i) => i.message))],
      },
      metaRuleInstalled: this.logicalRules.some((lr) =>
        lr.rules.some((rf) => rf.filePath.includes('agent-rules-manager-meta-rule')),
      ),
    };
  }

  private async postState(): Promise<void> {
    if (!this.view) {
      return;
    }
    try {
      const state = await this.computeState();
      this.view.webview.postMessage({ type: 'updateState', state });
    } catch (err) {
      console.error('[AgentRules] ActionsWebviewProvider.computeState failed:', err);
    }
  }

  /**
   * Switch the webview to the "New Rule" creation form.
   * Sends format metadata and workspace directories to the webview.
   */
  private showCreateForm(): void {
    if (!this.view) {
      return;
    }

    const agent = this.getAgent();
    if (!agent) {
      return;
    }

    const cfg = vscode.workspace.getConfiguration('agentRules');
    const writeFormatOverride = cfg.get<string>('writeFormat', '') as RuleFormat | '';
    const writeFormat = getEffectiveWriteFormat(agent as AgentId, writeFormatOverride);
    const formatDef = FORMAT_DEFINITIONS.find((d) => d.id === writeFormat);
    if (!formatDef) {
      return;
    }

    const isHierarchical = formatDef.isHierarchical;

    let fixedLocation = '';
    if (!isHierarchical && !formatDef.validPaths.includes('.') && formatDef.validPaths.length > 0) {
      fixedLocation = formatDef.validPaths[0] + '/';
    }

    const fileExtension =
      !isHierarchical && formatDef.validExtensions.length > 0 ? formatDef.validExtensions[0] : '';

    const fixedFileName = isHierarchical ? formatDef.validNames[0] : '';

    const formState: CreateFormState = {
      isHierarchical,
      fixedLocation,
      formatLabel: FORMAT_LABELS[writeFormat],
      fileExtension,
      fixedFileName,
    };

    this.view.webview.postMessage({ type: 'showCreateForm', state: formState });
  }

  /**
   * Handle a "Browse…" request from the create-rule form.
   * Opens a native folder dialog and sends the selected path back to the webview.
   */
  private async handleBrowseFolder(): Promise<void> {
    if (!this.view) {
      return;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return;
    }

    const result = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      defaultUri: workspaceFolders[0].uri,
      openLabel: 'Select folder',
    });

    if (result && result.length > 0) {
      const root = workspaceFolders[0].uri.fsPath;
      const selected = result[0].fsPath;
      const relative = path.relative(root, selected);

      // Only allow folders within the workspace
      if (!relative.startsWith('..')) {
        this.view.webview.postMessage({
          type: 'folderSelected',
          path: relative || '/',
        });
      }
    }
  }

  /**
   * Handle creation of a new rule file from the form inputs.
   */
  private async handleCreateRule(
    name: string,
    trigger: RuleTrigger,
    location: string,
  ): Promise<void> {
    const agent = this.getAgent();
    if (!agent) return;

    const cfg = vscode.workspace.getConfiguration('agentRules');
    const writeFormatOverride = cfg.get<string>('writeFormat', '') as RuleFormat | '';
    const writeFormat = getEffectiveWriteFormat(agent as AgentId, writeFormatOverride);

    const filePath = createRuleFile(writeFormat, trigger, name.trim(), location);
    if (!filePath) return;

    await vscode.window.showTextDocument(vscode.Uri.file(filePath));
    vscode.commands.executeCommand('agentRules.rescan');
    this.postState();
  }

  private getHtml(webview: vscode.Webview): string {
    const codiconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'codicons', 'codicon.css'),
    );
    const agentIconsDark: Record<string, string> = {};
    const agentIconsLight: Record<string, string> = {};
    for (const agent of AGENT_DEFINITIONS) {
      agentIconsDark[agent.id] = webview.asWebviewUri(
        vscode.Uri.joinPath(this.extensionUri, 'resources', 'icons', 'dark', `${agent.id}.svg`),
      ).toString();
      agentIconsLight[agent.id] = webview.asWebviewUri(
        vscode.Uri.joinPath(this.extensionUri, 'resources', 'icons', 'light', `${agent.id}.svg`),
      ).toString();
    }
    const agentIconsDarkJson = JSON.stringify(agentIconsDark);
    const agentIconsLightJson = JSON.stringify(agentIconsLight);
    const cspSource = webview.cspSource;

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${cspSource}; script-src 'unsafe-inline'; font-src ${cspSource}; img-src ${cspSource};">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<link rel="stylesheet" href="${codiconsUri}">
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

  .agent-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 0;
  }
  .agent-icon-wrap {
    width: 20px; height: 20px;
    flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
  }
  .agent-icon-wrap img {
    width: 20px; height: 20px;
  }
  .agent-icon-wrap.no-agent {
    border-radius: 50%;
    background: var(--vscode-editorWarning-foreground, #cca700);
    color: #fff;
    font-size: 11px; font-weight: 700;
  }
  .agent-indicator-text {
    flex: 1; font-size: 12px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .agent-indicator-text.no-agent {
    color: var(--vscode-editorWarning-foreground, #cca700);
  }
  .agent-cog {
    background: none; border: none; cursor: pointer;
    color: var(--vscode-foreground); opacity: 0.6;
    padding: 3px 4px; display: flex; align-items: center;
    border-radius: 3px; flex-shrink: 0; line-height: 1;
  }
  .agent-cog:hover {
    opacity: 1;
    background: var(--vscode-toolbar-hoverBackground, rgba(128,128,128,0.15));
  }
  .agent-cog .codicon { font-size: 16px; }

  .divider {
    border: none;
    border-top: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,0.2)));
    margin: 12px 0;
  }

  /* Button width constraint wrapper */
  .btn-wrap {
    width: 100%;
    max-width: 300px;
    margin: 0 auto;
  }
  @media (min-width: 650px) {
    .btn-wrap { margin-left: 0; margin-right: 0; }
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
  .btn-primary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .btn-primary:disabled:hover { background: var(--vscode-button-background); }

  /* Secondary button (Show Coverage) — outline / ghost style */
  .btn-secondary {
    display: block;
    width: 100%;
    padding: 6px 12px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    border: 1px solid var(--vscode-button-background);
    border-radius: 2px;
    cursor: pointer;
    color: var(--vscode-button-background);
    background: transparent;
    text-align: center;
  }
  .btn-secondary:hover { background: color-mix(in srgb, var(--vscode-button-background) 12%, transparent); }
  .btn-secondary:disabled {
    opacity: 0.4;
    cursor: not-allowed;
    border-color: var(--vscode-disabledForeground, rgba(128,128,128,0.5));
    color: var(--vscode-disabledForeground, rgba(128,128,128,0.5));
  }
  .btn-secondary:disabled:hover { background: transparent; }

  /* Rules section */
  .rules-count {
    font-size: 12px;
    color: var(--vscode-descriptionForeground);
  }

  .issue-row {
    display: flex;
    align-items: baseline;
    gap: 5px;
    font-size: 12px;
    padding-top: 4px;
  }
  .issue-row-icon {
    flex-shrink: 0;
    color: var(--vscode-editorWarning-foreground, #cca700);
  }
  .issue-row-text { flex: 1; min-width: 0; }
  .issue-row-action {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font-family: var(--vscode-font-family);
    font-size: 12px;
    color: var(--vscode-textLink-foreground, var(--vscode-button-background));
    text-decoration: underline;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .issue-row-action:hover { color: var(--vscode-textLink-activeForeground); }

  .section { margin-bottom: 12px; }

  /* ── Create-rule form ────────────────────────────── */
  #createRuleForm { display: none; }

  .form-title {
    font-size: 13px;
    font-weight: 600;
    margin-bottom: 12px;
  }

  .input-group {
    display: flex;
    align-items: center;
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, var(--vscode-dropdown-border));
    border-radius: 2px;
  }
  .input-group:focus-within { border-color: var(--vscode-focusBorder); }

  .input-group input[type="text"] {
    flex: 1;
    min-width: 0;
    padding: 4px 8px;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-input-foreground);
    background: transparent;
    border: none;
    outline: none;
  }

  .input-suffix {
    padding: 4px 8px 4px 0;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-descriptionForeground);
    white-space: nowrap;
    user-select: none;
  }
  .input-suffix:empty { display: none; }

  .form-hint {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-top: 4px;
    line-height: 1.4;
  }

  .location-display {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 6px;
  }
  .location-display span {
    flex: 1;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
  }

  .form-buttons {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
  .form-buttons button {
    flex: 1;
  }

  .validation-error {
    color: var(--vscode-editorError-foreground, #f14c4c);
    font-size: 11px;
    margin-top: 4px;
    display: none;
  }
</style>
</head>
<body>
  <div id="mainView">
  <div class="section">
    <div class="section-label">Target rule format</div>
    <div class="agent-indicator">
      <div class="agent-icon-wrap" id="agentIconWrap"></div>
      <span class="agent-indicator-text" id="agentIndicatorText"></span>
      <button class="agent-cog" id="agentCogBtn" title="Open Agent Configuration" aria-label="Open Agent Configuration">
        <i class="codicon codicon-settings-gear"></i>
      </button>
    </div>
  </div>

  <div class="section">
    <div class="btn-wrap">
      <button class="btn-primary" id="addRuleBtn" title="Create a new rule file in the target format">+ Add Rule</button>
    </div>
  </div>

  <div class="section">
    <div class="btn-wrap">
      <button class="btn-secondary" id="showCoverageBtn" title="Analyse token cost of rules across workspace files">Generate Coverage Report</button>
    </div>
  </div>

  <div class="section">
    <div class="btn-wrap">
      <button class="btn-secondary" id="installMetaRuleBtn" title="Install rule-writing guidelines into your agent's rules folder">Install Rule-Writing Guidelines</button>
    </div>
  </div>

  <hr class="divider">
  <div class="section">
    <div class="section-label">Rules</div>
    <div id="rulesCount" class="rules-count"></div>
    <div id="rulesIssues"></div>
  </div>
  </div>

  <!-- ── Create Rule Form (hidden by default) ──────────────── -->
  <div id="createRuleForm">
    <div class="form-title">New Rule</div>
    <hr class="divider" style="margin-top:0">

    <div class="section">
      <div class="section-label">File Name</div>
      <div class="input-group">
        <input type="text" id="ruleNameInput" placeholder="e.g. coding-standards">
        <span class="input-suffix" id="extensionSuffix"></span>
      </div>
      <div id="ruleNameError" class="validation-error"></div>
    </div>

    <div class="section">
      <div class="section-label">Apply</div>
      <select id="triggerSelect">
        <option value="always">Always</option>
        <option value="glob">File pattern</option>
        <option value="agent_requested">Agent requested</option>
        <option value="manual">Manual</option>
      </select>
      <div id="triggerHint" class="form-hint"></div>
    </div>

    <div class="section" id="locationSection">
      <div class="section-label">Location</div>
      <div id="locationHint" class="form-hint" style="display:none"></div>
      <div id="locationDisplay" class="location-display" style="display:none">
        <span id="locationPath">/ (entire workspace)</span>
        <button id="browseFolderBtn" class="btn-secondary" style="padding:2px 8px;width:auto">Browse…</button>
      </div>
      <div id="locationFixed" class="form-hint" style="display:none"></div>
    </div>

    <div class="form-buttons">
      <button class="btn-primary" id="createBtn">Create</button>
      <button class="btn-secondary" id="cancelBtn">Cancel</button>
    </div>
  </div>

<script>
  const vscode = acquireVsCodeApi();
  const agentIconsDark = ${agentIconsDarkJson};
  const agentIconsLight = ${agentIconsLightJson};

  // ── Main view elements ──
  const mainView = document.getElementById('mainView');
  const agentIconWrap = document.getElementById('agentIconWrap');
  const agentIndicatorText = document.getElementById('agentIndicatorText');
  const agentCogBtn = document.getElementById('agentCogBtn');
  const addRuleBtn = document.getElementById('addRuleBtn');
  const rulesCount = document.getElementById('rulesCount');
  const rulesIssues = document.getElementById('rulesIssues');

  let currentState = null;

  // ── Create form elements ──
  const createRuleForm = document.getElementById('createRuleForm');
  const ruleNameInput = document.getElementById('ruleNameInput');
  const ruleNameError = document.getElementById('ruleNameError');
  const extensionSuffix = document.getElementById('extensionSuffix');
  const triggerSelect = document.getElementById('triggerSelect');
  const triggerHint = document.getElementById('triggerHint');
  const locationSection = document.getElementById('locationSection');
  const locationFixed = document.getElementById('locationFixed');
  const locationHint = document.getElementById('locationHint');
  const locationDisplay = document.getElementById('locationDisplay');
  const locationPath = document.getElementById('locationPath');
  const browseFolderBtn = document.getElementById('browseFolderBtn');
  const createBtn = document.getElementById('createBtn');
  const cancelBtn = document.getElementById('cancelBtn');

  let currentFormState = null;
  let selectedLocation = '/';

  function requireAgent() {
    if (!currentState || !currentState.agent) {
      vscode.postMessage({ type: 'openAgentConfig', reason: 'noAgent' });
      return false;
    }
    return true;
  }

  agentCogBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'openAgentConfig' });
  });
  addRuleBtn.addEventListener('click', () => {
    if (!requireAgent()) { return; }
    vscode.postMessage({ type: 'addRule' });
  });
  document.getElementById('showCoverageBtn')?.addEventListener('click', () => {
    if (!requireAgent()) { return; }
    vscode.postMessage({ type: 'showCoverage' });
  });
  document.getElementById('installMetaRuleBtn')?.addEventListener('click', () => {
    if (!requireAgent()) { return; }
    vscode.postMessage({ type: 'installMetaRule' });
  });

  // ── Create form event listeners ──
  cancelBtn.addEventListener('click', () => {
    hideCreateForm();
    vscode.postMessage({ type: 'cancelCreate' });
  });

  createBtn.addEventListener('click', () => {
    const name = ruleNameInput.value.trim();
    const isHierarchical = currentFormState && currentFormState.isHierarchical;
    if (!isHierarchical && !validateName(name)) { return; }
    const trigger = triggerSelect.value;
    vscode.postMessage({ type: 'createRule', name, trigger, location: selectedLocation });
    hideCreateForm();
  });

  ruleNameInput.addEventListener('input', () => {
    ruleNameError.style.display = 'none';
    // Strip illegal characters as the user types
    const cleaned = ruleNameInput.value.replace(/[^a-zA-Z0-9 _-]/g, '');
    if (cleaned !== ruleNameInput.value) {
      const pos = ruleNameInput.selectionStart - (ruleNameInput.value.length - cleaned.length);
      ruleNameInput.value = cleaned;
      ruleNameInput.setSelectionRange(pos, pos);
    }
  });

  browseFolderBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'browseFolderForRule' });
  });

  window.addEventListener('message', event => {
    const msg = event.data;
    if (msg.type === 'updateState') {
      hideCreateForm();
      render(msg.state);
    }
    if (msg.type === 'showCreateForm') { showCreateForm(msg.state); }
    if (msg.type === 'folderSelected') { selectLocationByPath(msg.path); }
  });

  // ── Create form logic ──

  function showCreateForm(state) {
    currentFormState = state;
    selectedLocation = '/';

    // Reset form
    ruleNameError.style.display = 'none';
    if (state.isHierarchical) {
      ruleNameInput.value = state.fixedFileName;
      ruleNameInput.disabled = true;
      extensionSuffix.textContent = '';
    } else {
      ruleNameInput.value = '';
      ruleNameInput.disabled = false;
      extensionSuffix.textContent = state.fileExtension || '';
    }
    triggerSelect.value = 'always';

    // Trigger dropdown: disabled for hierarchical formats
    triggerSelect.disabled = state.isHierarchical;
    triggerHint.style.display = 'none';

    // Location section
    if (state.isHierarchical) {
      // Editable location with Browse button
      locationFixed.style.display = 'none';
      locationHint.textContent = state.formatLabel + ' files apply to all files in their directory and subdirectories.';
      locationHint.style.display = '';
      locationPath.textContent = '/ (entire workspace)';
      locationDisplay.style.display = 'flex';
    } else {
      // Fixed location (read-only)
      locationFixed.textContent = state.fixedLocation;
      locationFixed.style.display = '';
      locationHint.style.display = 'none';
      locationDisplay.style.display = 'none';
    }

    // Toggle visibility
    mainView.style.display = 'none';
    createRuleForm.style.display = 'block';
    ruleNameInput.focus();
  }

  function hideCreateForm() {
    createRuleForm.style.display = 'none';
    mainView.style.display = '';
    currentFormState = null;
  }

  function selectLocationByPath(p) {
    selectedLocation = p;
    const label = (!p || p === '/') ? '/ (entire workspace)' : p + '/';
    locationPath.textContent = label;
  }

  function validateName(name) {
    if (!name) {
      ruleNameError.textContent = 'File name is required.';
      ruleNameError.style.display = '';
      return false;
    }
    if (/[^a-zA-Z0-9 _-]/.test(name)) {
      ruleNameError.textContent = 'Use only letters, numbers, spaces, hyphens, and underscores.';
      ruleNameError.style.display = '';
      return false;
    }
    return true;
  }

  function render(s) {
    currentState = s;
    const hasAgent = !!s.agent;

    // Agent indicator
    if (hasAgent) {
      const isDark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
      const iconUri = (isDark ? agentIconsDark : agentIconsLight)[s.agent] || '';
      agentIconWrap.className = 'agent-icon-wrap';
      agentIconWrap.innerHTML = iconUri ? '<img src="' + iconUri + '" width="20" height="20" alt="" />' : '';
      agentIndicatorText.textContent = s.agentLabel + ' · ' + s.writeFormatLabel;
      agentIndicatorText.className = 'agent-indicator-text';
    } else {
      agentIconWrap.className = 'agent-icon-wrap no-agent';
      agentIconWrap.textContent = '!';
      agentIndicatorText.textContent = 'No agent selected';
      agentIndicatorText.className = 'agent-indicator-text no-agent';
    }

    // Add Rule button
    addRuleBtn.title = 'Create a new rule file in the target format';

    // Coverage button
    const showCoverageBtn = document.getElementById('showCoverageBtn');
    if (showCoverageBtn) {
      showCoverageBtn.title = 'Analyse token cost of rules across workspace files';
    }

    // Install meta-rule button — disabled only when already installed
    const installMetaRuleBtn = document.getElementById('installMetaRuleBtn');
    if (installMetaRuleBtn) {
      installMetaRuleBtn.disabled = s.metaRuleInstalled;
      installMetaRuleBtn.title = s.metaRuleInstalled
        ? 'Rule-writing guidelines are already installed'
        : 'Install rule-writing guidelines for this agent';
    }

    // Rules section — count
    if (s.totalRules > 0) {
      rulesCount.textContent = s.totalRules + ' rule' + (s.totalRules > 1 ? 's' : '');
    } else {
      rulesCount.textContent = 'No rules found';
    }

    // Rules section — issue rows
    rulesIssues.innerHTML = '';
    if (hasAgent) {
      if (s.divergedCount > 0) {
        rulesIssues.innerHTML += makeIssueRow(
          s.divergedCount + ' rule' + (s.divergedCount > 1 ? 's' : '') + ' diverged across formats',
          'Sync',
          'runSyncAll'
        );
      }
      if (s.missingCount > 0) {
        const agentLabel = s.agentLabel || s.agent;
        rulesIssues.innerHTML += makeIssueRow(
          s.missingCount + ' rule' + (s.missingCount > 1 ? 's' : '') + ' not readable by ' + escHtml(agentLabel),
          'Fix',
          'runAddAllMissing'
        );
      }
    }
  }

  function makeIssueRow(text, actionLabel, actionType) {
    return '<div class="issue-row">' +
      '<span class="issue-row-icon">⚠</span>' +
      '<span class="issue-row-text">' + text + '</span>' +
      '<button class="issue-row-action" onclick="vscode.postMessage({type:\\''+actionType+'\\'})">'+actionLabel+'</button>' +
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
 * at least one file is in a readable format AND has no extension mismatch diagnostic.
 * (A file with wrong extension won't be read by the agent at runtime.)
 */
function isEffectivelyCovered(lr: LogicalRule, agentId: AgentId): boolean {
  const readable = getReadableFormats(agentId);
  return lr.rules.some(
    (r) => readable.includes(r.format) && !r.diagnostics.some((d) => d.id === 'extension-mismatch'),
  );
}
