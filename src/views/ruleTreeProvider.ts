import * as vscode from 'vscode';
import * as path from 'path';
import { LogicalRule } from '../logical/logicalRule';
import { RuleFormat, RuleTrigger, FORMAT_LABELS } from '../formats/formatRegistry';
import { ClassifiedFile } from '../scanner/classifiedFile';
import { getFormatDefinition } from '../formats/formatRegistry';
import { AgentId } from '../agents/agentRegistry';
import { RuleStore } from '../logical/ruleStore';
import {
  RuleIssue,
  hasIssue,
  getLogicalIssues,
  getFileIssues,
  dedupeFileIssues,
} from '../lint/ruleIssues';
import { computeIssues, LintConfig } from '../lint/lintEngine';
import { filterIssuesForAgent } from '../lint/agentFilter';
import {
  estimateTokens,
  estimateLogicalRuleTokens,
  formatTokenCount,
} from '../utils/tokenEstimator';

/** Custom URI scheme used to attach FileDecorations to tree items with issues */
const ISSUE_SCHEME = 'ai-rules-issue';

type TreeElement = FilterBannerNode | TriggerGroupNode | LogicalRuleNode | RuleFileNode;

interface FilterBannerNode {
  type: 'filterBanner';
  filterText: string;
}

interface TriggerGroupNode {
  type: 'trigger';
  trigger: RuleTrigger;
  count: number;
}

interface LogicalRuleNode {
  type: 'logical';
  logicalRule: LogicalRule;
  /** All issues for this logical rule (used for file-level children) */
  issues: RuleIssue[];
  /** Issues filtered to those relevant to the selected agent (used for badge, tooltip, description) */
  agentIssues: RuleIssue[];
}

interface RuleFileNode {
  type: 'file';
  rule: ClassifiedFile;
  /** Issues specific to this file (pre-filtered from the logical rule's issues) */
  issues: RuleIssue[];
}

// Re-export for backward compatibility
export { FORMAT_LABELS } from '../formats/formatRegistry';

const TRIGGER_LABELS: Record<RuleTrigger, string> = {
  always: 'Always Active',
  glob: 'File-Scoped',
  agent_requested: 'Agent Requested',
  manual: 'Manual',
};

const TRIGGER_ICONS: Record<RuleTrigger, string> = {
  always: 'circle-filled',
  glob: 'file-code',
  agent_requested: 'robot',
  manual: 'account',
};

