import * as vscode from 'vscode';
import * as fs from 'fs';
import { RuleStore } from './logical/ruleStore';
import { ScannerService } from './scanner/scannerService';
import { RuleTreeProvider, RuleIssueDecorationProvider } from './views/ruleTreeProvider';
import { ActionsWebviewProvider } from './views/actionsWebviewProvider';
import { LogicalRule, RuleFormat, FORMAT_LABELS } from './types';
import {
  AgentId,
  AGENT_CONFIGS,
  getAgentConfig,
  getReadableFormats,
  getEffectiveWriteFormat,
} from './agents/agentConfig';
import { parseFrontmatter } from './scanner/frontmatterParser';
import { FORMAT_DEFINITIONS } from './formats/formatRegistry';
import { toCaseInsensitiveGlob } from './scanner/treeWalker';
import { detectDominantAgent } from './agents/agentAutoDetector';
import { writeRuleFile } from './actions/ruleWriter';
import { CoverageWebviewPanel } from './views/coverageWebviewPanel';

/** Custom URI scheme for body-only virtual documents used in diff view */
const RULE_BODY_SCHEME = 'ai-rules-body';

export function activate(context: vscode.ExtensionContext) {
  // Initialize core services
  const ruleIndex = new RuleStore(context);
  const scannerService = new ScannerService(ruleIndex);
  const treeProvider = new RuleTreeProvider(ruleIndex);
  treeProvider.setExtensionPath(context.extensionPath);

  // Load persisted index from last session
  ruleIndex.load();

  // Register virtual document provider that serves rule body (no frontmatter)
  const bodyProvider = vscode.workspace.registerTextDocumentContentProvider(RULE_BODY_SCHEME, {
    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
      // The URI path encodes the real file path
      const realPath = uri.path;
      const realUri = vscode.Uri.file(realPath);
      const contentBytes = await vscode.workspace.fs.readFile(realUri);
      const content = Buffer.from(contentBytes).toString('utf-8');
      const { body } = parseFrontmatter(content);
      return body;
    },
  });

  // Register issue decoration provider (badges rules that have any issues)
  const issueDecoProvider = new RuleIssueDecorationProvider();
  const decoRegistration = vscode.window.registerFileDecorationProvider(issueDecoProvider);
  treeProvider.setIssueDecorationProvider(issueDecoProvider);

  // Register TreeViews
  const treeView = vscode.window.createTreeView('agentRules.rulesView', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  const actionsProvider = new ActionsWebviewProvider(ruleIndex);
  const actionsViewRegistration = vscode.window.registerWebviewViewProvider(
    ActionsWebviewProvider.viewType,
    actionsProvider,
  );

  // Register filter commands
  const filterCmd = vscode.commands.registerCommand('agentRules.filterRules', async () => {
    const value = await vscode.window.showInputBox({
      prompt: 'Filter rules by name, description, or file path',
      placeHolder: 'e.g. typescript, coding-standards',
      value: '',
    });
    if (value !== undefined) {
      treeProvider.setFilter(value);
    }
  });

  const clearFilterCmd = vscode.commands.registerCommand('agentRules.clearFilter', () => {
    treeProvider.clearFilter();
  });

  // Register commands
  const rescanCmd = vscode.commands.registerCommand('agentRules.rescan', async () => {
    await scannerService.scan();
  });

  const openRuleCmd = vscode.commands.registerCommand(
    'agentRules.openRule',
    async (filePath: string) => {
      if (filePath) {
        const uri = vscode.Uri.file(filePath);
        await vscode.window.showTextDocument(uri);
      }
    },
  );

  // Register compare-formats command for diverged rules
  const compareCmd = vscode.commands.registerCommand(
    'agentRules.compareFormats',
    async (node?: { type: string; logicalRule?: LogicalRule }) => {
      // Resolve the logical rule — from context menu node or fallback
      const logicalRule = node?.logicalRule;
      if (!logicalRule || logicalRule.rules.length < 2) {
        vscode.window.showInformationMessage(
          'Select a rule with multiple format versions to compare.',
        );
        return;
      }

      const rules = logicalRule.rules;

      // Helper to create a body-only virtual URI for diff
      const bodyUri = (filePath: string, format: string) =>
        vscode.Uri.parse(`${RULE_BODY_SCHEME}:${filePath}`).with({
          query: format, // used only for labeling
        });

      if (rules.length === 2) {
        // Exactly two files — open diff directly
        const leftLabel = FORMAT_LABELS[rules[0].format];
        const rightLabel = FORMAT_LABELS[rules[1].format];
        await vscode.commands.executeCommand(
          'vscode.diff',
          bodyUri(rules[0].filePath, rules[0].format),
          bodyUri(rules[1].filePath, rules[1].format),
          `${logicalRule.description}: ${leftLabel} ↔ ${rightLabel} (body only)`,
        );
      } else {
        // More than two files — pick left and right via Quick Pick
        const items = rules.map((r) => ({
          label: FORMAT_LABELS[r.format],
          description: vscode.workspace.asRelativePath(r.filePath, false),
          rule: r,
        }));

        const left = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select the LEFT side for comparison',
        });
        if (!left) {
          return;
        }

        const rightItems = items.filter((i) => i.rule.id !== left.rule.id);
        const right = await vscode.window.showQuickPick(rightItems, {
          placeHolder: 'Select the RIGHT side for comparison',
        });
        if (!right) {
          return;
        }

        await vscode.commands.executeCommand(
          'vscode.diff',
          bodyUri(left.rule.filePath, left.rule.format),
          bodyUri(right.rule.filePath, right.rule.format),
          `${logicalRule.description}: ${left.label} ↔ ${right.label} (body only)`,
        );
      }
    },
  );

  // Register align-formats command for diverged rules
  const alignCmd = vscode.commands.registerCommand(
    'agentRules.alignFormats',
    async (node?: { type: string; logicalRule?: LogicalRule }) => {
      const logicalRule = node?.logicalRule;
      if (!logicalRule || logicalRule.rules.length < 2) {
        vscode.window.showInformationMessage(
          'Select a rule with multiple format versions to align.',
        );
        return;
      }

      const rules = logicalRule.rules;

      // Detect mutual divergence (only relevant for >2 formats):
      // If all files have different body hashes, warn the user
      if (rules.length > 2) {
        const uniqueHashes = new Set(rules.map((r) => r.bodyHash));
        if (uniqueHashes.size === rules.length) {
          const proceed = await vscode.window.showWarningMessage(
            `All ${rules.length} format versions have different content. Manual review is recommended — consider using "Compare Formats" first to review differences.`,
            { modal: true },
            'Continue anyway',
          );
          if (proceed !== 'Continue anyway') {
            return;
          }
        }
      }

      // Build Quick Pick items sorted by lastModified descending
      const agentId = vscode.workspace.getConfiguration('agentRules').get<string>('agent', '') as
        | AgentId
        | '';
      const writeFormatOverride = vscode.workspace
        .getConfiguration('agentRules')
        .get<string>('writeFormat', '') as RuleFormat | '';
      const writeFormat = agentId
        ? getEffectiveWriteFormat(agentId as AgentId, writeFormatOverride)
        : '';
      const sorted = [...rules].sort(
        (a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
      );
      const latestId = sorted[0].id;

      const items = sorted.map((r) => {
        const labels: string[] = [];
        if (r.id === latestId) {
          labels.push('latest');
        }
        if (writeFormat && r.format === writeFormat) {
          labels.push('write format');
        }
        const suffix = labels.length > 0 ? ` (${labels.join(', ')})` : '';
        return {
          label: `${FORMAT_LABELS[r.format]}${suffix}`,
          description: vscode.workspace.asRelativePath(r.filePath, false),
          rule: r,
        };
      });

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select the source of truth — other formats will be aligned to this version',
      });
      if (!selected) {
        return;
      }

      // Only overwrite directory rules and cross-agent hierarchical files — other standalone/hierarchical files are read-only sources
      const allOthers = rules.filter((r) => r.id !== selected.rule.id);
      const isWritable = (r: {
        isHierarchical: boolean;
        isStandalone: boolean;
        format: RuleFormat;
      }) =>
        r.format !== 'document' &&
        ((!r.isHierarchical && !r.isStandalone) ||
          r.format === 'agents-md' ||
          r.format === 'claude-md');
      const targets = allOthers.filter(isWritable);
      const skipped = allOthers.filter((r) => !isWritable(r));

      if (targets.length === 0) {
        vscode.window.showWarningMessage(
          'No writable rule files to align — standalone and hierarchical files are read-only.',
        );
        return;
      }

      const targetNames = targets.map((t) => FORMAT_LABELS[t.format]).join(', ');
      let confirmMsg = `This will overwrite the body content of ${targets.length} file${targets.length > 1 ? 's' : ''} (${targetNames}) with the content from ${FORMAT_LABELS[selected.rule.format]}. Frontmatter will be preserved. This cannot be undone except through version control.`;
      if (skipped.length > 0) {
        const skippedNames = skipped
          .map((s) => vscode.workspace.asRelativePath(s.filePath, false))
          .join(', ');
        confirmMsg += ` (Skipping ${skipped.length} read-only file${skipped.length > 1 ? 's' : ''}: ${skippedNames})`;
      }
      const confirm = await vscode.window.showWarningMessage(confirmMsg, { modal: true }, 'Align');
      if (confirm !== 'Align') {
        return;
      }

      // Read the source file's body
      const sourceContent = fs.readFileSync(selected.rule.filePath, 'utf-8');
      const { body: sourceBody } = parseFrontmatter(sourceContent);

      // Overwrite each target file: preserve its frontmatter, replace body
      for (const target of targets) {
        const targetContent = fs.readFileSync(target.filePath, 'utf-8');
        const frontmatterMatch = targetContent.match(/^---[\r\n]+([\s\S]*?)[\r\n]+---[\r\n]*/);

        let newContent: string;
        if (frontmatterMatch) {
          // Preserve the frontmatter block, replace body
          newContent = frontmatterMatch[0] + sourceBody + '\n';
        } else {
          // No frontmatter — just replace the whole file with the source body
          newContent = sourceBody + '\n';
        }
        fs.writeFileSync(target.filePath, newContent, 'utf-8');
      }

      vscode.window.showInformationMessage(
        `Aligned ${targets.length} format${targets.length > 1 ? 's' : ''} to ${FORMAT_LABELS[selected.rule.format]}.`,
      );

      // Re-scan to update the index and tree view
      await scannerService.scan();
    },
  );

  // Helper to read the effective agent and write format from settings
  const readAgentSettings = () => {
    const cfg = vscode.workspace.getConfiguration('agentRules');
    const agentId = cfg.get<string>('agent', '') as AgentId | '';
    const writeFormatOverride = cfg.get<string>('writeFormat', '') as RuleFormat | '';
    const writeFormat = agentId
      ? getEffectiveWriteFormat(agentId as AgentId, writeFormatOverride)
      : ('' as RuleFormat | '');
    return { agentId, writeFormat };
  };

  // Register set-agent command
  const setAgentCmd = vscode.commands.registerCommand('agentRules.setAgent', async () => {
    const items = [
      { label: '(none)', description: 'No agent selected', value: '' },
      ...AGENT_CONFIGS.map((a) => ({
        label: a.label,
        description:
          a.supportedFormats.length > 0
            ? `Also reads: ${a.supportedFormats.map((f) => FORMAT_LABELS[f]).join(', ')}`
            : undefined,
        value: a.id,
      })),
    ];
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select the AI agent you use',
    });
    if (selected) {
      await vscode.workspace
        .getConfiguration('agentRules')
        .update('agent', selected.value, vscode.ConfigurationTarget.Workspace);
    }
  });

  // Register sync-all command
  const syncAllCmd = vscode.commands.registerCommand('agentRules.syncAll', async () => {
    const { agentId, writeFormat } = readAgentSettings();
    if (!agentId) {
      vscode.window.showWarningMessage('Select an agent first.');
      return;
    }

    const diverged = actionsProvider.getDivergedRules();
    if (diverged.length === 0) {
      vscode.window.showInformationMessage('All rules are aligned.');
      return;
    }

    // Find source of truth: prefer write format, fall back to any readable format
    const readableFormats = getReadableFormats(agentId as AgentId);
    const findSource = (lr: LogicalRule) => {
      // Prefer the write format version
      const writeSource = lr.rules.find((r) => r.format === writeFormat);
      if (writeSource) {
        return writeSource;
      }
      // Fall back to any version in a readable format
      return lr.rules.find((r) => readableFormats.includes(r.format));
    };

    const syncable = diverged.filter((lr) => findSource(lr) !== undefined);
    if (syncable.length === 0) {
      vscode.window.showWarningMessage(
        `No diverged rules have a version readable by ${getAgentConfig(agentId as AgentId).label} to sync from.`,
      );
      return;
    }

    // Only count writable targets (directory rules + cross-agent hierarchical files)
    const isSyncWritable = (r: {
      isHierarchical: boolean;
      isStandalone: boolean;
      format: RuleFormat;
    }) =>
      r.format !== 'document' &&
      ((!r.isHierarchical && !r.isStandalone) ||
        r.format === 'agents-md' ||
        r.format === 'claude-md');
    const totalTargets = syncable.reduce((sum, lr) => {
      const source = findSource(lr)!;
      return sum + lr.rules.filter((r) => r.id !== source.id && isSyncWritable(r)).length;
    }, 0);
    if (totalTargets === 0) {
      vscode.window.showWarningMessage(
        'No writable rule files to align — standalone and hierarchical files are read-only.',
      );
      return;
    }

    const sourceLabel =
      FORMAT_LABELS[writeFormat as RuleFormat] || getAgentConfig(agentId as AgentId).label;
    const confirm = await vscode.window.showWarningMessage(
      `Align ${syncable.length} diverged rule${syncable.length > 1 ? 's' : ''} — overwrite ${totalTargets} file${totalTargets > 1 ? 's' : ''} to match their ${sourceLabel} versions? Frontmatter will be preserved.`,
      { modal: true },
      'Align',
    );
    if (confirm !== 'Align') {
      return;
    }

    let aligned = 0;
    for (const lr of syncable) {
      const source = findSource(lr)!;
      const sourceContent = fs.readFileSync(source.filePath, 'utf-8');
      const { body: sourceBody } = parseFrontmatter(sourceContent);

      for (const target of lr.rules.filter((r) => r.id !== source.id && isSyncWritable(r))) {
        const targetContent = fs.readFileSync(target.filePath, 'utf-8');
        const frontmatterMatch = targetContent.match(/^---[\r\n]+([\s\S]*?)[\r\n]+---[\r\n]*/);
        const newContent = frontmatterMatch
          ? frontmatterMatch[0] + sourceBody + '\n'
          : sourceBody + '\n';
        fs.writeFileSync(target.filePath, newContent, 'utf-8');
        aligned++;
      }
    }

    vscode.window.showInformationMessage(`Aligned ${aligned} file${aligned > 1 ? 's' : ''}.`);
    await scannerService.scan();
  });

  // Register add-all-missing command
  const addAllMissingCmd = vscode.commands.registerCommand('agentRules.addAllMissing', async () => {
    const { agentId, writeFormat } = readAgentSettings();
    if (!agentId || !writeFormat) {
      vscode.window.showWarningMessage('Select an agent first.');
      return;
    }

    const missing = actionsProvider.getMissingRules(agentId as AgentId);
    if (missing.length === 0) {
      vscode.window.showInformationMessage(
        `Full coverage — all rules are readable by ${getAgentConfig(agentId as AgentId).label}.`,
      );
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Create ${missing.length} new rule file${missing.length > 1 ? 's' : ''} in ${FORMAT_LABELS[writeFormat]}?`,
      { modal: true },
      'Create',
    );
    if (confirm !== 'Create') {
      return;
    }

    const created: string[] = [];
    for (const lr of missing) {
      const filePath = writeRuleFile(lr, writeFormat);
      if (filePath) {
        created.push(filePath);
      }
    }

    if (created.length > 0) {
      vscode.window.showInformationMessage(
        `Created ${created.length} rule file${created.length > 1 ? 's' : ''} in ${FORMAT_LABELS[writeFormat]}.`,
      );
      // Open the first created file for review
      const uri = vscode.Uri.file(created[0]);
      await vscode.window.showTextDocument(uri);
      await scannerService.scan();
    }
  });

  // Register add-missing-rule command (single rule from top view)
  const addMissingRuleCmd = vscode.commands.registerCommand(
    'agentRules.addMissingRule',
    async (node?: { type: string; logicalRule?: LogicalRule }) => {
      const logicalRule = node?.logicalRule;
      if (!logicalRule) {
        return;
      }

      const { agentId, writeFormat } = readAgentSettings();
      if (!agentId || !writeFormat) {
        vscode.window.showWarningMessage('Select an agent first.');
        return;
      }

      const filePath = writeRuleFile(logicalRule, writeFormat);
      if (filePath) {
        const uri = vscode.Uri.file(filePath);
        await vscode.window.showTextDocument(uri);
        await scannerService.scan();
      }
    },
  );

  // Register add-rule command (opens the create-rule form in the Actions webview)
  const addRuleCmd = vscode.commands.registerCommand('agentRules.addRule', async () => {
    const { agentId } = readAgentSettings();
    if (!agentId) {
      vscode.window.showWarningMessage('Select an agent first.');
      return;
    }
    // Reveal the Actions webview and trigger the create form
    await vscode.commands.executeCommand('agentRules.actionsView.focus');
    actionsProvider.triggerCreateForm();
  });

  // Register show-coverage command
  const showCoverageCmd = vscode.commands.registerCommand('agentRules.showCoverage', () => {
    CoverageWebviewPanel.show(ruleIndex, context.extensionUri);
  });

  // Set up file system watchers derived from FORMAT_CONFIGS
  const watchers = createFileWatchers(scannerService);

  // Push all disposables
  context.subscriptions.push(
    treeView,
    actionsViewRegistration,
    bodyProvider,
    filterCmd,
    clearFilterCmd,
    rescanCmd,
    openRuleCmd,
    compareCmd,
    alignCmd,
    setAgentCmd,
    syncAllCmd,
    addAllMissingCmd,
    addMissingRuleCmd,
    addRuleCmd,
    showCoverageCmd,
    ruleIndex,
    scannerService,
    treeProvider,
    actionsProvider,
    issueDecoProvider,
    decoRegistration,
    ...watchers,
  );

  // Auto-scan on activation (silent — no notification).
  // After the first scan, auto-detect agent if none is configured.
  scannerService.scan({ silent: true }).then(() => {
    autoSelectAgentIfNeeded(ruleIndex);
  });
}

/**
 * Creates file system watchers for all rule file patterns derived from FORMAT_DEFINITIONS.
 * Triggers a debounced silent rescan on any create/change/delete.
 */
function createFileWatchers(scannerService: ScannerService): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  const debouncedRescan = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      scannerService.scan({ silent: true });
    }, 1000);
  };

  // Build unique watcher patterns from FORMAT_DEFINITIONS
  const patterns = new Set<string>();

  for (const def of FORMAT_DEFINITIONS) {
    if (def.isHierarchical) {
      // Hierarchical files (case-insensitive): e.g. **/[aA][gG][eE][nN][tT][sS].[mM][dD]
      for (const name of def.validNames) {
        patterns.add(`**/${toCaseInsensitiveGlob(name)}`);
      }
    } else if (def.validPaths.includes('.')) {
      // Standalone files at workspace root: e.g. .windsurfrules
      for (const name of def.validNames) {
        patterns.add(name);
      }
    } else {
      // Directory-based rules: e.g. **/.cursor/rules/**/*.mdc
      for (const dir of def.validPaths) {
        for (const ext of def.validExtensions) {
          patterns.add(`**/${dir}/**/*${ext}`);
        }
      }
    }
  }

  for (const pattern of patterns) {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidCreate(debouncedRescan);
    watcher.onDidChange(debouncedRescan);
    watcher.onDidDelete(debouncedRescan);
    disposables.push(watcher);
  }

  // Clean up the timer on dispose
  disposables.push({
    dispose: () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    },
  });

  return disposables;
}

/**
 * If no agent has been selected (setting is empty), analyse the scanned rules
 * and auto-select the dominant agent. Does nothing when:
 *   - The user has already chosen an agent in settings.
 *   - No agent-specific rule files were found.
 *   - There is an exact tie between agents.
 */
async function autoSelectAgentIfNeeded(ruleIndex: RuleStore): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('agentRules');
  const currentAgent = cfg.get<string>('agent', '');
  if (currentAgent) {
    // User has already selected / configured an agent — do not override.
    return;
  }

  const dominant = detectDominantAgent(ruleIndex.getAll());
  if (!dominant) {
    return;
  }

  await cfg.update('agent', dominant, vscode.ConfigurationTarget.Workspace);
}

export function deactivate() {
  // Nothing to clean up — disposables handle it
}
