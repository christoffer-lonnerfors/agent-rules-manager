import { FormatDefinition, ExtractedLink } from './formatDefinition';

// ── Link target validation ────────────────────────────────────────────

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

// ── Link extraction ──────────────────────────────────────────────────

/**
 * Extract all file path references from body content using the format's
 * declared link patterns. Filters out URLs, anchors, absolute paths,
 * and extensionless targets.
 */
export function extractLinks(body: string, def: FormatDefinition): ExtractedLink[] {
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
