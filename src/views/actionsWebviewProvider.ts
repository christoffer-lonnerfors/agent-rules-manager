import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LogicalRule } from '../logical/logicalRule';
import { RuleFormat, RuleTrigger, FORMAT_LABELS } from '../formats/formatRegistry';
import {
  AgentId,
  AGENT_DEFINITIONS,
  getReadableFormats,
  getWritableFormats,
  getDefaultWriteFormat,
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
  | { type: 'agentChanged'; value: string }
  | { type: 'writeFormatChanged'; value: string }
  | { type: 'addRule' }
  | { type: 'showCoverage' }
  | { type: 'runSyncAll' }
  | { type: 'runAddAllMissing' }
  | { type: 'cancelCreate' }
  | { type: 'createRule'; name: string; trigger: string; location: string }
  | { type: 'browseFolderForRule' };

export class ActionsWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'agentRules.actionsView';

  private view?: vscode.WebviewView;
  private logicalRules: LogicalRule[] = [];
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly ruleIndex: RuleStore) {
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

    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      switch (msg.type) {
        case 'agentChanged':
          vscode.workspace
            .getConfiguration('agentRules')
            .update('agent', msg.value, vscode.ConfigurationTarget.Workspace);
          break;
        case 'writeFormatChanged':
          vscode.workspace
            .getConfiguration('agentRules')
            .update('writeFormat', msg.value, vscode.ConfigurationTarget.Workspace);
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

    const agents = AGENT_DEFINITIONS.map((a) => ({ id: a.id, label: a.label }));

    let availableFormats: ActionsViewState['availableFormats'] = [];
    let writeFormat = '';

    if (agent) {
      const writable = getWritableFormats(agent as AgentId);
      const defaultFmt = getDefaultWriteFormat(agent as AgentId);
      writeFormat = getEffectiveWriteFormat(agent as AgentId, writeFormatOverride);

      availableFormats = writable.map((f) => ({
        id: f,
        label: FORMAT_LABELS[f],
        isDefault: f === defaultFmt,
      }));
    }

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
      agents,
      writeFormat,
      availableFormats,
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
    };
  }

  private async postState(): Promise<void> {
    if (!this.view) {
      return;
    }
    const state = await this.computeState();
    this.view.webview.postMessage({ type: 'updateState', state });
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

  private getHtml(): string {
    return /* html */ `<!DOCTYPE html>
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

  select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

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
    <button class="btn-secondary" id="showCoverageBtn" title="Analyse token cost of rules across workspace files" style="margin-top:6px">Generate Coverage Report</button>
  </div>

  <div id="bannersSection"></div>

  <div id="emptySection" class="empty-state" style="display:none">
    Select an agent to enable rule creation and coverage checks.
  </div>

  <hr class="divider">
  <div id="footer" class="footer"></div>
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

  // ── Main view elements ──
  const mainView = document.getElementById('mainView');
  const agentSelect = document.getElementById('agentSelect');
  const formatSection = document.getElementById('formatSection');
  const formatSelect = document.getElementById('formatSelect');
  const addRuleSection = document.getElementById('addRuleSection');
  const addRuleBtn = document.getElementById('addRuleBtn');
  const bannersSection = document.getElementById('bannersSection');
  const emptySection = document.getElementById('emptySection');
  const footer = document.getElementById('footer');

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

  agentSelect.addEventListener('change', () => {
    vscode.postMessage({ type: 'agentChanged', value: agentSelect.value });
  });
  formatSelect.addEventListener('change', () => {
    vscode.postMessage({ type: 'writeFormatChanged', value: formatSelect.value });
  });
  addRuleBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'addRule' });
  });
  document.getElementById('showCoverageBtn').addEventListener('click', () => {
    vscode.postMessage({ type: 'showCoverage' });
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
 * at least one file is in a readable format AND has no extension mismatch diagnostic.
 * (A file with wrong extension won't be read by the agent at runtime.)
 */
function isEffectivelyCovered(lr: LogicalRule, agentId: AgentId): boolean {
  const readable = getReadableFormats(agentId);
  return lr.rules.some(
    (r) => readable.includes(r.format) && !r.diagnostics.some((d) => d.id === 'extension-mismatch'),
  );
}
