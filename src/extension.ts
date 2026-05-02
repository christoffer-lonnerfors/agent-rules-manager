import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { RuleStore } from './logical/ruleStore';
import { ScannerService } from './scanner/scannerService';
import { RuleTreeProvider, RuleIssueDecorationProvider } from './views/ruleTreeProvider';
import { ActionsWebviewProvider } from './views/actionsWebviewProvider';
import { LogicalRule } from './logical/logicalRule';
import { RuleFormat, FORMAT_LABELS } from './formats/formatRegistry';
import {
  AgentId,
  AGENT_DEFINITIONS,
  getAgentDefinition,
  getReadableFormats,
  getEffectiveWriteFormat,
} from './agents/agentRegistry';
import { parseFrontmatter } from './scanner/frontmatterParser';
import { FORMAT_DEFINITIONS } from './formats/formatRegistry';
import { toCaseInsensitiveGlob } from './scanner/treeWalker';
import { detectDominantAgent } from './agents/agentAutoDetector';
import { writeRuleFile, buildFrontmatter } from './actions/ruleWriter';
import { parseSections } from './actions/ruleSplitter';
import { CoverageWebviewPanel } from './views/coverageWebviewPanel';
import { AgentConfigWebviewPanel } from './views/agentConfigWebviewPanel';
import { ClassifiedFile } from './scanner/classifiedFile';
import { installMetaRule } from './actions/metaRuleInstaller';
import {
  buildRuleMetaComment,
  detectConflict,
  computeNamedFileContent,
  computeTargetPath,
  classifyFileAsLogicalRule,
  wrapClassifiedFileAsLogicalRule,
  getSourceBody,
} from './actions/ruleConverter';
import { exportCoverageToFile, exportCoverageToDefault } from './coverage/coverageExporter';
import { registerCoverageLmTool } from './coverage/coverageLmTool';
import {
  registerVsCodeMcpProvider,
  configureMcpForClaude,
  configureMcpForCursor,
  configureMcpForWindsurf,
  configureMcpForAgent,
} from './coverage/mcpServer';

/** Custom URI scheme for body-only virtual documents used in diff view */
const RULE_BODY_SCHEME = 'ai-rules-body';

/** Tree element shapes passed from RuleTreeProvider (structural typing). */
type RuleTreeSelection =
  | { type: 'file'; rule: ClassifiedFile }
  | { type: 'logical'; logicalRule: LogicalRule };

function resolveRuleTreeSelection(
  arg: unknown,
  treeView: { selection: readonly unknown[] },
): RuleTreeSelection | undefined {
  const node = arg !== undefined && arg !== null ? arg : treeView.selection[0];
  if (!node || typeof node !== 'object') {
    return undefined;
  }
  const o = node as { type?: string; rule?: ClassifiedFile; logicalRule?: LogicalRule };
  if (o.type === 'file' && o.rule) {
    return { type: 'file', rule: o.rule };
  }
  if (o.type === 'logical' && o.logicalRule) {
    return { type: 'logical', logicalRule: o.logicalRule };
  }
  return undefined;
}

type BulkConflictStrategy = 'replace' | 'skip' | 'ask';

