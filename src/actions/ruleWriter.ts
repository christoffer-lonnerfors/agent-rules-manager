import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { LogicalRule } from '../logical/logicalRule';
import { RuleFormat, RuleTrigger } from '../formats/formatRegistry';
import { parseFrontmatter } from '../scanner/frontmatterParser';
import { FORMAT_DEFINITIONS } from '../formats/formatRegistry';
import { extractCommonDirectory } from '../utils/scopeTranslator';

/**
 * Write a rule file in the target format, copying body from the best available source rule.
 * Returns the absolute file path of the written file, or undefined on failure.
 */
export function writeRuleFile(
  logicalRule: LogicalRule,
  targetFormat: RuleFormat,
): string | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    return undefined;
  }
  const root = workspaceFolders[0].uri.fsPath;

  // Get the body from the best available source (most recently modified)
  const sorted = [...logicalRule.rules].sort(
    (a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
  );
  const source = sorted[0];
  const sourceContent = fs.readFileSync(source.filePath, 'utf-8');
  const { body: sourceBody } = parseFrontmatter(sourceContent);

  // Determine target directory and extension
  const config = FORMAT_DEFINITIONS.find((d) => d.id === targetFormat);
  if (!config || (config.validPaths.length === 0 && config.validNames.length === 0)) {
    return undefined;
  }

  // Named-file formats (validNames[0] !== '*'): target file is fixed, not slug-derived
  const fixedName = config.validNames[0] !== '*' ? config.validNames[0] : null;
  if (fixedName) {
    const targetDir = config.isHierarchical
      ? logicalRule.trigger === 'glob' && logicalRule.globs?.length
        ? (() => {
            const lcaDir = extractCommonDirectory(logicalRule.globs!);
            return lcaDir ? path.join(root, lcaDir) : root;
          })()
        : root
      : path.join(root, config.validPaths[0]);
    const targetPath = path.join(targetDir, fixedName);

    if (fs.existsSync(targetPath)) {
      if (config.appendOnConflict) {
        const existing = fs.readFileSync(targetPath, 'utf-8');
        fs.writeFileSync(
          targetPath,
          existing.trimEnd() + '\n\n---\n\n' + sourceBody + '\n',
          'utf-8',
        );
      } else {
        vscode.window.showWarningMessage(
          `${fixedName} already exists at ${vscode.workspace.asRelativePath(targetPath, false)}`,
        );
        return undefined;
      }
    } else {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(targetPath, sourceBody + '\n', 'utf-8');
    }
    return targetPath;
  }

  const targetDir = path.join(root, config.validPaths[0]);
  const targetExt = config.validExtensions[0];

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
 * Driven entirely by the write-side fields in FormatDefinition.
 */
export function buildFrontmatter(format: RuleFormat, lr: LogicalRule): string {
  const def = FORMAT_DEFINITIONS.find((d) => d.id === format);
  if (!def || def.frontmatterFields.length === 0) return '';

  const lines: string[] = [];

  for (const field of def.frontmatterFields) {
    if (field.emitWhen && !field.emitWhen.includes(lr.trigger)) continue;

    if (field.mapsTo === 'trigger') {
      const value = field.writeValueMap?.[lr.trigger];
      if (value === undefined) continue;
      lines.push(`${field.name}: ${value}`);
    } else if (field.mapsTo === 'globs') {
      if (!lr.globs?.length) continue;
      lines.push(`${field.name}:`);
      for (const g of lr.globs) lines.push(`  - "${g}"`);
    } else if (field.mapsTo === 'description') {
      if (!lr.description) continue;
      lines.push(`${field.name}: "${lr.description}"`);
    }
  }

  return lines.length > 0 ? lines.join('\n') + '\n' : '';
}

/**
 * Build the full file content for a brand-new rule.
 * Uses buildFrontmatter() with a synthetic LogicalRule, plus a common body template.
 */
export function buildNewRuleContent(
  format: RuleFormat,
  trigger: RuleTrigger,
  name: string,
): string {
  const syntheticRule: LogicalRule = {
    id: '',
    description: 'Your rule description here',
    trigger,
    globs: trigger === 'glob' ? ['**/*'] : undefined,
    formats: [format],
    rules: [],
    isDiverged: false,
    similarity: 1,
  };

  const frontmatter = buildFrontmatter(format, syntheticRule);
  const body = `# Rule Title\n\nAdd your rule content here.\n`;

  return frontmatter ? `---\n${frontmatter}---\n\n${body}` : body;
}

/**
 * Create a brand-new rule file in the target format.
 * For named-file formats, appends a new section if the file already exists.
 * For hierarchical formats, `location` specifies the target directory relative to workspace root.
 * Returns the absolute file path, or undefined on failure.
 */
export function createRuleFile(
  format: RuleFormat,
  trigger: RuleTrigger,
  name: string,
  location?: string,
): string | undefined {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) return undefined;
  const root = workspaceFolders[0].uri.fsPath;

  const config = FORMAT_DEFINITIONS.find((d) => d.id === format);
  if (!config) return undefined;

  const content = buildNewRuleContent(format, trigger, name);

  // Named-file formats: fixed filename, append if exists
  const fixedName = config.validNames[0] !== '*' ? config.validNames[0] : null;
  if (fixedName) {
    const targetDir = config.isHierarchical
      ? !location || location === '/'
        ? root
        : path.join(root, location)
      : path.join(root, config.validPaths[0]);
    const filePath = path.join(targetDir, fixedName);

    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, 'utf-8');
      fs.writeFileSync(filePath, existing.trimEnd() + '\n\n---\n\n' + content, 'utf-8');
    } else {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(filePath, content, 'utf-8');
    }
    return filePath;
  }

  // Slug-based formats: derive filename from name
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const dir = path.join(root, config.validPaths[0]);
  const ext = config.validExtensions[0];
  const filePath = path.join(dir, slug + ext);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}
