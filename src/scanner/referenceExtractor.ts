/**
 * Extract relative file path references from a markdown rule body.
 *
 * Captures:
 *   - Markdown links: [text](./path/to/file.md)
 *   - Backtick paths: `path/to/file.md`
 *
 * Skips URLs (http/https/ftp), anchors (#), absolute paths (/),
 * and paths without a file extension (likely not file references).
 */
export function extractReferences(body: string): string[] {
  const refs = new Set<string>();

  // Markdown link targets: [text](path)
  const linkRegex = /\[[^\]]*\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(body)) !== null) {
    addIfRelativePath(match[1], refs);
  }

  // Backtick-quoted paths: `some/path.ext`
  const backtickRegex = /`([^`\n]+)`/g;
  while ((match = backtickRegex.exec(body)) !== null) {
    addIfRelativePath(match[1], refs);
  }

  return Array.from(refs);
}

function addIfRelativePath(raw: string, refs: Set<string>): void {
  const trimmed = raw.trim();
  // Skip URLs
  if (/^https?:\/\/|^ftp:\/\//i.test(trimmed)) { return; }
  // Skip anchors
  if (trimmed.startsWith('#')) { return; }
  // Skip absolute paths
  if (trimmed.startsWith('/')) { return; }
  // Must contain a dot (file extension) and a slash or start with ./ to look like a path
  // This avoids matching inline code like `const x = 1` or `package.json`
  if (!trimmed.includes('/')) { return; }
  if (!/\.[a-zA-Z0-9]+$/.test(trimmed)) { return; }
  // Strip leading ./ for consistency
  const cleaned = trimmed.replace(/^\.\//, '');
  refs.add(cleaned);
}
