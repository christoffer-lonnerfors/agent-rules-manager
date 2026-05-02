import * as fs from 'fs';
import * as path from 'path';
import { LogicalRule } from '../logical/logicalRule';
import { RuleFormat } from '../formats/formatRegistry';
import { RuleTrigger } from '../formats/formatDefinition';
import { FORMAT_DEFINITIONS } from '../formats/formatRegistry';
import { ClassifiedFile } from '../scanner/classifiedFile';
import { classify } from '../scanner/formatClassifier';
import { parseFrontmatter } from '../scanner/frontmatterParser';
import { extractCommonDirectory } from '../utils/scopeTranslator';

// ── rule-meta comment ────────────────────────────────────────────────

export function buildRuleMetaComment(
  slug: string,
  globs?: string[],
  trigger?: RuleTrigger,
  description?: string,
): string {
  const meta: Record<string, unknown> = { slug };
  if (trigger && trigger !== 'always') meta.trigger = trigger;
  if (trigger === 'glob' && globs?.length) meta.globs = globs;
  if (description) meta.description = description;
  return `<!-- rule-meta: ${JSON.stringify(meta)} -->`;
}

// ── Section detection ────────────────────────────────────────────────

export function findSlugSection(
  content: string,
  slug: string,
): { sectionStart: number; sectionEnd: number } | undefined {
  const marker = '<!-- rule-meta:';
  const lines = content.split('\n');
  let sectionStart = -1;
  let charOffset = 0;

  for (const line of lines) {
    if (line.trimStart().startsWith(marker)) {
      try {
        const json = line.slice(line.indexOf('{'), line.lastIndexOf('}') + 1);
        const parsed = JSON.parse(json) as { slug?: string };
        if (parsed.slug === slug) {
          sectionStart = charOffset;
        } else if (sectionStart !== -1) {
          return { sectionStart, sectionEnd: charOffset };
        }
      } catch {
        // skip malformed comments
      }
    }
    charOffset += line.length + 1; // +1 for the \n
  }

  if (sectionStart !== -1) {
    return { sectionStart, sectionEnd: content.length };
  }
  return undefined;
}

export function detectConflict(
  existingContent: string | undefined,
  slug: string,
): 'none' | 'same-slug' | 'file-exists-no-slug' {
  if (!existingContent) return 'none';
  if (findSlugSection(existingContent, slug)) return 'same-slug';
  return 'file-exists-no-slug';
}

// ── Content assembly ─────────────────────────────────────────────────

export function computeNamedFileContent(
  existingContent: string | undefined,
  slug: string,
  ruleMetaComment: string,
  body: string,
  strategy: 'create' | 'append' | 'replace',
): string {
  const newSection = `${ruleMetaComment}\n\n${body.trim()}\n`;

  if (strategy === 'create' || !existingContent) {
    return newSection;
  }

  if (strategy === 'append') {
    return existingContent.trimEnd() + '\n\n' + newSection;
  }

  // 'replace': splice out the old section and substitute
  const found = findSlugSection(existingContent, slug);
  if (!found) {
    return existingContent.trimEnd() + '\n\n' + newSection;
  }

  const before = existingContent.slice(0, found.sectionStart).trimEnd();
  const after = existingContent.slice(found.sectionEnd).trimStart();

  if (before && after) {
    return before + '\n\n' + newSection + '\n\n' + after;
  } else if (before) {
    return before + '\n\n' + newSection;
  } else if (after) {
    return newSection + '\n\n' + after;
  }
  return newSection;
}

// ── Target path ──────────────────────────────────────────────────────

export function computeTargetPath(
  logicalRule: LogicalRule,
  targetFormat: RuleFormat,
  workspaceRoot: string,
): string | undefined {
  const config = FORMAT_DEFINITIONS.find((d) => d.id === targetFormat);
  if (!config) return undefined;

  // Multi-file formats use slug-based filenames — writeRuleFile handles them
  if (config.validNames[0] === '*') return undefined;

  let targetDir: string;
  if (config.isHierarchical) {
    const lcaDir =
      logicalRule.trigger === 'glob' && logicalRule.globs?.length
        ? extractCommonDirectory(logicalRule.globs)
        : '';
    targetDir = lcaDir ? path.join(workspaceRoot, lcaDir) : workspaceRoot;
  } else {
    targetDir = path.join(workspaceRoot, config.validPaths[0]);
  }

  return path.join(targetDir, config.validNames[0]);
}

// ── Source resolution ────────────────────────────────────────────────

export function wrapClassifiedFileAsLogicalRule(
  cf: ClassifiedFile,
): { logicalRule: LogicalRule; slug: string } {
  const slug = path.basename(cf.filePath, cf.fileExtension);
  const logicalRule: LogicalRule = {
    id: cf.id,
    description: cf.description ?? slug,
    trigger: cf.trigger,
    globs: cf.globs,
    formats: [cf.format],
    rules: [cf],
    isDiverged: false,
    similarity: 1,
  };
  return { logicalRule, slug };
}

export function classifyFileAsLogicalRule(
  filePath: string,
  workspaceRoot: string,
): { logicalRule: LogicalRule; slug: string } | undefined {
  let content: string;
  let stat: fs.Stats;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
    stat = fs.statSync(filePath);
  } catch {
    return undefined;
  }

  const cf = classify(filePath, content, stat.size, stat.mtime, workspaceRoot);
  if (!cf) return undefined;

  return wrapClassifiedFileAsLogicalRule(cf);
}

// ── Body extraction ──────────────────────────────────────────────────

export function getSourceBody(logicalRule: LogicalRule): string {
  const sorted = [...logicalRule.rules].sort(
    (a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime(),
  );
  const source = sorted[0];
  const content = fs.readFileSync(source.filePath, 'utf-8');
  const { body } = parseFrontmatter(content);
  return body;
}
