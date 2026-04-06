/**
 * Converts a filename to a case-insensitive glob pattern.
 * e.g. "AGENTS.md" -> "[aA][gG][eE][nN][tT][sS].[mM][dD]"
 */
export function toCaseInsensitiveGlob(fileName: string): string {
  return fileName
    .split('')
    .map((ch) => {
      const lower = ch.toLowerCase();
      const upper = ch.toUpperCase();
      if (lower !== upper) {
        return `[${lower}${upper}]`;
      }
      return ch; // non-alpha characters (e.g. '.')
    })
    .join('');
}