async function writeRuleToFormat(
  logicalRule: LogicalRule,
  slug: string,
  targetFormat: RuleFormat,
  root: string,
  bulkStrategy: BulkConflictStrategy,
  bodyOverride?: string,
): Promise<'written' | 'skipped' | 'cancel-all'> {
  const body = bodyOverride ?? getSourceBody(logicalRule);
  const ruleMeta = buildRuleMetaComment(
    slug,
    logicalRule.globs,
    logicalRule.trigger,
    logicalRule.description,
  );

  const targetPath = computeTargetPath(logicalRule, targetFormat, root);

  if (!targetPath) {
    // ── Multi-file format ──────────────────────────────────────────────
    const config = FORMAT_DEFINITIONS.find((d) => d.id === targetFormat)!;
    const targetDir = path.join(root, config.validPaths[0]);
    const targetExt = config.validExtensions[0];
    const slugPath = path.join(targetDir, slug + targetExt);

    if (fs.existsSync(slugPath)) {
      if (bulkStrategy === 'skip') return 'skipped';
      if (bulkStrategy === 'ask') {
        const pick = await vscode.window.showQuickPick(['Replace', 'Skip', 'Cancel all'], {
          placeHolder: `${slug}${targetExt} already exists in target directory`,
        });
        if (!pick || pick === 'Cancel all') return 'cancel-all';
        if (pick === 'Skip') return 'skipped';
      }
      // 'replace' or user chose Replace — fall through to write
    }

    const frontmatter = buildFrontmatter(targetFormat, logicalRule);
    const content = frontmatter ? `---\n${frontmatter}---\n\n${body}\n` : body + '\n';
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(slugPath, content, 'utf-8');
    return 'written';
  }

  // ── Named-file format ────────────────────────────────────────────────
  const existingContent = fs.existsSync(targetPath)
    ? fs.readFileSync(targetPath, 'utf-8')
    : undefined;
  const conflict = detectConflict(existingContent, slug);

  let writeStrategy: 'create' | 'append' | 'replace';

  if (conflict === 'none') {
    writeStrategy = 'create';
  } else if (bulkStrategy === 'skip') {
    return 'skipped';
  } else if (bulkStrategy === 'replace') {
    writeStrategy = conflict === 'same-slug' ? 'replace' : 'append';
  } else {
    // 'ask'
    const isSameSlug = conflict === 'same-slug';
    const primaryLabel = isSameSlug ? 'Replace existing section' : 'Append as new section';
    const pick = await vscode.window.showQuickPick([primaryLabel, 'Skip', 'Cancel all'], {
      placeHolder: isSameSlug
        ? `${path.basename(targetPath)} already has a section for "${slug}"`
        : `${path.basename(targetPath)} exists but has no "${slug}" section`,
    });
    if (!pick || pick === 'Cancel all') return 'cancel-all';
    if (pick === 'Skip') return 'skipped';
    writeStrategy = isSameSlug ? 'replace' : 'append';
  }

  const newContent = computeNamedFileContent(existingContent, slug, ruleMeta, body, writeStrategy);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, newContent, 'utf-8');
  return 'written';
}

