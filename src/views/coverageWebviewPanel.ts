import * as vscode from 'vscode';
import * as path from 'path';
import { CoverageState, CoverageModel, CoverageTreeNode } from '../coverage/coverageModel';
import { RuleIndex } from '../index/ruleIndex';
import { AgentId, getAgentConfig } from '../agents/agentConfig';

/** Messages sent from webview → extension */
type CoverageWebviewMessage = { type: 'openRule'; filePath: string };

/**
 * Manages a Coverage Analysis webview panel.
 * Each invocation opens a new tab so reports can be compared side-by-side.
 */
export class CoverageWebviewPanel {
  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly ruleIndex: RuleIndex,
    private readonly extensionUri: vscode.Uri,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'agentRules.coverage',
      'Agent Rules Coverage Report',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    this.panel.webview.html = getLoadingHtml();

    this.panel.webview.onDidReceiveMessage(
      (msg: CoverageWebviewMessage) => {
        switch (msg.type) {
          case 'openRule':
            vscode.commands.executeCommand('vscode.open', vscode.Uri.file(msg.filePath));
            break;
        }
      },
      undefined,
      this.disposables,
    );

    this.panel.onDidDispose(() => {
      for (const d of this.disposables) {
        d.dispose();
      }
    });

    this.runAnalysis();
  }

  /** Open a new coverage report panel */
  static show(ruleIndex: RuleIndex, extensionUri: vscode.Uri): void {
    new CoverageWebviewPanel(ruleIndex, extensionUri);
  }

  private async runAnalysis(): Promise<void> {
    // Show loading state
    this.panel.webview.html = getLoadingHtml();

    const cfg = vscode.workspace.getConfiguration('agentRules');
    const agentId = cfg.get<string>('agent', '') as AgentId | '';
    const contextWindowTokens = cfg.get<number>('coverage.contextWindowTokens', 128000);

    const agentLabel = agentId ? getAgentConfig(agentId as AgentId).label : '(all agents)';

    // Build model
    const model = new CoverageModel();
    model.rebuild(this.ruleIndex.getAll(), agentId ? (agentId as AgentId) : undefined);

    // Enumerate workspace files
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this.panel.webview.postMessage({ type: 'error', message: 'No workspace folder open.' });
      return;
    }

    const rootUri = workspaceFolders[0].uri;
    const rootPath = rootUri.fsPath;

    // Find all files, respecting files.exclude and .gitignore
    const uris = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
    const relativePaths = uris
      .map((u) => {
        const rel = u.fsPath
          .substring(rootPath.length + 1)
          .split('\\')
          .join('/');
        return rel;
      })
      .filter((p) => p.length > 0)
      .sort();

    // Build coverage tree
    const state = model.buildTree(relativePaths, contextWindowTokens, agentLabel);

    // Build codicon CSS URI for the webview
    const codiconCssPath = vscode.Uri.file(
      path.join(
        this.extensionUri.fsPath,
        'node_modules',
        '@vscode',
        'codicons',
        'dist',
        'codicon.css',
      ),
    );
    const codiconCssUri = this.panel.webview.asWebviewUri(codiconCssPath);

    // Send to webview
    this.panel.webview.html = getAnalysisHtml(state, codiconCssUri);
  }
}

// ── HTML Generation ────────────────────────────────────────────────────

