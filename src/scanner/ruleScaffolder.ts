import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LogicalRule, RuleFormat } from './scannerTypes';
import { parseFrontmatter } from './frontmatterParser';
import { FORMAT_CONFIGS } from './formatDetector';
import { extractCommonDirectory } from './scopeTranslator';

/**
 * Scaffold a new rule file in the target format, copying body from the best available source.
 * Returns the absolute file path of the created file, or undefined on failure.
 */
export function scaffoldRuleFile(logicalRule: LogicalRule, targetFormat: RuleFormat): string | undefined {
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

  // agents-md format: place AGENTS.md in the LCA directory for glob-scoped rules, or workspace root
  if (targetFormat === 'agents-md') {
    const targetDir = (logicalRule.trigger === 'glob' && logicalRule.globs?.length)
      ? (() => { const lcaDir = extractCommonDirectory(logicalRule.globs!); return lcaDir ? path.join(root, lcaDir) : root; })()
      : root;
    const targetPath = path.join(targetDir, 'AGENTS.md');

    if (fs.existsSync(targetPath)) {
      vscode.window.showWarningMessage(`AGENTS.md already exists at ${vscode.workspace.asRelativePath(targetPath, false)}`);
      return undefined;
    }

    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(targetPath, sourceBody + '\n', 'utf-8');
    return targetPath;
  }

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
  const targetExt = config.extensions[0];

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
export function buildFrontmatter(format: RuleFormat, lr: LogicalRule): string {
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
      } else if (lr.trigger === 'agent_requested') {
        lines.push('inclusion: auto');
        if (lr.description) { lines.push(`description: "${lr.description}"`); }
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

    case 'agents-md':
      // AGENTS.md uses plain markdown — no frontmatter
      break;
  }

  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}
