import * as vscode from 'vscode';
import * as fs from 'fs';
import { RuleIndex } from './index/ruleIndex';
import { ScannerService } from './scanner/scannerService';
import { RuleTreeProvider, DivergedRuleDecorationProvider, FORMAT_LABELS } from './views/ruleTreeProvider';
import { LogicalRule } from './scanner/scannerTypes';
import { parseFrontmatter } from './scanner/frontmatterParser';

/** Custom URI scheme for body-only virtual documents used in diff view */
const RULE_BODY_SCHEME = 'ai-rules-body';

export function activate(context: vscode.ExtensionContext) {
  // Initialize core services
  const ruleIndex = new RuleIndex(context);
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

  // Register divergence decoration provider
  const divergedDecoProvider = new DivergedRuleDecorationProvider();
  const decoRegistration = vscode.window.registerFileDecorationProvider(divergedDecoProvider);

  // Register TreeView
  const treeView = vscode.window.createTreeView('aiRulesScanner.rulesView', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // Register commands
  const scanCmd = vscode.commands.registerCommand('aiRulesScanner.scan', async () => {
    await scannerService.scan();
  });

  const rescanCmd = vscode.commands.registerCommand('aiRulesScanner.rescan', async () => {
    await scannerService.scan();
  });

  const openRuleCmd = vscode.commands.registerCommand(
    'aiRulesScanner.openRule',
    async (filePath: string) => {
      if (filePath) {
        const uri = vscode.Uri.file(filePath);
        await vscode.window.showTextDocument(uri);
      }
    }
  );

  // Register compare-formats command for diverged rules
  const compareCmd = vscode.commands.registerCommand(
    'aiRulesScanner.compareFormats',
    async (node?: { type: string; logicalRule?: LogicalRule }) => {
      // Resolve the logical rule — from context menu node or fallback
      const logicalRule = node?.logicalRule;
      if (!logicalRule || logicalRule.rules.length < 2) {
        vscode.window.showInformationMessage('Select a rule with multiple format versions to compare.');
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
          `${logicalRule.description}: ${leftLabel} ↔ ${rightLabel} (body only)`
        );
      } else {
        // More than two files — pick left and right via Quick Pick
        const items = rules.map(r => ({
          label: FORMAT_LABELS[r.format],
          description: vscode.workspace.asRelativePath(r.filePath, false),
          rule: r,
        }));

        const left = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select the LEFT side for comparison',
        });
        if (!left) { return; }

        const rightItems = items.filter(i => i.rule.id !== left.rule.id);
        const right = await vscode.window.showQuickPick(rightItems, {
          placeHolder: 'Select the RIGHT side for comparison',
        });
        if (!right) { return; }

        await vscode.commands.executeCommand(
          'vscode.diff',
          bodyUri(left.rule.filePath, left.rule.format),
          bodyUri(right.rule.filePath, right.rule.format),
          `${logicalRule.description}: ${left.label} ↔ ${right.label} (body only)`
        );
      }
    }
  );

  // Register align-formats command for diverged rules
  const alignCmd = vscode.commands.registerCommand(
    'aiRulesScanner.alignFormats',
    async (node?: { type: string; logicalRule?: LogicalRule }) => {
      const logicalRule = node?.logicalRule;
      if (!logicalRule || logicalRule.rules.length < 2) {
        vscode.window.showInformationMessage('Select a rule with multiple format versions to align.');
        return;
      }

      const rules = logicalRule.rules;

      // Detect mutual divergence (only relevant for >2 formats):
      // If all files have different body hashes, warn the user
      if (rules.length > 2) {
        const uniqueHashes = new Set(rules.map(r => r.bodyHash));
        if (uniqueHashes.size === rules.length) {
          const proceed = await vscode.window.showWarningMessage(
            `All ${rules.length} format versions have different content. Manual review is recommended — consider using "Compare Formats" first to review differences.`,
            { modal: true },
            'Continue anyway'
          );
          if (proceed !== 'Continue anyway') {
            return;
          }
        }
      }

      // Build Quick Pick items sorted by lastModified descending
      const primaryFormat = vscode.workspace.getConfiguration('aiRules').get<string>('primaryFormat') || '';
      const sorted = [...rules].sort((a, b) =>
        new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
      );
      const latestId = sorted[0].id;

      const items = sorted.map(r => {
        const labels: string[] = [];
        if (r.id === latestId) { labels.push('latest'); }
        if (primaryFormat && r.format === primaryFormat) { labels.push('primary format'); }
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
      if (!selected) { return; }

      // Confirm before overwriting
      const targets = rules.filter(r => r.id !== selected.rule.id);
      const targetNames = targets.map(t => FORMAT_LABELS[t.format]).join(', ');
      const confirm = await vscode.window.showWarningMessage(
        `This will overwrite the body content of ${targets.length} file${targets.length > 1 ? 's' : ''} (${targetNames}) with the content from ${FORMAT_LABELS[selected.rule.format]}. Frontmatter will be preserved. This cannot be undone except through version control.`,
        { modal: true },
        'Align'
      );
      if (confirm !== 'Align') { return; }

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
        `Aligned ${targets.length} format${targets.length > 1 ? 's' : ''} to ${FORMAT_LABELS[selected.rule.format]}.`
      );

      // Re-scan to update the index and tree view
      await scannerService.scan();
    }
  );

  // Push all disposables
  context.subscriptions.push(
    treeView,
    bodyProvider,
    scanCmd,
    rescanCmd,
    openRuleCmd,
    compareCmd,
    alignCmd,
    ruleIndex,
    scannerService,
    treeProvider,
    divergedDecoProvider,
    decoRegistration,
  );
}

export function deactivate() {
  // Nothing to clean up — disposables handle it
}