function getLoadingHtml(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    display: flex; align-items: center; justify-content: center;
    height: 100vh; margin: 0;
  }
  .loading { text-align: center; opacity: 0.7; }
  .spinner { font-size: 24px; animation: spin 1s linear infinite; display: inline-block; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <div class="loading">
    <div class="spinner">&#8635;</div>
    <div style="margin-top:12px">Generating coverage report...</div>
  </div>
</body>
</html>`;
}

function getAnalysisHtml(state: CoverageState, codiconCssUri: vscode.Uri): string {
  const s = state.summary;
  const pct = (tokens: number) => ((tokens / s.contextWindowTokens) * 100).toFixed(1);
  const fmt = (tokens: number) => (tokens < 1000 ? `${tokens}` : `${(tokens / 1000).toFixed(1)}k`);

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link rel="stylesheet" type="text/css" href="${codiconCssUri}">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 16px 24px;
    line-height: 1.5;
  }

  .header { margin-bottom: 16px; }
  .header h1 {
    font-size: 16px; font-weight: 600; margin-bottom: 8px;
    display: flex; align-items: center; gap: 12px;
  }
  .header-meta { font-size: 12px; color: var(--vscode-descriptionForeground); }
  .header-meta span { margin-right: 16px; }



  .tree { font-family: var(--vscode-editor-font-family, monospace); font-size: 13px; }
  .tree-row {
    display: flex; align-items: center; padding: 1px 4px;
    cursor: default; border-radius: 2px;
  }
  .tree-row:hover { background: var(--vscode-list-hoverBackground); }
  .tree-row.severity-warning { color: var(--vscode-editorWarning-foreground, #cca700); }
  .tree-row.severity-error { color: var(--vscode-editorError-foreground, #f14c4c); }

  .tree-toggle {
    width: 16px; text-align: center; cursor: pointer;
    user-select: none; flex-shrink: 0; opacity: 0.7;
  }
  .tree-toggle:empty { cursor: default; }
  .tree-icon { width: 18px; text-align: center; flex-shrink: 0; opacity: 0.8; display: inline-flex; align-items: center; justify-content: center; }
  .detail-rule-icon { margin-right: 4px; flex-shrink: 0; }
  .tree-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tree-cost {
    flex-shrink: 0; text-align: right; min-width: 70px;
    margin-left: 12px; opacity: 0.8; font-size: 12px;
  }
  .tree-children { display: none; }
  .tree-children.expanded { display: block; }

  .detail-panel {
    position: fixed; right: 24px; top: 80px;
    width: 340px; max-height: calc(100vh - 100px);
    overflow-y: auto; background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border, rgba(128,128,128,0.3)));
    border-radius: 4px; padding: 12px 16px;
    font-size: 12px; display: none; z-index: 100;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  }
  .detail-panel.visible { display: block; }
  .detail-panel h3 { font-size: 13px; margin-bottom: 8px; word-break: break-all; }
  .detail-section { margin-bottom: 10px; }
  .detail-section-title {
    font-size: 11px; font-weight: 600; text-transform: uppercase;
    letter-spacing: 0.5px; opacity: 0.7; margin-bottom: 4px;
  }
  .detail-rule {
    display: flex; justify-content: space-between; padding: 2px 0; cursor: pointer;
  }
  .detail-rule:hover { text-decoration: underline; }
  .detail-rule-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .detail-rule-tokens { flex-shrink: 0; margin-left: 8px; opacity: 0.7; }
  .detail-glob { font-size: 10px; opacity: 0.5; margin-top: -2px; margin-bottom: 2px; }
  .detail-total {
    font-weight: 600; border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
    padding-top: 4px; margin-top: 4px; display: flex; justify-content: space-between;
  }

  .footer {
    margin-top: 16px; padding-top: 12px;
    border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,0.2));
    font-size: 12px; color: var(--vscode-descriptionForeground);
  }
</style>
</head>
<body>
  <div class="header">
    <h1>
      Agent Rules Coverage Report
    </h1>
    <div class="header-meta">
      <span>Agent: ${escHtml(state.agentLabel)}</span>
      <span>Context: ${fmt(s.contextWindowTokens)} tokens</span>
      <span>Baseline: ~${fmt(s.baselineTokens)} tokens (${s.baselineRuleCount} rule${s.baselineRuleCount !== 1 ? 's' : ''})</span>
      ${s.potentialRuleCount > 0 ? `<span>Potential: ~${fmt(s.potentialTokens)} tokens (${s.potentialRuleCount} rule${s.potentialRuleCount !== 1 ? 's' : ''})</span>` : ''}
    </div>
  </div>

  <div class="tree" id="tree">
    ${renderTreeChildren(state.tree.children, 0, s.contextWindowTokens, fmt)}
  </div>

  <div class="detail-panel" id="detailPanel"></div>

  ${s.hottestFile ? `<div class="footer">Hottest file: ${escHtml(s.hottestFile.path)} &mdash; ~${fmt(s.hottestFile.tokens)} tokens (${pct(s.hottestFile.tokens)}% of ${fmt(s.contextWindowTokens)})</div>` : ''}

<script>
  const vscode = acquireVsCodeApi();
  const coverageData = ${JSON.stringify(buildCoverageMap(state.tree))};

  // Toggle expand/collapse
  document.getElementById('tree').addEventListener('click', (e) => {
    const toggle = e.target.closest('.tree-toggle');
    if (toggle) {
      const row = toggle.closest('.tree-item');
      const children = row.querySelector(':scope > .tree-children');
      if (children) {
        const isExpanded = children.classList.toggle('expanded');
        toggle.textContent = isExpanded ? '▾' : '▸';
      }
    }
  });

  // Show detail panel on row click
  document.getElementById('tree').addEventListener('click', (e) => {
    if (e.target.closest('.tree-toggle')) return;
    const row = e.target.closest('.tree-row');
    if (!row) return;
    const path = row.dataset.path;
    if (path === undefined) return;
    showDetail(path);
  });

  // Close detail panel when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.tree-row') && !e.target.closest('.detail-panel')) {
      document.getElementById('detailPanel').classList.remove('visible');
    }
  });

  function showDetail(filePath) {
    const panel = document.getElementById('detailPanel');
    const cov = coverageData[filePath];
    if (!cov) { panel.classList.remove('visible'); return; }

    let html = '<h3>' + escH(filePath || '(root)') + '</h3>';

    if (cov.alwaysRules && cov.alwaysRules.length > 0) {
      html += renderDetailSection('Always-on', cov.alwaysRules);
    }
    if (cov.globRules && cov.globRules.length > 0) {
      html += renderDetailSection('Glob-matched', cov.globRules);
    }
    if (cov.agentRequestedRules && cov.agentRequestedRules.length > 0) {
      html += renderDetailSection('Potential (agent-requested)', cov.agentRequestedRules);
    }

    html += '<div class="detail-total"><span>TOTAL</span><span>~' + cov.tokens + '</span></div>';

    panel.innerHTML = html;
    panel.classList.add('visible');

    // Wire up click-to-open on rule names
    panel.querySelectorAll('.detail-rule').forEach(el => {
      el.addEventListener('click', () => {
        vscode.postMessage({ type: 'openRule', filePath: el.dataset.rulepath });
      });
    });
  }

  function renderDetailSection(title, rules) {
    let html = '<div class="detail-section">';
    html += '<div class="detail-section-title">' + escH(title) + '</div>';
    let sum = 0;
    for (const r of rules) {
      html += '<div class="detail-rule" data-rulepath="' + escA(r.filePath) + '">';
      html += '<span class="detail-rule-icon codicon codicon-book"></span>';
      html += '<span class="detail-rule-name">' + escH(r.name) + '</span>';
      html += '<span class="detail-rule-tokens">~' + r.tokens + '</span>';
      html += '</div>';
      if (r.globs && r.globs.length > 0) {
        html += '<div class="detail-glob">' + escH(r.globs.join(', ')) + '</div>';
      }
      sum += r.tokens;
    }
    html += '<div style="text-align:right;opacity:0.6;font-size:11px;margin-top:2px">~' + sum + '</div>';
    html += '</div>';
    return html;
  }

  function escH(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  function escA(s) { return s.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;'); }
</script>
</body>
</html>`;
}

