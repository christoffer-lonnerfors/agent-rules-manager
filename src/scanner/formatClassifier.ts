import * as path from 'path';
import * as crypto from 'crypto';
import { RuleTrigger } from '../types';
import { FormatDefinition, ExtractedLink } from './formatDefinition';
import { FORMAT_DEFINITIONS } from './formatRegistry';
import { ClassifiedFile, generateRuleId } from './classifiedFile';
import { parseFrontmatter, extractFirstHeading } from './frontmatterParser';
import { computeMinHash } from '../hashing/minHasher';
import { deriveGlobFromHierarchicalPath } from '../utils/scopeTranslator';

// ── Format matching ──────────────────────────────────────────────────

/**
 * Find the FormatDefinition that matches a given file path.
 * Returns undefined if no format matches.
 */
export function matchFormat(
  relativePath: string,
  fileName: string,
  fileExtension: string,
): FormatDefinition | undefined {
  const dir = path.dirname(relativePath).split(path.sep).join('/');

  for (const def of FORMAT_DEFINITIONS) {
    // Check path match
    const pathMatch =
      def.validPaths.includes('**') ||
      def.validPaths.includes('.') && dir === '.' ||
      def.validPaths.some((p) => dir === p || dir.startsWith(p + '/'));

    if (!pathMatch) {
      continue;
    }

    // Check name match
    const nameMatch =
      def.validNames.includes('*') || def.validNames.includes(fileName);

    if (!nameMatch) {
      continue;
    }

    // Check extension match (empty validExtensions means extensionless files like .cursorrules)
    const extMatch =
      def.validExtensions.length === 0 ||
      def.validExtensions.includes(fileExtension);

    if (!extMatch) {
      continue;
    }

    return def;
  }

  return undefined;
}

// ── Glob normalization ───────────────────────────────────────────────

function normalizeGlobs(value: unknown): string[] | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  return undefined;
}

// ── Link extraction ──────────────────────────────────────────────────

function extractLinks(body: string, def: FormatDefinition): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  for (const pattern of def.linkPatterns) {
    // Clone regex to reset lastIndex for each pattern
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(body)) !== null) {
      if (match[1]) {
        const target = match[1].trim();
        if (isValidLinkTarget(target)) {
          links.push({ patternId: pattern.id, target });
        }
      }
    }
  }
  return links;
}

function isValidLinkTarget(target: string): boolean {
  // Skip URLs
  if (/^https?:\/\/|^ftp:\/\//i.test(target)) {
    return false;
  }
  // Skip anchors
  if (target.startsWith('#')) {
    return false;
  }
  // Skip absolute paths
  if (target.startsWith('/')) {
    return false;
  }
  // Must have a file extension
  if (!/\.[a-zA-Z0-9]+$/.test(target)) {
    return false;
  }
  return true;
}


// ── Trigger mapping ──────────────────────────────────────────────────

function mapTrigger(
  def: FormatDefinition,
  fields: Record<string, unknown>,
  _relativePath: string,
  workspaceRoot: string,
  filePath: string,
): { trigger: RuleTrigger; globs: string[] | undefined; description: string | undefined } {
  const descField = def.frontmatterFields.find((f) => f.mapsTo === 'description');
  const description =
    descField && typeof fields[descField.name] === 'string'
      ? (fields[descField.name] as string)
      : undefined;

  // Hierarchical files: scope derived from directory position
  if (def.isHierarchical) {
    const implicitGlob = deriveGlobFromHierarchicalPath(filePath, workspaceRoot);
    if (implicitGlob) {
      return { trigger: 'glob', globs: [implicitGlob], description };
    }
    return { trigger: 'always', globs: undefined, description };
  }

  // Standalone files (validPaths=['.'], specific name): always-on
  if (def.validPaths.includes('.') && def.validNames[0] !== '*') {
    return { trigger: 'always', globs: undefined, description };
  }

  // Try each frontmatter field that maps to 'trigger'
  for (const fieldDef of def.frontmatterFields) {
    if (fieldDef.mapsTo !== 'trigger' || !fieldDef.valueMap) {
      continue;
    }

    const rawValue = fields[fieldDef.name];
    if (rawValue === undefined) {
      continue;
    }

    // Boolean fields (e.g. alwaysApply: true)
    if (fieldDef.type === 'boolean' && typeof rawValue === 'boolean') {
      const mapped = fieldDef.valueMap[String(rawValue)];
      if (mapped) {
        return { trigger: mapped, globs: undefined, description };
      }
    }

    // String fields (e.g. trigger: 'always_on')
    if (fieldDef.type === 'string' && typeof rawValue === 'string') {
      const mapped = fieldDef.valueMap[rawValue];
      if (mapped) {
        // If trigger maps to 'glob', extract globs from the glob field
        if (mapped === 'glob') {
          const globField = def.frontmatterFields.find((f) => f.mapsTo === 'globs');
          const globs = globField ? normalizeGlobs(fields[globField.name]) : undefined;
          return { trigger: 'glob', globs, description };
        }
        return { trigger: mapped, globs: undefined, description };
      }
    }
  }

  // Check if globs are present without an explicit trigger
  const globField = def.frontmatterFields.find((f) => f.mapsTo === 'globs');
  if (globField) {
    const globs = normalizeGlobs(fields[globField.name]);
    if (globs && globs.length > 0) {
      return { trigger: 'glob', globs, description };
    }
  }

  // descriptionImpliesAgentRequested (Cursor convention)
  if (def.defaults.descriptionImpliesAgentRequested && description) {
    return { trigger: 'agent_requested', globs: undefined, description };
  }

  return { trigger: def.defaults.trigger, globs: undefined, description };
}

// ── Main classifier ──────────────────────────────────────────────────

/**
 * Classify a single file: match format, parse frontmatter, map properties,
 * extract links, and compute file-level diagnostics in one pass.
 *
 * @param filePath - Absolute file path
 * @param content - Raw file content
 * @param fileSize - File size in bytes
 * @param lastModified - Last modified date
 * @param workspaceRoot - Workspace root path
 * @returns ClassifiedFile, or undefined if the file doesn't match any format
 */
export function classify(
  filePath: string,
  content: string,
  fileSize: number,
  lastModified: Date,
  workspaceRoot: string,
): ClassifiedFile | undefined {
  const relativePath = path.relative(workspaceRoot, filePath).split(path.sep).join('/');
  const fileName = path.basename(filePath);
  const fileExtension = path.extname(filePath);

  const def = matchFormat(relativePath, fileName, fileExtension);
  if (!def) {
    return undefined;
  }

  const { fields, body, rawYaml } = parseFrontmatter(content);
  const { trigger, globs, description: fmDescription } = mapTrigger(
    def, fields, relativePath, workspaceRoot, filePath,
  );
  const description = fmDescription ?? extractFirstHeading(body);
  const contentHash = computeMinHash(body);
  const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
  const bodyLength = body.trim().length;
  const links = extractLinks(body, def);

  return {
    id: generateRuleId(filePath),
    filePath,
    relativePath,
    fileName,
    fileExtension,
    format: def.id,
    isHierarchical: def.isHierarchical,
    isStandalone: def.validPaths.includes('.'),
    body,
    rawFrontmatter: rawYaml,
    frontmatterFields: fields,
    trigger,
    globs,
    description,
    contentHash,
    bodyHash,
    bodyLength,
    links,
    fileSize,
    lastModified: lastModified.toISOString(),
    diagnostics: [],
  };
}