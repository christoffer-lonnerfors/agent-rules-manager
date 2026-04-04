import * as vscode from 'vscode';
import { LogicalRule, RuleFormat, AgentId, AGENT_LABELS, isRuleCoveredByAgent, getEffectiveWriteFormat, FORMAT_LABELS } from '../scanner/scannerTypes';
import { RuleIndex } from '../index/ruleIndex';

type ActionElement = AgentSelectorNode | ActionButtonNode;

interface AgentSelectorNode {
  type: 'agentSelector';
  agent: AgentId | '';
}

interface ActionButtonNode {
  type: 'actionButton';
  action: 'syncAll' | 'addAllMissing';
  count: number;
  agent: AgentId | '';
}

export class ActionsTreeProvider implements vscode.TreeDataProvider<ActionElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ActionElement | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private logicalRules: LogicalRule[] = [];

  constructor(private readonly ruleIndex: RuleIndex) {
    ruleIndex.onDidChange(() => {
      this.logicalRules = this.ruleIndex.getLogicalRules();
      this._onDidChangeTreeData.fire(undefined);
    });

    // Listen for config changes to rebuild
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('agentRules.agent') || e.affectsConfiguration('agentRules.writeFormat') || e.affectsConfiguration('agentRules.detectDivergence')) {
        this._onDidChangeTreeData.fire(undefined);
      }
    });
  }

  private getAgent(): AgentId | '' {
    return vscode.workspace.getConfiguration('agentRules').get<string>('agent', '') as AgentId | '';
  }

  private getDivergedCount(): number {
    const detectDivergence = vscode.workspace.getConfiguration('agentRules').get<boolean>('detectDivergence', true);
    if (!detectDivergence) { return 0; }
    return this.logicalRules.filter(lr => lr.rules.length > 1 && lr.minSimilarity < 1.0).length;
  }

  private getMissingCount(agent: AgentId): number {
    return this.logicalRules.filter(lr => !isRuleCoveredByAgent(lr.formats, agent)).length;
  }

  getTreeItem(element: ActionElement): vscode.TreeItem {
    switch (element.type) {
      case 'agentSelector':
        return this.createAgentSelectorItem(element);
      case 'actionButton':
        return this.createActionButtonItem(element);
    }
  }

  getChildren(element?: ActionElement): ActionElement[] {
    if (element) { return []; }

    const agent = this.getAgent();

    const children: ActionElement[] = [
      { type: 'agentSelector', agent },
    ];

    const divergedCount = this.getDivergedCount();
    children.push({
      type: 'actionButton',
      action: 'syncAll',
      count: divergedCount,
      agent,
    });

    const missingCount = agent ? this.getMissingCount(agent as AgentId) : 0;
    children.push({
      type: 'actionButton',
      action: 'addAllMissing',
      count: missingCount,
      agent,
    });

    return children;
  }

  private createAgentSelectorItem(node: AgentSelectorNode): vscode.TreeItem {
    const label = node.agent
      ? `Agent: ${AGENT_LABELS[node.agent as AgentId]}`
      : 'Select Agent…';

    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon('target');
    item.contextValue = 'agentSelector';
    item.command = {
      command: 'agentRules.setAgent',
      title: 'Select Agent',
    };

    // Show the write format as description if an agent is selected
    if (node.agent) {
      const writeFormatOverride = vscode.workspace.getConfiguration('agentRules').get<string>('writeFormat', '') as RuleFormat | '';
      const effectiveFormat = getEffectiveWriteFormat(node.agent as AgentId, writeFormatOverride);
      item.description = `writes to ${FORMAT_LABELS[effectiveFormat]}`;
    }

    return item;
  }

  private createActionButtonItem(node: ActionButtonNode): vscode.TreeItem {
    const isSyncAll = node.action === 'syncAll';
    const hasWork = node.count > 0;
    const hasAgent = !!node.agent;

    let label: string;
    let description: string;
    let iconId: string;

    if (isSyncAll) {
      label = hasWork ? 'Sync All Diverged' : 'Sync All';
      if (!hasAgent) {
        description = 'Select an agent first';
      } else if (hasWork) {
        description = `${node.count} rule${node.count > 1 ? 's' : ''}`;
      } else {
        description = 'All aligned';
      }
      iconId = hasWork ? 'sync' : (!hasAgent ? 'sync' : 'pass');
    } else {
      const agentLabel = hasAgent ? AGENT_LABELS[node.agent as AgentId] : '';
      label = hasWork ? `Add All Missing for ${agentLabel}` : (hasAgent ? `Add All for ${agentLabel}` : 'Add All');
      if (!hasAgent) {
        description = 'Select an agent first';
      } else if (hasWork) {
        description = `${node.count} rule${node.count > 1 ? 's' : ''}`;
      } else {
        description = 'Full coverage';
      }
      iconId = hasWork ? 'add' : (!hasAgent ? 'add' : 'pass');
    }

    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = description;
    item.iconPath = new vscode.ThemeIcon(iconId, (!hasWork && hasAgent) ? new vscode.ThemeColor('charts.green') : undefined);

    if (hasWork && hasAgent) {
      item.command = {
        command: isSyncAll ? 'agentRules.syncAll' : 'agentRules.addAllMissing',
        title: label,
      };
    }

    item.contextValue = isSyncAll ? 'syncAll' : 'addAllMissing';
    return item;
  }

  /** Get logical rules not readable by the agent */
  getMissingRules(agent: AgentId): LogicalRule[] {
    return this.logicalRules.filter(lr => !isRuleCoveredByAgent(lr.formats, agent));
  }

  /** Get diverged logical rules */
  getDivergedRules(): LogicalRule[] {
    const detectDivergence = vscode.workspace.getConfiguration('agentRules').get<boolean>('detectDivergence', true);
    if (!detectDivergence) { return []; }
    return this.logicalRules.filter(lr => lr.rules.length > 1 && lr.minSimilarity < 1.0);
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

