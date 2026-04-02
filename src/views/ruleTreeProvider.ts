import * as vscode from 'vscode';
import * as path from 'path';
import { IndexedRule, LogicalRule, RuleFormat, RuleTrigger } from '../scanner/scannerTypes';
import { RuleIndex } from '../index/ruleIndex';
import { buildLogicalRules } from '../index/logicalRuleBuilder';

/** Custom URI scheme used to attach FileDecorations to logical-rule tree items */
const DIVERGED_SCHEME = 'ai-rules-diverged';

type TreeElement = TriggerGroupNode | LogicalRuleNode | RuleFileNode;

interface TriggerGroupNode {
  type: 'trigger';
  trigger: RuleTrigger;
  count: number;
}

interface LogicalRuleNode {
  type: 'logical';
  logicalRule: LogicalRule;
}

interface RuleFileNode {
  type: 'file';
  rule: IndexedRule;
}

export const FORMAT_LABELS: Record<RuleFormat, string> = {
  'cursor': 'Cursor',
  'windsurf': 'Windsurf',
  'kiro': 'Kiro',
  'antigravity': 'Antigravity',
  'augment': 'Augment',
  'claude-code': 'Claude Code',
};

const TRIGGER_LABELS: Record<RuleTrigger, string> = {
  'always': 'Always Active',
  'glob': 'File-Scoped',
  'agent_requested': 'Agent Requested',
  'manual': 'Manual',
};

const TRIGGER_ICONS: Record<RuleTrigger, string> = {
  'always': 'circle-filled',
  'glob': 'file-code',
  'agent_requested': 'robot',
  'manual': 'account',
};

/** Map format keys to icon filenames */
const FORMAT_ICON_FILES: Record<RuleFormat, string> = {
  'cursor': 'cursor',
  'windsurf': 'windsurf',
  'kiro': 'kiro',
  'antigravity': 'antigravity',
  'augment': 'augment',
  'claude-code': 'claude-code',
};

