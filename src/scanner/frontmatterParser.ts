import { parse as parseYaml } from 'yaml';

const FRONTMATTER_REGEX = /^---[\r\n]+([\s\S]*?)[\r\n]+---[\r\n]*/;

export interface ParsedFrontmatter {
  /** Extracted YAML fields */
  fields: Record<string, unknown>;
  /** Content body after frontmatter */
  body: string;
  /** Raw YAML string between --- delimiters, or undefined if no frontmatter */
  rawYaml: string | undefined;
}

/**
 * Extracts YAML frontmatter and body content from a rule file.
 * Returns undefined rawYaml if no frontmatter block is present.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(FRONTMATTER_REGEX);

  if (!match) {
    return { fields: {}, body: content.trim(), rawYaml: undefined };
  }

  const rawYaml = match[1];
  const body = content.slice(match[0].length).trim();

  let fields: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(rawYaml);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      fields = parsed as Record<string, unknown>;
    }
  } catch {
    // Malformed YAML — treat as no frontmatter
  }

  return { fields, body, rawYaml };
}

/**
 * Extracts the first markdown heading from the body content.
 * Matches any heading level (# through ######).
 * Returns the heading text without the # prefix, or undefined if none found.
 */
export function extractFirstHeading(body: string): string | undefined {
  const match = body.match(/^#{1,6}\s+(.+)$/m);
  return match ? match[1].trim() : undefined;
}
