import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RuleIndex } from './index/ruleIndex';
import { ScannerService } from './scanner/scannerService';
import { RuleTreeProvider, DivergedRuleDecorationProvider, FORMAT_LABELS } from './views/ruleTreeProvider';
import { ActionsTreeProvider } from './views/actionsTreeProvider';
import { LogicalRule, RuleFormat } from './scanner/scannerTypes';
import { parseFrontmatter } from './scanner/frontmatterParser';
import { FORMAT_CONFIGS } from './scanner/formatDetector';
import { extractCommonDirectory } from './scanner/scopeTranslator';

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

  // Register TreeViews
  const treeView = vscode.window.createTreeView('aiRulesScanner.rulesView', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  const actionsProvider = new ActionsTreeProvider(ruleIndex);
  const actionsView = vscode.window.createTreeView('aiRulesScanner.actionsView', {
    treeDataProvider: actionsProvider,
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

  // Register set-primary-format command
  const setPrimaryFormatCmd = vscode.commands.registerCommand(
    'aiRulesScanner.setPrimaryFormat',
    async () => {
      const items = [
        { label: '(none)', description: 'No primary format', value: '' },
        ...(['cursor', 'windsurf', 'kiro', 'antigravity', 'augment', 'claude-code'] as RuleFormat[]).map(f => ({
          label: FORMAT_LABELS[f],
          value: f,
        })),
      ];
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select the primary AI agent format for this project',
      });
      if (selected) {
        await vscode.workspace.getConfiguration('aiRules').update('primaryFormat', selected.value, vscode.ConfigurationTarget.Workspace);
      }
    }
  );

  // Register sync-all command
  const syncAllCmd = vscode.commands.registerCommand(
    'aiRulesScanner.syncAll',
    async () => {
      const primaryFormat = vscode.workspace.getConfiguration('aiRules').get<string>('primaryFormat', '') as RuleFormat;
      if (!primaryFormat) {
        vscode.window.showWarningMessage('Set a primary format first.');
        return;
      }

      const diverged = actionsProvider.getDivergedRules();
      if (diverged.length === 0) {
        vscode.window.showInformationMessage('All rules are aligned.');
        return;
      }

      // Only sync rules that have the primary format version
      const syncable = diverged.filter(lr => lr.formats.includes(primaryFormat));
      if (syncable.length === 0) {
        vscode.window.showWarningMessage('No diverged rules have a version in the primary format to sync from.');
        return;
      }

      const totalTargets = syncable.reduce((sum, lr) => sum + lr.rules.filter(r => r.format !== primaryFormat).length, 0);
      const confirm = await vscode.window.showWarningMessage(
        `Align ${syncable.length} diverged rule${syncable.length > 1 ? 's' : ''} — overwrite ${totalTargets} file${totalTargets > 1 ? 's' : ''} to match their ${FORMAT_LABELS[primaryFormat]} versions? Frontmatter will be preserved.`,
        { modal: true },
        'Align'
      );
      if (confirm !== 'Align') { return; }

      for (const lr of syncable) {
        const source = lr.rules.find(r => r.format === primaryFormat)!;
        const sourceContent = fs.readFileSync(source.filePath, 'utf-8');
        const { body: sourceBody } = parseFrontmatter(sourceContent);

        for (const target of lr.rules.filter(r => r.format !== primaryFormat)) {
          const targetContent = fs.readFileSync(target.filePath, 'utf-8');
          const frontmatterMatch = targetContent.match(/^---[\r\n]+([\s\S]*?)[\r\n]+---[\r\n]*/);
          const newContent = frontmatterMatch
            ? frontmatterMatch[0] + sourceBody + '\n'
            : sourceBody + '\n';
          fs.writeFileSync(target.filePath, newContent, 'utf-8');
        }
      }

      vscode.window.showInformationMessage(`Aligned ${syncable.length} rule${syncable.length > 1 ? 's' : ''} to ${FORMAT_LABELS[primaryFormat]}.`);
      await scannerService.scan();
    }
  );

  // Register add-all-missing command
  const addAllMissingCmd = vscode.commands.registerCommand(
    'aiRulesScanner.addAllMissing',
    async () => {
      const primaryFormat = vscode.workspace.getConfiguration('aiRules').get<string>('primaryFormat', '') as RuleFormat;
      if (!primaryFormat) {
        vscode.window.showWarningMessage('Set a primary format first.');
        return;
      }

      const missing = actionsProvider.getMissingRules(primaryFormat);
      if (missing.length === 0) {
        vscode.window.showInformationMessage('Full coverage — all rules exist in ' + FORMAT_LABELS[primaryFormat] + '.');
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Create ${missing.length} new rule file${missing.length > 1 ? 's' : ''} in ${FORMAT_LABELS[primaryFormat]}?`,
        { modal: true },
        'Create'
      );
      if (confirm !== 'Create') { return; }

      const created: string[] = [];
      for (const lr of missing) {
        const filePath = scaffoldRuleFile(lr, primaryFormat);
        if (filePath) { created.push(filePath); }
      }

      if (created.length > 0) {
        vscode.window.showInformationMessage(`Created ${created.length} rule file${created.length > 1 ? 's' : ''} in ${FORMAT_LABELS[primaryFormat]}.`);
        // Open the first created file for review
        const uri = vscode.Uri.file(created[0]);
        await vscode.window.showTextDocument(uri);
        await scannerService.scan();
      }
    }
  );

  // Register add-missing-rule command (single rule from top view)
  const addMissingRuleCmd = vscode.commands.registerCommand(
    'aiRulesScanner.addMissingRule',
    async (node?: { type: string; logicalRule?: LogicalRule }) => {
      const logicalRule = node?.logicalRule;
      if (!logicalRule) { return; }

      const primaryFormat = vscode.workspace.getConfiguration('aiRules').get<string>('primaryFormat', '') as RuleFormat;
      if (!primaryFormat) {
        vscode.window.showWarningMessage('Set a primary format first.');
        return;
      }

      const filePath = scaffoldRuleFile(logicalRule, primaryFormat);
      if (filePath) {
        const uri = vscode.Uri.file(filePath);
        await vscode.window.showTextDocument(uri);
        await scannerService.scan();
      }
    }
  );

  // Push all disposables
  context.subscriptions.push(
    treeView,
    actionsView,
    bodyProvider,
    scanCmd,
    rescanCmd,
    openRuleCmd,
    compareCmd,
    alignCmd,
    setPrimaryFormatCmd,
    syncAllCmd,
    addAllMissingCmd,
    addMissingRuleCmd,
    ruleIndex,
    scannerService,
    treeProvider,
    actionsProvider,
    divergedDecoProvider,
    decoRegistration,
  );
}

/**
 * Scaffold a new rule file in the target format, copying body from the best available source.
 * Returns the absolute file path of the created file, or undefined on failure.
 */
function scaffoldRuleFile(logicalRule: LogicalRule, targetFormat: RuleFormat): string | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) { return undefined; }
  const root = workspaceFolders[0].uri.fsPath;

  // Get the body from the best available source (most recently modified)
  const sorted = [...logicalRule.rules].sort((a, b) =>
    new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
  );
  const source = sorted[0];
  const sourceContent = fs.readFileSync(source.filePath, 'utf-8');
  const { body: sourceBody } = parseFrontmatter(sourceContent);

  // Determine target directory and extension
  const config = FORMAT_CONFIGS.find(c => c.format === targetFormat);
  if (!config || config.directories.length === 0 && config.hierarchicalFiles.length === 0) { return undefined; }

  // Augment with glob-scoped rules: place AGENTS.md in the LCA directory
  // instead of creating a file in .augment/rules/
  if (targetFormat === 'augment' && logicalRule.trigger === 'glob' && logicalRule.globs?.length) {
    const lcaDir = extractCommonDirectory(logicalRule.globs);
    const targetDir = lcaDir ? path.join(root, lcaDir) : root;
    const targetPath = path.join(targetDir, 'AGENTS.md');

    // Don't overwrite existing AGENTS.md
    if (fs.existsSync(targetPath)) {
      // Append to existing file
      const existing = fs.readFileSync(targetPath, 'utf-8');
      const content = existing.trimEnd() + '\n\n---\n\n' + sourceBody + '\n';
      fs.writeFileSync(targetPath, content, 'utf-8');
    } else {
      fs.mkdirSync(targetDir, { recursive: true });
      // AGENTS.md has no frontmatter — plain markdown
      fs.writeFileSync(targetPath, sourceBody + '\n', 'utf-8');
    }
    return targetPath;
  }

  const targetDir = path.join(root, config.directories[0]);
  const targetExt = targetFormat === 'cursor' ? '.mdc' : '.md';

  // Generate filename from the logical rule description
  const slug = logicalRule.description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const targetPath = path.join(targetDir, slug + targetExt);

  // Ensure directory exists
  fs.mkdirSync(targetDir, { recursive: true });

  // Build frontmatter based on target format
  const frontmatter = buildFrontmatter(targetFormat, logicalRule);
  const content = frontmatter ? `---\n${frontmatter}---\n\n${sourceBody}\n` : sourceBody + '\n';

  fs.writeFileSync(targetPath, content, 'utf-8');
  return targetPath;
}

/**
 * Build format-specific YAML frontmatter for a logical rule.
 */
function buildFrontmatter(format: RuleFormat, lr: LogicalRule): string {
  const lines: string[] = [];

  switch (format) {
    case 'cursor':
      if (lr.trigger === 'always') {
        lines.push('alwaysApply: true');
      } else if (lr.trigger === 'glob' && lr.globs?.length) {
        lines.push('alwaysApply: false');
        lines.push('globs:');
        for (const g of lr.globs) { lines.push(`  - "${g}"`); }
      }
      if (lr.description) { lines.push(`description: "${lr.description}"`); }
      break;

    case 'windsurf':
    case 'antigravity':
      if (lr.trigger === 'always') {
        lines.push('trigger: always_on');
      } else if (lr.trigger === 'glob' && lr.globs?.length) {
        lines.push('trigger: glob');
        lines.push('globs:');
        for (const g of lr.globs) { lines.push(`  - "${g}"`); }
      } else if (lr.trigger === 'agent_requested') {
        lines.push('trigger: model_decision');
        if (lr.description) { lines.push(`description: "${lr.description}"`); }
      } else {
        lines.push('trigger: manual');
      }
      break;

    case 'kiro':
      if (lr.trigger === 'always') {
        lines.push('inclusion: always');
      } else if (lr.trigger === 'glob' && lr.globs?.length) {
        lines.push('inclusion: fileMatch');
        if (lr.globs.length === 1) {
          lines.push(`fileMatchPattern: "${lr.globs[0]}"`);
        } else {
          lines.push('fileMatchPattern:');
          for (const g of lr.globs) { lines.push(`  - "${g}"`); }
        }
      } else {
        lines.push('inclusion: manual');
      }
      break;

    case 'augment':
      if (lr.trigger === 'always') {
        lines.push('type: always_apply');
      } else if (lr.trigger === 'agent_requested') {
        lines.push('type: agent_requested');
        if (lr.description) { lines.push(`description: "${lr.description}"`); }
      } else {
        lines.push('type: manual');
      }
      break;

    case 'claude-code':
      if (lr.trigger === 'glob' && lr.globs?.length) {
        lines.push('paths:');
        for (const g of lr.globs) { lines.push(`  - "${g}"`); }
      }
      // No frontmatter needed for always-on rules in claude-code
      break;
  }

  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}

export function deactivate() {
  // Nothing to clean up — disposables handle it
}

