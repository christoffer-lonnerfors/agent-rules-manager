import * as vscode from 'vscode';
import { LogicalRule, RuleFormat } from '../scanner/scannerTypes';
import { RuleIndex } from '../index/ruleIndex';
import { buildLogicalRules } from '../index/logicalRuleBuilder';
import { FORMAT_LABELS } from './ruleTreeProvider';

type ActionElement = FormatSelectorNode | ActionButtonNode;

interface FormatSelectorNode {
  type: 'formatSelector';
  format: RuleFormat | '';
}

interface ActionButtonNode {
  type: 'actionButton';
  action: 'syncAll' | 'addAllMissing';
  count: number;
  primaryFormat: RuleFormat | '';
}

export class ActionsTreeProvider implements vscode.TreeDataProvider<ActionElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ActionElement | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private logicalRules: LogicalRule[] = [];

  constructor(private readonly ruleIndex: RuleIndex) {
    ruleIndex.onDidChange(() => {
      this.logicalRules = buildLogicalRules(this.ruleIndex.getAll());
      this._onDidChangeTreeData.fire(undefined);
    });

    // Listen for config changes to rebuild
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('aiRules.primaryFormat') || e.affectsConfiguration('aiRules.detectDivergence')) {
        this._onDidChangeTreeData.fire(undefined);
      }
    });
  }

  private getPrimaryFormat(): RuleFormat | '' {
    return vscode.workspace.getConfiguration('aiRules').get<string>('primaryFormat', '') as RuleFormat | '';
  }

  private getDivergedCount(): number {
    const detectDivergence = vscode.workspace.getConfiguration('aiRules').get<boolean>('detectDivergence', true);
    if (!detectDivergence) { return 0; }
    return this.logicalRules.filter(lr => lr.rules.length > 1 && lr.minSimilarity < 1.0).length;
  }

  private getMissingCount(primaryFormat: RuleFormat): number {
    return this.logicalRules.filter(lr => !lr.formats.includes(primaryFormat)).length;
  }

  getTreeItem(element: ActionElement): vscode.TreeItem {
    switch (element.type) {
      case 'formatSelector':
        return this.createFormatSelectorItem(element);
      case 'actionButton':
        return this.createActionButtonItem(element);
    }
  }

  getChildren(element?: ActionElement): ActionElement[] {
    if (element) { return []; }

    const primaryFormat = this.getPrimaryFormat();

    const children: ActionElement[] = [
      { type: 'formatSelector', format: primaryFormat },
    ];

    const divergedCount = this.getDivergedCount();
    children.push({
      type: 'actionButton',
      action: 'syncAll',
      count: divergedCount,
      primaryFormat,
    });

    const missingCount = primaryFormat ? this.getMissingCount(primaryFormat as RuleFormat) : 0;
    children.push({
      type: 'actionButton',
      action: 'addAllMissing',
      count: missingCount,
      primaryFormat,
    });

    return children;
  }

  private createFormatSelectorItem(node: FormatSelectorNode): vscode.TreeItem {
    const label = node.format
      ? `Primary Format: ${FORMAT_LABELS[node.format as RuleFormat]}`
      : 'Select Primary Format…';

    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon('target');
    item.contextValue = 'primaryFormat';
    item.command = {
      command: 'aiRulesScanner.setPrimaryFormat',
      title: 'Set Primary Format',
    };
    return item;
  }

  private createActionButtonItem(node: ActionButtonNode): vscode.TreeItem {
    const isSyncAll = node.action === 'syncAll';
    const hasWork = node.count > 0;
    const hasFormat = !!node.primaryFormat;

    let label: string;
    let description: string;
    let iconId: string;

    if (isSyncAll) {
      label = hasWork ? 'Sync All Diverged' : 'Sync All';
      if (!hasFormat) {
        description = 'Select a format first';
      } else if (hasWork) {
        description = `${node.count} rule${node.count > 1 ? 's' : ''}`;
      } else {
        description = 'All aligned';
      }
      iconId = hasWork ? 'sync' : (!hasFormat ? 'sync' : 'pass');
    } else {
      const formatLabel = hasFormat ? FORMAT_LABELS[node.primaryFormat as RuleFormat] : '';
      label = hasWork ? `Add All Missing to ${formatLabel}` : (hasFormat ? `Add All to ${formatLabel}` : 'Add All');
      if (!hasFormat) {
        description = 'Select a format first';
      } else if (hasWork) {
        description = `${node.count} rule${node.count > 1 ? 's' : ''}`;
      } else {
        description = 'Full coverage';
      }
      iconId = hasWork ? 'add' : (!hasFormat ? 'add' : 'pass');
    }

    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = description;
    item.iconPath = new vscode.ThemeIcon(iconId, (!hasWork && hasFormat) ? new vscode.ThemeColor('charts.green') : undefined);

    if (hasWork && hasFormat) {
      item.command = {
        command: isSyncAll ? 'aiRulesScanner.syncAll' : 'aiRulesScanner.addAllMissing',
        title: label,
      };
    }

    item.contextValue = isSyncAll ? 'syncAll' : 'addAllMissing';
    return item;
  }

  /** Get logical rules missing the primary format */
  getMissingRules(primaryFormat: RuleFormat): LogicalRule[] {
    return this.logicalRules.filter(lr => !lr.formats.includes(primaryFormat));
  }

  /** Get diverged logical rules */
  getDivergedRules(): LogicalRule[] {
    const detectDivergence = vscode.workspace.getConfiguration('aiRules').get<boolean>('detectDivergence', true);
    if (!detectDivergence) { return []; }
    return this.logicalRules.filter(lr => lr.rules.length > 1 && lr.minSimilarity < 1.0);
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

