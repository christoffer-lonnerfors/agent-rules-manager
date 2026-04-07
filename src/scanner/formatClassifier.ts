import * as path from 'path';
import * as crypto from 'crypto';
import { FormatDefinition } from '../formats/formatDefinition';
import { FORMAT_DEFINITIONS, getFormatDefinition } from '../formats/formatRegistry';
import { RuleFormat } from '../formats/formatRegistry';
import { ClassifiedFile } from './classifiedFile';
import { parseFrontmatter, extractFirstHeading } from './frontmatterParser';
import { computeMinHash } from '../hashing/minHasher';
import { mapTrigger } from './triggerMapper';
import { extractLinks } from './linkExtractor';

// ── Identity ──────────────────────────────────────────────────────────

export function generateRuleId(filePath: string): string {
  return crypto.createHash('sha256').update(filePath).digest('hex').substring(0, 16);
}

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
      (def.validPaths.includes('.') && dir === '.') ||
      def.validPaths.some((p) => dir === p || dir.startsWith(p + '/'));

    if (!pathMatch) {
      continue;
    }

    // Check name match
    const nameMatch = def.validNames.includes('*') || def.validNames.includes(fileName);

    if (!nameMatch) {
      continue;
    }

    // Check extension match (empty validExtensions means extensionless files like .cursorrules)
    const extMatch =
      def.validExtensions.length === 0 || def.validExtensions.includes(fileExtension);

    if (!extMatch) {
      continue;
    }

    return def;
  }

  return undefined;
}

// ── Main classifier ──────────────────────────────────────────────────

/**
 * Classify a single file: match format, parse frontmatter, map properties,
 * extract links, and compute hashes in one pass.
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

  let def = matchFormat(relativePath, fileName, fileExtension);
  if (!def) {
    const documentDef = getFormatDefinition('document');
    if (documentDef.validExtensions.includes(fileExtension)) {
      def = documentDef;
    } else {
      return undefined;
    }
  }

  const { fields, body, rawYaml } = parseFrontmatter(content);
  const {
    trigger,
    globs,
    description: fmDescription,
  } = mapTrigger(def, fields, filePath, workspaceRoot);
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
    format: def.id as RuleFormat,
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