export class RuleTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private logicalRules: LogicalRule[] = [];
  private extensionPath: string = '';
  /** Cached config — recomputed once per tree rebuild */
  private issueConfig: LintConfig = {
    agent: '',
    detectDivergence: true,
    lintEnabled: true,
    maxRuleTokens: 2000,
  };
  private issueDecoProvider?: RuleIssueDecorationProvider;
  private configDisposable: vscode.Disposable;

  /** Current filter text (empty = no filter) */
  private filterText: string = '';

  constructor(private readonly ruleIndex: RuleStore) {
    ruleIndex.onDidChange(() => {
      this.rebuildLogicalRules();
      this._onDidChangeTreeData.fire(undefined);
      this.issueDecoProvider?.fire();
    });

    // Rebuild tree when agent or lint settings change
    this.configDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('agentRules.agent') ||
        e.affectsConfiguration('agentRules.detectDivergence') ||
        e.affectsConfiguration('agentRules.lint')
      ) {
        this.rebuildLogicalRules();
        this._onDidChangeTreeData.fire(undefined);
        this.issueDecoProvider?.fire();
      }
    });
  }

  /** Link the decoration provider so it can be refreshed when issues change */
  setIssueDecorationProvider(provider: RuleIssueDecorationProvider): void {
    this.issueDecoProvider = provider;
  }

  setExtensionPath(extensionPath: string): void {
    this.extensionPath = extensionPath;
  }

  refresh(): void {
    this.rebuildLogicalRules();
    this._onDidChangeTreeData.fire(undefined);
  }

  /** Set a filter string — only rules matching the text (in description or file name) are shown */
  setFilter(text: string): void {
    this.filterText = text.toLowerCase();
    this._onDidChangeTreeData.fire(undefined);
    this.issueDecoProvider?.fire();
    // Set context key so the clear-filter button can conditionally appear
    vscode.commands.executeCommand(
      'setContext',
      'agentRules.filterActive',
      this.filterText.length > 0,
    );
  }

  /** Clear the active filter */
  clearFilter(): void {
    this.setFilter('');
  }

  /** Check whether a logical rule matches the current filter */
  private matchesFilter(lr: LogicalRule): boolean {
    if (!this.filterText) {
      return true;
    }
    // Match against logical rule description
    if (lr.description.toLowerCase().includes(this.filterText)) {
      return true;
    }
    // Match against any child file name or relative path
    for (const rule of lr.rules) {
      if (rule.fileName.toLowerCase().includes(this.filterText)) {
        return true;
      }
      const relPath = vscode.workspace.asRelativePath(rule.filePath, false).toLowerCase();
      if (relPath.includes(this.filterText)) {
        return true;
      }
    }
    return false;
  }

  private getFormatIconPath(format: RuleFormat): { light: vscode.Uri; dark: vscode.Uri } {
    const iconFile = getFormatDefinition(format).icon + '.svg';
    return {
      light: vscode.Uri.file(
        path.join(this.extensionPath, 'resources', 'icons', 'light', iconFile),
      ),
      dark: vscode.Uri.file(path.join(this.extensionPath, 'resources', 'icons', 'dark', iconFile)),
    };
  }

  private rebuildLogicalRules(): void {
    this.logicalRules = this.ruleIndex.getLogicalRules();
    this.issueConfig = this.readIssueConfig();
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    switch (element.type) {
      case 'filterBanner':
        return this.createFilterBannerItem(element);
      case 'trigger':
        return this.createTriggerItem(element);
      case 'logical':
        return this.createLogicalRuleItem(element);
      case 'file':
        return this.createFileItem(element);
    }
  }

  getChildren(element?: TreeElement): TreeElement[] | Promise<TreeElement[]> {
    if (!element) {
      const children: TreeElement[] = [];
      // Show a dismissable filter banner when a filter is active
      if (this.filterText) {
        children.push({ type: 'filterBanner', filterText: this.filterText });
      }
      children.push(...this.getTriggerGroups());
      return children;
    }
    if (element.type === 'trigger') {
      return this.getLogicalRulesForTrigger(element.trigger);
    }
    if (element.type === 'logical') {
      return this.getFilesForLogicalRule(element);
    }
    return [];
  }

  private getTriggerGroups(): TriggerGroupNode[] {
    const triggers = new Map<RuleTrigger, number>();

    // Count only rules that pass the filter
    for (const lr of this.logicalRules) {
      if (!this.matchesFilter(lr)) {
        continue;
      }
      triggers.set(lr.trigger, (triggers.get(lr.trigger) || 0) + 1);
    }

    // Fixed order: always, glob, agent_requested, manual
    const order: RuleTrigger[] = ['always', 'glob', 'agent_requested', 'manual'];
    return order
      .filter((t) => triggers.has(t))
      .map((trigger) => ({
        type: 'trigger' as const,
        trigger,
        count: triggers.get(trigger)!,
      }));
  }

  private async getLogicalRulesForTrigger(trigger: RuleTrigger): Promise<LogicalRuleNode[]> {
    const filtered = this.logicalRules
      .filter((lr) => lr.trigger === trigger && this.matchesFilter(lr))
      .sort((a, b) => a.description.localeCompare(b.description));

    return Promise.all(
      filtered.map(async (logicalRule) => {
        const issues = await computeIssues(logicalRule, this.issueConfig);
        return {
          type: 'logical' as const,
          logicalRule,
          issues,
          agentIssues: filterIssuesForAgent(issues, logicalRule, this.issueConfig.agent),
        };
      }),
    );
  }

  private getFilesForLogicalRule(node: LogicalRuleNode): RuleFileNode[] {
    const { logicalRule, issues } = node;
    return logicalRule.rules.map((rule) => ({
      type: 'file' as const,
      rule,
      issues: getFileIssues(issues, rule.id),
    }));
  }

  private createFilterBannerItem(node: FilterBannerNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      `Filter: "${node.filterText}"`,
      vscode.TreeItemCollapsibleState.None,
    );
    item.iconPath = new vscode.ThemeIcon('close');
    item.tooltip = 'Click to clear the filter';
    item.contextValue = 'filterBanner';
    item.command = {
      command: 'agentRules.clearFilter',
      title: 'Clear Filter',
    };
    return item;
  }

  private createTriggerItem(node: TriggerGroupNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      `${TRIGGER_LABELS[node.trigger]} (${node.count})`,
      vscode.TreeItemCollapsibleState.Expanded,
    );

    // Show aggregate token estimate for this trigger group
    const groupRules = this.logicalRules.filter((lr) => lr.trigger === node.trigger);
    const totalTokens = groupRules.reduce(
      (sum, lr) => sum + estimateLogicalRuleTokens(lr.rules),
      0,
    );
    if (totalTokens > 0) {
      item.description = formatTokenCount(totalTokens);
    }

    item.iconPath = new vscode.ThemeIcon(TRIGGER_ICONS[node.trigger]);
    item.contextValue = 'trigger';
    return item;
  }

  /** Build the LintConfig from current workspace settings */
  private readIssueConfig(): LintConfig {
    const cfg = vscode.workspace.getConfiguration('agentRules');
    return {
      agent: cfg.get<string>('agent', '') as AgentId | '',
      detectDivergence: cfg.get<boolean>('detectDivergence', true),
      lintEnabled: cfg.get<boolean>('lint.enabled', true),
      maxRuleTokens: cfg.get<number>('lint.maxRuleTokens', 2000),
    };
  }

  private createLogicalRuleItem(node: LogicalRuleNode): vscode.TreeItem {
    const { logicalRule, agentIssues } = node;
    const formatList = logicalRule.formats.map((f) => FORMAT_LABELS[f]).join(', ');

    // Use agent-filtered issues for display (badge, description, tooltip)
    const hasIssues = agentIssues.length > 0;
    const isDiverged = hasIssue(agentIssues, 'diverged-content');
    const isMissing = hasIssue(agentIssues, 'missing-primary');

    // If only one file, make it non-collapsible and directly openable
    const hasMultipleFiles = logicalRule.rules.length > 1;
    const collapsibleState = hasMultipleFiles
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;

    const item = new vscode.TreeItem(logicalRule.description, collapsibleState);

    // Description shows format list, plus ❌ if missing from primary
    item.description = isMissing ? `${formatList}  ❌` : formatList;

    // Token estimate for the logical rule
    const ruleTokens = estimateLogicalRuleTokens(logicalRule.rules);

    // Tooltip: base info + token estimate + agent-filtered issue messages
    const tooltipLines = [
      `**${logicalRule.description}**`,
      `Trigger: ${TRIGGER_LABELS[logicalRule.trigger]}`,
      logicalRule.globs?.length ? `Globs: ${logicalRule.globs.join(', ')}` : '',
      `Formats: ${formatList}`,
      `Files: ${logicalRule.rules.length}`,
      `Size: ${formatTokenCount(ruleTokens)}`,
    ];
    // Logical-level issues first, then de-duped file-level issues (agent-filtered)
    const displayIssues = [...getLogicalIssues(agentIssues), ...dedupeFileIssues(agentIssues)];
    for (const issue of displayIssues) {
      const icon = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
      tooltipLines.push(`${icon} ${issue.message}`);
    }
    item.tooltip = new vscode.MarkdownString(tooltipLines.filter(Boolean).join('\n\n'));

    // Icon: always use generic book icon for logical rules
    item.iconPath = new vscode.ThemeIcon('book');

    // If single file, click opens it directly
    if (!hasMultipleFiles) {
      item.command = {
        command: 'agentRules.openRule',
        title: 'Open Rule',
        arguments: [logicalRule.rules[0].filePath],
      };
    }

    // Attach custom URI so FileDecorationProvider can badge rules with issues
    // (only for agent-relevant issues)
    if (hasIssues) {
      item.resourceUri = vscode.Uri.parse(`${ISSUE_SCHEME}:/${logicalRule.id}`);
    }

    // Build compound contextValue so multiple when-clause flags can coexist
    // e.g. 'logicalRule.diverged.missing' matches both /diverged/ and /missing/
    const flags: string[] = [];
    if (isDiverged) {
      flags.push('diverged');
    }
    if (isMissing) {
      flags.push('missing');
    }
    item.contextValue = flags.length > 0 ? `logicalRule.${flags.join('.')}` : 'logicalRule';

    return item;
  }

  private createFileItem(node: RuleFileNode): vscode.TreeItem {
    const { rule, issues } = node;
    const hasFileIssues = issues.length > 0;

    const label = FORMAT_LABELS[rule.format];
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);

    const relativePath = vscode.workspace.asRelativePath(rule.filePath, false);
    const fileTokens = estimateTokens(rule.bodyLength);

    item.description = `${relativePath}  ${formatTokenCount(fileTokens)}`;
    item.iconPath = this.getFormatIconPath(rule.format);

    // Attach custom URI so FileDecorationProvider can badge files with issues
    if (hasFileIssues) {
      item.resourceUri = vscode.Uri.parse(`${ISSUE_SCHEME}:/${rule.id}`);
    }

    const tooltipLines = [
      `**${rule.fileName}**`,
      `Format: ${FORMAT_LABELS[rule.format]}`,
      `Path: ${relativePath}`,
      `Size: ${rule.fileSize} bytes | ${formatTokenCount(fileTokens)}`,
      `Modified: ${rule.lastModified}`,
    ];
    for (const issue of issues) {
      const icon = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '⚠️' : 'ℹ️';
      tooltipLines.push(`${icon} ${issue.message}`);
    }
    item.tooltip = new vscode.MarkdownString(tooltipLines.join('\n\n'));

    item.command = {
      command: 'agentRules.openRule',
      title: 'Open Rule',
      arguments: [rule.filePath],
    };

    item.contextValue = hasFileIssues ? 'ruleFile.issues' : 'ruleFile';
    return item;
  }

  /** Look up a logical rule by its ID (used by compare command) */
  getLogicalRuleById(id: string): LogicalRule | undefined {
    return this.logicalRules.find((lr) => lr.id === id);
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    this.configDisposable.dispose();
  }
}

/**
 * Adds a warning badge to logical-rule tree items that have any issues
 * (divergence, missing format, linter warnings, etc.).
 */
export class RuleIssueDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations = new vscode.EventEmitter<
    vscode.Uri | vscode.Uri[] | undefined
  >();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== ISSUE_SCHEME) {
      return undefined;
    }
    return {
      badge: '⚠',
      color: new vscode.ThemeColor('list.warningForeground'),
      tooltip: 'This rule has issues — expand tooltip for details',
    };
  }

  fire(uri?: vscode.Uri | vscode.Uri[]): void {
    this._onDidChangeFileDecorations.fire(uri);
  }

  dispose(): void {
    this._onDidChangeFileDecorations.dispose();
  }
}