export class RuleTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private logicalRules: LogicalRule[] = [];
  private extensionPath: string = '';

  constructor(private readonly ruleIndex: RuleIndex) {
    ruleIndex.onDidChange(() => {
      this.rebuildLogicalRules();
      this._onDidChangeTreeData.fire(undefined);
    });
  }

  setExtensionPath(extensionPath: string): void {
    this.extensionPath = extensionPath;
  }

  refresh(): void {
    this.rebuildLogicalRules();
    this._onDidChangeTreeData.fire(undefined);
  }

  private getFormatIconPath(format: RuleFormat): { light: vscode.Uri; dark: vscode.Uri } {
    const iconFile = FORMAT_ICON_FILES[format] + '.svg';
    return {
      light: vscode.Uri.file(path.join(this.extensionPath, 'resources', 'icons', 'light', iconFile)),
      dark: vscode.Uri.file(path.join(this.extensionPath, 'resources', 'icons', 'dark', iconFile)),
    };
  }

  private rebuildLogicalRules(): void {
    this.logicalRules = buildLogicalRules(this.ruleIndex.getAll());
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    switch (element.type) {
      case 'trigger':
        return this.createTriggerItem(element);
      case 'logical':
        return this.createLogicalRuleItem(element);
      case 'file':
        return this.createFileItem(element);
    }
  }

  getChildren(element?: TreeElement): TreeElement[] {
    if (!element) {
      return this.getTriggerGroups();
    }
    if (element.type === 'trigger') {
      return this.getLogicalRulesForTrigger(element.trigger);
    }
    if (element.type === 'logical') {
      return this.getFilesForLogicalRule(element.logicalRule);
    }
    return [];
  }

  private getTriggerGroups(): TriggerGroupNode[] {
    const triggers = new Map<RuleTrigger, number>();

    for (const lr of this.logicalRules) {
      triggers.set(lr.trigger, (triggers.get(lr.trigger) || 0) + 1);
    }

    // Fixed order: always, glob, agent_requested, manual
    const order: RuleTrigger[] = ['always', 'glob', 'agent_requested', 'manual'];
    return order
      .filter(t => triggers.has(t))
      .map(trigger => ({
        type: 'trigger' as const,
        trigger,
        count: triggers.get(trigger)!,
      }));
  }

  private getLogicalRulesForTrigger(trigger: RuleTrigger): LogicalRuleNode[] {
    return this.logicalRules
      .filter(lr => lr.trigger === trigger)
      .sort((a, b) => a.description.localeCompare(b.description))
      .map(logicalRule => ({ type: 'logical' as const, logicalRule }));
  }

  private getFilesForLogicalRule(logicalRule: LogicalRule): RuleFileNode[] {
    return logicalRule.rules.map(rule => ({ type: 'file' as const, rule }));
  }

  private createTriggerItem(node: TriggerGroupNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      `${TRIGGER_LABELS[node.trigger]} (${node.count})`,
      vscode.TreeItemCollapsibleState.Expanded
    );
    item.iconPath = new vscode.ThemeIcon(TRIGGER_ICONS[node.trigger]);
    item.contextValue = 'trigger';
    return item;
  }

  private createLogicalRuleItem(node: LogicalRuleNode): vscode.TreeItem {
    const { logicalRule } = node;
    const formatList = logicalRule.formats.map(f => FORMAT_LABELS[f]).join(', ');

    // If only one file, make it non-collapsible and directly openable
    const hasMultipleFiles = logicalRule.rules.length > 1;
    const collapsibleState = hasMultipleFiles
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;

    const item = new vscode.TreeItem(logicalRule.description, collapsibleState);

    // Tooltip
    const tooltipLines = [
      `**${logicalRule.description}**`,
      `Trigger: ${TRIGGER_LABELS[logicalRule.trigger]}`,
      logicalRule.globs?.length ? `Globs: ${logicalRule.globs.join(', ')}` : '',
      `Formats: ${formatList}`,
      `Files: ${logicalRule.rules.length}`,
    ];
    if (hasMultipleFiles && logicalRule.minSimilarity < 1.0) {
      tooltipLines.push(`⚠️ Content diverged — similarity: ${(logicalRule.minSimilarity * 100).toFixed(0)}%`);
    }
    item.tooltip = new vscode.MarkdownString(tooltipLines.filter(Boolean).join('\n\n'));

    // Icon: always use generic book icon for logical rules
    item.iconPath = new vscode.ThemeIcon('book');

    // If single file, click opens it directly
    if (!hasMultipleFiles) {
      item.command = {
        command: 'aiRulesScanner.openRule',
        title: 'Open Rule',
        arguments: [logicalRule.rules[0].filePath],
      };
    }

    // Attach custom URI so FileDecorationProvider can badge diverged rules
    if (hasMultipleFiles && logicalRule.minSimilarity < 1.0) {
      item.resourceUri = vscode.Uri.parse(`${DIVERGED_SCHEME}:/${logicalRule.id}`);
    }

    item.contextValue = 'logicalRule';
    return item;
  }

  private createFileItem(node: RuleFileNode): vscode.TreeItem {
    const { rule } = node;
    const item = new vscode.TreeItem(
      FORMAT_LABELS[rule.format],
      vscode.TreeItemCollapsibleState.None
    );

    // Show workspace-relative path instead of absolute
    item.description = vscode.workspace.asRelativePath(rule.filePath, false);
    item.iconPath = this.getFormatIconPath(rule.format);

    const relativePath = vscode.workspace.asRelativePath(rule.filePath, false);
    const tooltipLines = [
      `**${rule.fileName}**`,
      `Format: ${FORMAT_LABELS[rule.format]}`,
      `Path: ${relativePath}`,
      `Size: ${rule.fileSize} bytes`,
      `Modified: ${rule.lastModified}`,
    ];
    item.tooltip = new vscode.MarkdownString(tooltipLines.join('\n\n'));

    item.command = {
      command: 'aiRulesScanner.openRule',
      title: 'Open Rule',
      arguments: [rule.filePath],
    };

    item.contextValue = 'ruleFile';
    return item;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

/**
 * Adds a warning badge to logical-rule tree items whose merged
 * rules have diverged (similarity < 1.0).
 */
export class DivergedRuleDecorationProvider implements vscode.FileDecorationProvider {
  private _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== DIVERGED_SCHEME) {
      return undefined;
    }
    return {
      badge: '⚠',
      color: new vscode.ThemeColor('list.warningForeground'),
      tooltip: 'Rule content has diverged across formats — review & align',
    };
  }

  fire(uri?: vscode.Uri | vscode.Uri[]): void {
    this._onDidChangeFileDecorations.fire(uri);
  }

  dispose(): void {
    this._onDidChangeFileDecorations.dispose();
  }
}