export function activate(context: vscode.ExtensionContext) {
  // Initialize core services
  const ruleIndex = new RuleStore(context);
  const scannerService = new ScannerService(ruleIndex);
  const treeProvider = new RuleTreeProvider(ruleIndex);
  treeProvider.setExtensionPath(context.extensionPath);

  // Load persisted index from last session
  void ruleIndex.load();

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

  // Register virtual document provider that serves computed post-write content for diff previews
  const RULE_PREVIEW_SCHEME = 'rule-preview';
  const previewContentStore = new Map<string, string>();
  const previewProviderReg = vscode.workspace.registerTextDocumentContentProvider(
    RULE_PREVIEW_SCHEME,
    { provideTextDocumentContent(uri) { return previewContentStore.get(uri.path) ?? ''; } },
  );

  // Register issue decoration provider (badges rules that have any issues)
  const issueDecoProvider = new RuleIssueDecorationProvider();
  const decoRegistration = vscode.window.registerFileDecorationProvider(issueDecoProvider);
  treeProvider.setIssueDecorationProvider(issueDecoProvider);

  // Register TreeViews
  const treeView = vscode.window.createTreeView('agentRules.rulesView', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
    canSelectMany: true,
  });

  const VIEW_MODE_LABELS: Record<string, string> = { logical: 'Logical', fileTree: 'File Tree' };
  const syncViewDescription = () => {
    treeView.description = VIEW_MODE_LABELS[treeProvider.getViewMode()];
  };
  syncViewDescription();

  const actionsProvider = new ActionsWebviewProvider(ruleIndex, context.extensionUri);
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

  const showLogicalViewCmd = vscode.commands.registerCommand('agentRules.showLogicalView', () => {
    treeProvider.setViewMode('logical');
    syncViewDescription();
  });

  const showFileTreeViewCmd = vscode.commands.registerCommand('agentRules.showFileTreeView', () => {
    treeProvider.setViewMode('fileTree');
    syncViewDescription();
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

  const convertRuleCmd = vscode.commands.registerCommand(
    'agentRules.convertRule',
    async (arg?: unknown) => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }

      // ── 1. Resolve source ──────────────────────────────────────────
      let logicalRule: LogicalRule | undefined;
      let slug: string | undefined;
      let sourceFormat: RuleFormat | undefined;

      if (arg instanceof vscode.Uri) {
        const result = classifyFileAsLogicalRule(arg.fsPath, root);
        if (!result) {
          vscode.window.showErrorMessage('File is not a recognised rule format.');
          return;
        }
        ({ logicalRule, slug } = result);
        sourceFormat = logicalRule.formats[0];
      } else {
        const resolved = resolveRuleTreeSelection(arg, treeView);
        if (resolved) {
          if (resolved.type === 'file') {
            ({ logicalRule, slug } = wrapClassifiedFileAsLogicalRule(resolved.rule));
            sourceFormat = resolved.rule.format;
          } else {
            logicalRule = resolved.logicalRule;
            sourceFormat = logicalRule.formats[0];
            const primary = [...logicalRule.rules].sort(
              (a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
            )[0];
            slug = path.basename(primary.filePath, primary.fileExtension);
          }
        } else {
          const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { 'Rule files': ['mdc', 'md'] },
            openLabel: 'Select rule file',
          });
          if (!uris?.[0]) return;
          const result = classifyFileAsLogicalRule(uris[0].fsPath, root);
          if (!result) {
            vscode.window.showErrorMessage('File is not a recognised rule format.');
            return;
          }
          ({ logicalRule, slug } = result);
          sourceFormat = logicalRule.formats[0];
        }
      }

      if (!logicalRule || !slug || !sourceFormat) return;

      // ── 2. Format picker ───────────────────────────────────────────
      const writableFormats = FORMAT_DEFINITIONS.filter(
        (d) => d.writable !== false && d.discoverable !== false && d.id !== sourceFormat,
      );
      const formatPick = await vscode.window.showQuickPick(
        writableFormats.map((d) => ({ label: FORMAT_LABELS[d.id as RuleFormat], id: d.id })),
        { placeHolder: 'Select target format' },
      );
      if (!formatPick) return;
      const targetFormat = formatPick.id as RuleFormat;

      // ── 3. Compute target path ─────────────────────────────────────
      const targetPath = computeTargetPath(logicalRule, targetFormat, root);

      // ── 4. Multi-file: delegate to writeRuleFile ───────────────────
      if (!targetPath) {
        const written = writeRuleFile(logicalRule, targetFormat);
        if (written) await vscode.window.showTextDocument(vscode.Uri.file(written));
        await scannerService.scan({ silent: true });
        return;
      }

      // ── 5. Named-file: conflict detection + resolution ─────────────
      const existingContent = fs.existsSync(targetPath)
        ? fs.readFileSync(targetPath, 'utf-8')
        : undefined;
      const conflict = detectConflict(existingContent, slug);

      const sourceBody = getSourceBody(logicalRule);
      const ruleMeta = buildRuleMetaComment(
        slug,
        logicalRule.globs,
        logicalRule.trigger,
        logicalRule.description,
      );

      let strategy: 'create' | 'append' | 'replace';

      if (conflict === 'none') {
        strategy = 'create';
      } else {
        const isReplace = conflict === 'same-slug';
        const primaryLabel = isReplace ? 'Replace existing section' : 'Append as new section';
        const items = [primaryLabel, 'Preview diff', 'Cancel'];

        let pick = await vscode.window.showQuickPick(items, {
          placeHolder: isReplace
            ? `Target already has a section for "${slug}"`
            : `${path.basename(targetPath)} exists but has no "${slug}" section`,
        });
        if (!pick || pick === 'Cancel') return;

        if (pick === 'Preview diff') {
          const previewStr = computeNamedFileContent(
            existingContent,
            slug,
            ruleMeta,
            sourceBody,
            isReplace ? 'replace' : 'append',
          );
          const previewKey = `/preview-${Date.now()}`;
          previewContentStore.set(previewKey, previewStr);
          const leftUri = existingContent
            ? vscode.Uri.file(targetPath)
            : vscode.Uri.parse(`${RULE_PREVIEW_SCHEME}:/empty`);
          const rightUri = vscode.Uri.parse(`${RULE_PREVIEW_SCHEME}:${previewKey}`);
          await vscode.commands.executeCommand(
            'vscode.diff',
            leftUri,
            rightUri,
            `Preview: ${path.basename(targetPath)} (${slug})`,
          );
          previewContentStore.delete(previewKey);

          pick = await vscode.window.showQuickPick([primaryLabel, 'Cancel'], {
            placeHolder: 'Confirm action',
          });
          if (!pick || pick === 'Cancel') return;
        }

        strategy = isReplace ? 'replace' : 'append';
      }

      // ── 6. Write ───────────────────────────────────────────────────
      const newContent = computeNamedFileContent(existingContent, slug, ruleMeta, sourceBody, strategy);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, newContent, 'utf-8');

      // ── 7. Open + rescan ───────────────────────────────────────────
      await vscode.window.showTextDocument(vscode.Uri.file(targetPath));
      await scannerService.scan({ silent: true });
    },
  );

  const convertSelectedRulesCmd = vscode.commands.registerCommand(
    'agentRules.convertSelectedRules',
    async () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }

      // ── 1. Collect selected nodes ────────────────────────────────────
      const selected = treeView.selection
        .map((node) => {
          const o = node as { type?: string; rule?: ClassifiedFile; logicalRule?: LogicalRule };
          if (o.type === 'file' && o.rule) return wrapClassifiedFileAsLogicalRule(o.rule);
          if (o.type === 'logical' && o.logicalRule) {
            const primary = [...o.logicalRule.rules].sort(
              (a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
            )[0];
            return {
              logicalRule: o.logicalRule,
              slug: path.basename(primary.filePath, primary.fileExtension),
            };
          }
          return undefined;
        })
        .filter((x): x is { logicalRule: LogicalRule; slug: string } => x !== undefined);

      if (selected.length === 0) {
        vscode.window.showErrorMessage('No rules selected. Select rules in the tree view first.');
        return;
      }

      // ── 2. Format picker ─────────────────────────────────────────────
      const writableFormats = FORMAT_DEFINITIONS.filter(
        (d) => d.writable !== false && d.discoverable !== false,
      );
      const formatPick = await vscode.window.showQuickPick(
        writableFormats.map((d) => ({ label: FORMAT_LABELS[d.id as RuleFormat], id: d.id })),
        { placeHolder: 'Select target format' },
      );
      if (!formatPick) return;
      const targetFormat = formatPick.id as RuleFormat;

      // ── 3. Conflict strategy ─────────────────────────────────────────
      const strategyPick = await vscode.window.showQuickPick(
        ['Replace existing', 'Skip existing', 'Ask per file'],
        { placeHolder: 'How to handle existing files?' },
      );
      if (!strategyPick) return;
      const bulkStrategy: BulkConflictStrategy =
        strategyPick === 'Replace existing' ? 'replace'
        : strategyPick === 'Skip existing' ? 'skip'
        : 'ask';

      // ── 4. Process with progress ─────────────────────────────────────
      let written = 0;
      let skipped = 0;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Converting rules…',
          cancellable: false,
        },
        async (progress) => {
          for (let i = 0; i < selected.length; i++) {
            const { logicalRule, slug } = selected[i];
            progress.report({
              message: `${slug} (${i + 1}/${selected.length})`,
              increment: 100 / selected.length,
            });
            const result = await writeRuleToFormat(logicalRule, slug, targetFormat, root, bulkStrategy);
            if (result === 'written') written++;
            else if (result === 'skipped') skipped++;
            else break; // 'cancel-all'
          }
        },
      );

      vscode.window.showInformationMessage(`Converted ${written}, skipped ${skipped}.`);
      await scannerService.scan({ silent: true });
    },
  );

  const exportToFormatCmd = vscode.commands.registerCommand(
    'agentRules.exportToFormat',
    async () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }

      const allRules = ruleIndex.getLogicalRules();
      if (allRules.length === 0) {
        vscode.window.showInformationMessage('No rules found in workspace.');
        return;
      }

      // ── Format picker ────────────────────────────────────────────────
      const writableFormats = FORMAT_DEFINITIONS.filter(
        (d) => d.writable !== false && d.discoverable !== false,
      );
      const formatPick = await vscode.window.showQuickPick(
        writableFormats.map((d) => ({ label: FORMAT_LABELS[d.id as RuleFormat], id: d.id })),
        { placeHolder: 'Select target format' },
      );
      if (!formatPick) return;
      const targetFormat = formatPick.id as RuleFormat;

      // ── Conflict strategy ────────────────────────────────────────────
      const strategyPick = await vscode.window.showQuickPick(
        ['Replace existing', 'Skip existing', 'Ask per file'],
        { placeHolder: 'How to handle existing files?' },
      );
      if (!strategyPick) return;
      const bulkStrategy: BulkConflictStrategy =
        strategyPick === 'Replace existing' ? 'replace'
        : strategyPick === 'Skip existing' ? 'skip'
        : 'ask';

      // ── Process with progress ────────────────────────────────────────
      let written = 0;
      let skipped = 0;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Exporting rules…',
          cancellable: false,
        },
        async (progress) => {
          for (let i = 0; i < allRules.length; i++) {
            const lr = allRules[i];
            const primary = [...lr.rules].sort(
              (a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
            )[0];
            const slug = path.basename(primary.filePath, primary.fileExtension);
            progress.report({
              message: `${slug} (${i + 1}/${allRules.length})`,
              increment: 100 / allRules.length,
            });
            const result = await writeRuleToFormat(lr, slug, targetFormat, root, bulkStrategy);
            if (result === 'written') written++;
            else if (result === 'skipped') skipped++;
            else break; // 'cancel-all'
          }
        },
      );

      vscode.window.showInformationMessage(`Exported ${written}, skipped ${skipped}.`);
      await scannerService.scan({ silent: true });
    },
  );

  const splitToFormatCmd = vscode.commands.registerCommand(
    'agentRules.splitToFormat',
    async (arg?: unknown) => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }

      // ── 1. Resolve source file path ──────────────────────────────────
      let sourceFilePath: string | undefined;

      if (arg instanceof vscode.Uri) {
        sourceFilePath = arg.fsPath;
      } else {
        const resolved = resolveRuleTreeSelection(arg, treeView);
        if (resolved?.type === 'file') {
          sourceFilePath = resolved.rule.filePath;
        } else {
          const uris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { 'Rule files': ['md'] },
            openLabel: 'Select rule file to split',
          });
          if (!uris?.[0]) return;
          sourceFilePath = uris[0].fsPath;
        }
      }

      if (!sourceFilePath) return;

      // ── 2. Parse sections ────────────────────────────────────────────
      let content: string;
      try {
        content = fs.readFileSync(sourceFilePath, 'utf-8');
      } catch {
        vscode.window.showErrorMessage(`Cannot read file: ${sourceFilePath}`);
        return;
      }

      const sections = parseSections(content);
      if (sections.length === 0) {
        vscode.window.showErrorMessage(
          'No rule-meta sections found. Only files containing <!-- rule-meta: ... --> markers can be split.',
        );
        return;
      }

      // ── 3. Section picker (multi-select, all pre-selected) ───────────
      const sectionPicks = await vscode.window.showQuickPick(
        sections.map((s) => ({
          label: s.meta.slug,
          description: s.meta.description,
          picked: true,
          section: s,
        })),
        { placeHolder: 'Select sections to extract', canPickMany: true },
      );
      if (!sectionPicks || sectionPicks.length === 0) return;
      const selectedSections = sectionPicks.map((p) => p.section);

      // ── 4. Format picker ─────────────────────────────────────────────
      const writableFormats = FORMAT_DEFINITIONS.filter(
        (d) => d.writable !== false && d.discoverable !== false,
      );
      const formatPick = await vscode.window.showQuickPick(
        writableFormats.map((d) => ({ label: FORMAT_LABELS[d.id as RuleFormat], id: d.id })),
        { placeHolder: 'Select output format' },
      );
      if (!formatPick) return;
      const targetFormat = formatPick.id as RuleFormat;

      // ── 5. Write each section ────────────────────────────────────────
      const config = FORMAT_DEFINITIONS.find((d) => d.id === targetFormat)!;
      let firstWrittenPath: string | undefined;
      let written = 0;
      let skipped = 0;

      for (const section of selectedSections) {
        const syntheticRule: LogicalRule = {
          id: '',
          description: section.meta.description ?? section.meta.slug,
          trigger: section.meta.trigger ?? 'always',
          globs: section.meta.globs,
          formats: [],
          rules: [],
          isDiverged: false,
          similarity: 1,
        };

        const result = await writeRuleToFormat(
          syntheticRule,
          section.meta.slug,
          targetFormat,
          root,
          'ask',
          section.body,
        );

        if (result === 'written') {
          written++;
          if (!firstWrittenPath) {
            const tp = computeTargetPath(syntheticRule, targetFormat, root);
            if (tp) {
              firstWrittenPath = tp;
            } else {
              firstWrittenPath = path.join(
                root,
                config.validPaths[0],
                section.meta.slug + config.validExtensions[0],
              );
            }
          }
        } else if (result === 'skipped') {
          skipped++;
        } else {
          break; // 'cancel-all'
        }
      }

      if (firstWrittenPath && fs.existsSync(firstWrittenPath)) {
        await vscode.window.showTextDocument(vscode.Uri.file(firstWrittenPath));
      }
      vscode.window.showInformationMessage(`Split: ${written} written, ${skipped} skipped.`);
      await scannerService.scan({ silent: true });
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
      ...AGENT_DEFINITIONS.map((a) => ({
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
        `No diverged rules have a version readable by ${getAgentDefinition(agentId as AgentId).label} to sync from.`,
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
      FORMAT_LABELS[writeFormat as RuleFormat] || getAgentDefinition(agentId as AgentId).label;
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
        `Full coverage — all rules are readable by ${getAgentDefinition(agentId as AgentId).label}.`,
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

      const confirm = await vscode.window.showWarningMessage(
        `Create a new rule file in ${FORMAT_LABELS[writeFormat]} for "${logicalRule.description}"?`,
        { modal: true },
        'Create',
      );
      if (confirm !== 'Create') {
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

  const deleteFromTreeImpl = async (arg?: unknown) => {
    const resolved = resolveRuleTreeSelection(arg, treeView);
    if (!resolved) {
      vscode.window.showInformationMessage('Select a rule file or logical rule in the tree first.');
      return;
    }

    if (resolved.type === 'file') {
      const rel = vscode.workspace.asRelativePath(resolved.rule.filePath, false);
      const fmt = FORMAT_LABELS[resolved.rule.format];
      const confirm = await vscode.window.showWarningMessage(
        `This will move the rule file to Trash (recoverable):\n\n${rel} (${fmt})\n\nContinue?`,
        { modal: true },
        'Move to Trash',
      );
      if (confirm !== 'Move to Trash') {
        return;
      }
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(resolved.rule.filePath), {
          useTrash: true,
          recursive: false,
        });
        await scannerService.scan();
        vscode.window.showInformationMessage(`Moved to Trash: ${rel}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Could not delete file: ${msg}`);
      }
    } else {
      const rules = resolved.logicalRule.rules;
      const lines = rules.map(
        (r) =>
          `• ${vscode.workspace.asRelativePath(r.filePath, false)} (${FORMAT_LABELS[r.format]})`,
      );
      const confirm = await vscode.window.showWarningMessage(
        `This will move ${rules.length} rule file${rules.length > 1 ? 's' : ''} to Trash (recoverable):\n\n${lines.join('\n')}\n\nDelete all?`,
        { modal: true },
        'Move all to Trash',
      );
      if (confirm !== 'Move all to Trash') {
        return;
      }
      const failed: string[] = [];
      let ok = 0;
      for (const r of rules) {
        try {
          await vscode.workspace.fs.delete(vscode.Uri.file(r.filePath), {
            useTrash: true,
            recursive: false,
          });
          ok++;
        } catch (err: unknown) {
          const rel = vscode.workspace.asRelativePath(r.filePath, false);
          const msg = err instanceof Error ? err.message : String(err);
          failed.push(`${rel}: ${msg}`);
        }
      }
      if (ok > 0) {
        await scannerService.scan();
      }
      if (failed.length === 0) {
        vscode.window.showInformationMessage(`Moved ${ok} file${ok > 1 ? 's' : ''} to Trash.`);
      } else if (ok > 0) {
        vscode.window.showWarningMessage(
          `Moved ${ok} file(s) to Trash; failed: ${failed.join('; ')}`,
        );
      } else {
        vscode.window.showErrorMessage(`Could not delete files: ${failed.join('; ')}`);
      }
    }
  };

  const deleteRuleFileCmd = vscode.commands.registerCommand(
    'agentRules.deleteRuleFile',
    deleteFromTreeImpl,
  );
  const deleteAllRuleFormatFilesCmd = vscode.commands.registerCommand(
    'agentRules.deleteAllRuleFormatFiles',
    deleteFromTreeImpl,
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

  // Register meta-rule install command
  const installMetaRuleCmd = vscode.commands.registerCommand(
    'agentRules.installMetaRule',
    async () => {
      const agentId = vscode.workspace.getConfiguration('agentRules').get<string>('agent', '') as
        | AgentId
        | '';
      const written = await installMetaRule(context.extensionPath, agentId || undefined);
      if (written.length > 0) {
        await scannerService.scan({ silent: true });
      }
    },
  );

  // Register coverage export commands
  const exportCoverageCmd = vscode.commands.registerCommand(
    'agentRules.exportCoverage',
    async () => {
      await exportCoverageToFile(ruleIndex);
    },
  );

  const exportCoverageDefaultCmd = vscode.commands.registerCommand(
    'agentRules.exportCoverageDefault',
    async () => {
      await exportCoverageToDefault(ruleIndex);
    },
  );

  // Register LM tool (no-op on VS Code < 1.90)
  registerCoverageLmTool(ruleIndex, context);

  // Register VS Code native MCP provider (stdio) for Copilot/Copilot Chat
  registerVsCodeMcpProvider(context);

  // Auto-export coverage.json whenever rules change (consumed by the stdio MCP server)
  const autoExportDisposable = ruleIndex.onDidChange(() => {
    exportCoverageToDefault(ruleIndex).catch(() => {});
  });
  context.subscriptions.push(autoExportDisposable);

  const configureMcpCmd = vscode.commands.registerCommand(
    'agentRules.configureMcpForClaude',
    async () => {
      await configureMcpForClaude(context.extensionPath);
    },
  );

  const configureMcpForCursorCmd = vscode.commands.registerCommand(
    'agentRules.configureMcpForCursor',
    async () => {
      await configureMcpForCursor(context.extensionPath);
    },
  );

  const configureMcpForWindsurfCmd = vscode.commands.registerCommand(
    'agentRules.configureMcpForWindsurf',
    async () => {
      await configureMcpForWindsurf(context.extensionPath);
    },
  );

  const getStartedCmd = vscode.commands.registerCommand('agentRules.getStarted', () => {
    const cfg = vscode.workspace.getConfiguration('agentRules');
    AgentConfigWebviewPanel.createOrShow(context, {
      initialAgentId: cfg.get<string>('agent', ''),
      initialWriteFormat: cfg.get<string>('writeFormat', ''),
    });
  });

  // React to agent or format changes: auto-install meta-rule and/or auto-register MCP
  // based on the user's standing consent stored in VS Code settings.
  const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(async (e) => {
    const agentChanged = e.affectsConfiguration('agentRules.agent');
    const formatChanged = e.affectsConfiguration('agentRules.writeFormat');
    if (!agentChanged && !formatChanged) return;

    const cfg = vscode.workspace.getConfiguration('agentRules');
    const agentId = cfg.get<string>('agent', '') as AgentId | '';
    if (!agentId) return;

    if (cfg.get<boolean>('autoInstallMetaRule', true)) {
      const written = await installMetaRule(context.extensionPath, agentId as AgentId, {
        skipExisting: true,
      });
      if (written.length > 0) {
        await scannerService.scan({ silent: true });
      }
    }

    if (agentChanged && cfg.get<boolean>('autoConfigureMcp', true)) {
      await configureMcpForAgent(agentId, context.extensionPath, { silent: true });
    }
  });

  // Set up file system watchers derived from FORMAT_CONFIGS
  const watchers = createFileWatchers(scannerService);

  // Push all disposables
  context.subscriptions.push(
    treeView,
    actionsViewRegistration,
    bodyProvider,
    previewProviderReg,
    convertRuleCmd,
    convertSelectedRulesCmd,
    exportToFormatCmd,
    splitToFormatCmd,
    filterCmd,
    clearFilterCmd,
    showLogicalViewCmd,
    showFileTreeViewCmd,
    rescanCmd,
    openRuleCmd,
    compareCmd,
    alignCmd,
    setAgentCmd,
    syncAllCmd,
    addAllMissingCmd,
    addMissingRuleCmd,
    deleteRuleFileCmd,
    deleteAllRuleFormatFilesCmd,
    addRuleCmd,
    showCoverageCmd,
    installMetaRuleCmd,
    exportCoverageCmd,
    exportCoverageDefaultCmd,
    configureMcpCmd,
    configureMcpForCursorCmd,
    configureMcpForWindsurfCmd,
    getStartedCmd,
    configChangeDisposable,
    ruleIndex,
    scannerService,
    treeProvider,
    actionsProvider,
    issueDecoProvider,
    decoRegistration,
    ...watchers,
  );

  // Auto-scan on activation (silent — no notification).
  // After the first scan, auto-detect agent if none is configured, then show
  // the welcome panel if the user hasn't completed setup yet.
  scannerService.scan({ silent: true }).then(() => {
    autoSelectAgentIfNeeded(ruleIndex).then(() => {
      maybeShowWelcome(context);
    });
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

async function maybeShowWelcome(context: vscode.ExtensionContext): Promise<void> {
  const hasSeenWelcome = context.globalState.get<boolean>('hasSeenWelcome', false);
  if (hasSeenWelcome) return;

  const cfg = vscode.workspace.getConfiguration('agentRules');
  AgentConfigWebviewPanel.createOrShow(context, {
    initialAgentId: cfg.get<string>('agent', ''),
    initialWriteFormat: cfg.get<string>('writeFormat', ''),
  });
}

export function deactivate() {
  // Nothing to clean up — disposables handle it
}
