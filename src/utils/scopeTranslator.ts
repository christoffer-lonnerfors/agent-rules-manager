import * as path from 'path';

/**
 * Extracts the common directory prefix (least common ancestor) from an array
 * of glob patterns. This is the deepest directory that all globs share.
 *
 * Examples:
 *   ["src/api/xx/*.ts"]                       => "src/api"
 *   ["src/api/xx/*.ts", "src/api/utils/xx"]   => "src/api"
 *   ["src/api/xx/*.ts", "src/models/xx/*.ts"] => "src"
 *   ["xx/*.ts"]                               => ""
 *   ["*.ts"]                                  => ""
 */
export function extractCommonDirectory(globs: string[]): string {
  if (!globs || globs.length === 0) { return ''; }

  // Extract the directory prefix from each glob (everything before the first wildcard segment)
  const prefixes = globs.map(g => extractDirectoryPrefix(g));

  // Find the common prefix across all
  if (prefixes.length === 1) { return prefixes[0]; }

  const segments0 = prefixes[0].split('/').filter(Boolean);
  let commonLength = segments0.length;

  for (let i = 1; i < prefixes.length; i++) {
    const segments = prefixes[i].split('/').filter(Boolean);
    let j = 0;
    while (j < commonLength && j < segments.length && segments0[j] === segments[j]) {
      j++;
    }
    commonLength = j;
  }

  return segments0.slice(0, commonLength).join('/');
}

/**
 * Extracts the static directory prefix from a single glob pattern.
 * Stops at the first segment containing a wildcard character.
 */
function extractDirectoryPrefix(glob: string): string {
  const segments = glob.split('/');
  const dirSegments: string[] = [];

  for (const segment of segments) {
    if (/[*?[\]{]/.test(segment)) {
      break;
    }
    dirSegments.push(segment);
  }

  // The last non-wildcard segment might be a filename — only keep if we stopped
  // because of a wildcard (meaning all collected segments are directories)
  // If we consumed ALL segments without hitting a wildcard, the last one is a file
  if (dirSegments.length === segments.length && dirSegments.length > 0) {
    // No wildcards at all — this is a literal path. Drop the filename.
    dirSegments.pop();
  }

  return dirSegments.join('/');
}

/**
 * Derives an implicit glob pattern from a hierarchical file's directory path.
 * Only applies to files NOT at the workspace root.
 * Root-level files return undefined (always-on, no glob needed).
 */
export function deriveGlobFromHierarchicalPath(
  filePath: string,
  workspaceRoot: string
): string | undefined {
  const dir = path.dirname(filePath);
  const relative = path.relative(workspaceRoot, dir).split(path.sep).join('/');

  // Root-level file — no implicit glob
  if (!relative || relative === '.') {
    return undefined;
  }

  return `${relative}/**/*`;
}