/** Determine severity class based on token cost as % of context window */
function severityClass(tokens: number, contextWindow: number): string {
  const ratio = tokens / contextWindow;
  if (ratio >= 0.15) {
    return 'severity-error';
  }
  if (ratio >= 0.05) {
    return 'severity-warning';
  }
  return '';
}

/** Render tree nodes as HTML */
function renderTreeChildren(
  nodes: CoverageTreeNode[],
  depth: number,
  contextWindow: number,
  fmt: (n: number) => string,
): string {
  let html = '';
  for (const node of nodes) {
    const indent = depth * 20;
    const severity = severityClass(node.tokens, contextWindow);
    const isDir = node.isDirectory;

    html += `<div class="tree-item">`;
    html += `<div class="tree-row ${severity}" style="padding-left:${indent}px" data-path="${escHtml(node.path)}">`;

    if (isDir) {
      html += `<span class="tree-toggle">&#9656;</span>`;
      html += `<span class="tree-icon"><span class="codicon codicon-folder"></span></span>`;
    } else {
      html += `<span class="tree-toggle"></span>`;
      html += `<span class="tree-icon"><span class="codicon codicon-file"></span></span>`;
    }

    html += `<span class="tree-name">${escHtml(node.name)}${isDir ? '/' : ''}</span>`;
    html += `<span class="tree-cost">~${fmt(node.tokens)}</span>`;
    html += `</div>`;

    if (isDir && node.children.length > 0) {
      html += `<div class="tree-children">`;
      html += renderTreeChildren(node.children, depth + 1, contextWindow, fmt);
      html += `</div>`;
    }

    html += `</div>`;
  }
  return html;
}

/**
 * Build a flat map of path → coverage data for the detail panel JS.
 * Only includes file nodes (directories don't have their own coverage).
 */
function buildCoverageMap(root: CoverageTreeNode): Record<string, unknown> {
  const map: Record<string, unknown> = {};

  function walk(node: CoverageTreeNode): void {
    if (!node.isDirectory && node.coverage) {
      map[node.path] = {
        tokens: node.coverage.tokens,
        alwaysRules: node.coverage.alwaysRules,
        globRules: node.coverage.globRules,
        agentRequestedRules: node.coverage.agentRequestedRules,
      };
    }
    for (const child of node.children) {
      walk(child);
    }
  }

  walk(root);
  return map;
}

function escHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
