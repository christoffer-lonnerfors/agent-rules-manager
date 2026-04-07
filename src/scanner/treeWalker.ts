import * as path from 'path';
import { FormatDefinition } from './formatDefinition';
import { FORMAT_DEFINITIONS } from './formatRegistry';
import { classify } from './formatClassifier';
import { ClassifiedFile } from './classifiedFile';

/** Maximum depth for recursive reference resolution */
const MAX_REFERENCE_DEPTH = 10;

// ── File system abstraction ───────────────────────────────────────────

/**
 * Minimal file system interface required by TreeWalker.
 * Inject a VS Code implementation in production; a stub in tests.
 */
export interface ScannerFileSystem {
  /** Read a file, returning its text content and metadata. */
  readFile(filePath: string): Promise<{ content: string; size: number; mtime: Date }>;
  /** Return true if the file exists at the given absolute path. */
  fileExists(filePath: string): Promise<boolean>;
  /**
   * Find files matching a glob pattern relative to a base directory.
   * Returns absolute file paths.
   */
  findFiles(baseDir: string, include: string, exclude?: string): Promise<string[]>;
}

// ── Case-insensitive glob helper ──────────────────────────────────────

/** Converts a filename to a case-insensitive glob, e.g. "AGENTS.md" → "[aA][gG]..." */
export function toCaseInsensitiveGlob(fileName: string): string {
  return fileName
    .split('')
    .map((ch) => {
      const lower = ch.toLowerCase();
      const upper = ch.toUpperCase();
      return lower !== upper ? `[${lower}${upper}]` : ch;
    })
    .join('');
}

// ── Tree walker ───────────────────────────────────────────────────────

/**
 * Tree-walking scanner that discovers, classifies, and follows references
 * in a single unified pipeline.
 *
 * Algorithm:
 *   1. Discover seed files from all FormatDefinitions
 *   2. Classify each file (parse, extract frontmatter, compute hashes, extract links)
 *   3. Resolve link targets against the filesystem
 *   4. Enqueue any unvisited targets for classification
 *   5. Repeat until no new files are discovered
 */
export class TreeWalker {
  constructor(private readonly fs: ScannerFileSystem) {}

  /**
   * Walk the workspace, discovering and classifying all rule files.
   */
  async walk(workspaceRoot: string): Promise<ClassifiedFile[]> {
    const visited = new Set<string>();
    const classified: ClassifiedFile[] = [];

    // Step 1: Discover seed files from all format definitions
    const seedPaths = await this.discoverSeeds(workspaceRoot);

    // Steps 2-5: BFS — classify each file and follow references
    const queue: Array<{ filePath: string; depth: number }> = seedPaths.map((p) => ({
      filePath: p,
      depth: 0,
    }));

    while (queue.length > 0) {
      const { filePath, depth } = queue.shift()!;

      if (visited.has(filePath)) {
        continue;
      }
      visited.add(filePath);

      if (depth > MAX_REFERENCE_DEPTH) {
        console.warn(
          `Agent Rules Manager: Reference depth limit (${MAX_REFERENCE_DEPTH}) reached at ${filePath}`,
        );
        continue;
      }

      try {
        const result = await this.classifyFile(filePath, workspaceRoot);
        if (!result) {
          continue;
        }

        classified.push(result);

        // Follow links to discover new files
        const fileDir = path.dirname(filePath);
        for (const link of result.links) {
          const resolved = path.resolve(fileDir, link.target);
          if (!visited.has(resolved) && (await this.fs.fileExists(resolved))) {
            queue.push({ filePath: resolved, depth: depth + 1 });
          }
        }
      } catch (err) {
        console.warn(`Agent Rules Manager: Failed to classify ${filePath}:`, err);
      }
    }

    return classified;
  }

  /**
   * Discover seed file paths from all format definitions.
   */
  private async discoverSeeds(workspaceRoot: string): Promise<string[]> {
    const paths: string[] = [];

    for (const def of FORMAT_DEFINITIONS) {
      if (def.discoverable === false) continue;
      const discovered = await this.discoverForFormat(workspaceRoot, def);
      paths.push(...discovered);
    }

    // Deduplicate by absolute path
    return [...new Set(paths)];
  }

  /**
   * Discover files matching a single format definition.
   */
  private async discoverForFormat(
    workspaceRoot: string,
    def: FormatDefinition,
  ): Promise<string[]> {
    if (def.isHierarchical) {
      return this.discoverHierarchical(workspaceRoot, def);
    } else if (def.validPaths.includes('.')) {
      return this.discoverStandalone(workspaceRoot, def);
    } else {
      return this.discoverDirectory(workspaceRoot, def);
    }
  }

  private async discoverHierarchical(
    workspaceRoot: string,
    def: FormatDefinition,
  ): Promise<string[]> {
    const paths: string[] = [];
    for (const fileName of def.validNames) {
      const ciGlob = toCaseInsensitiveGlob(fileName);
      const found = await this.fs.findFiles(workspaceRoot, `**/${ciGlob}`, '**/node_modules/**');
      paths.push(...found);
    }
    return paths;
  }

  private async discoverStandalone(
    workspaceRoot: string,
    def: FormatDefinition,
  ): Promise<string[]> {
    const paths: string[] = [];
    for (const fileName of def.validNames) {
      const filePath = path.join(workspaceRoot, fileName);
      if (await this.fs.fileExists(filePath)) {
        paths.push(filePath);
      }
    }
    return paths;
  }

  private async discoverDirectory(
    workspaceRoot: string,
    def: FormatDefinition,
  ): Promise<string[]> {
    const paths: string[] = [];
    for (const dir of def.validPaths) {
      const dirPath = path.join(workspaceRoot, dir);
      const exts = def.validExtensions;
      if (exts.length === 0) {
        continue;
      }
      const extGlob = exts.length === 1 ? `*${exts[0]}` : `*{${exts.join(',')}}`;
      try {
        const found = await this.fs.findFiles(dirPath, `**/${extGlob}`);
        paths.push(...found);
      } catch {
        // Directory may not exist — skip
      }
    }
    return paths;
  }

  /**
   * Classify a single file by reading it and passing through the classifier.
   */
  private async classifyFile(
    filePath: string,
    workspaceRoot: string,
  ): Promise<ClassifiedFile | undefined> {
    const { content, size, mtime } = await this.fs.readFile(filePath);
    return classify(filePath, content, size, mtime, workspaceRoot);
  }
}
