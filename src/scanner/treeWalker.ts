import * as vscode from 'vscode';
import * as path from 'path';
import { FormatDefinition } from './formatDefinition';
import { FORMAT_DEFINITIONS } from './formatRegistry';
import { classify } from './formatClassifier';
import { ClassifiedFile } from './classifiedFile';
import { toCaseInsensitiveGlob } from './fileDiscovery';

/** Maximum depth for recursive reference resolution */
const MAX_REFERENCE_DEPTH = 10;

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
 *
 * Returns ClassifiedFile[] which can be converted to IndexedRule[] for
 * downstream consumption.
 */
export class TreeWalker {
  /**
   * Walk the workspace, discovering and classifying all rule files.
   */
  async walk(workspaceRoot: string): Promise<ClassifiedFile[]> {
    const rootUri = vscode.Uri.file(workspaceRoot);
    const visited = new Set<string>();
    const classified: ClassifiedFile[] = [];

    // Step 1: Discover seed files from all format definitions
    const seedPaths = await this.discoverSeeds(rootUri);

    // Step 2-5: BFS — classify each file and follow references
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
          if (!visited.has(resolved) && (await this.fileExists(resolved))) {
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
  private async discoverSeeds(rootUri: vscode.Uri): Promise<string[]> {
    const paths: string[] = [];

    for (const def of FORMAT_DEFINITIONS) {
      if (def.discoverable === false) continue;
      const discovered = await this.discoverForFormat(rootUri, def);
      paths.push(...discovered);
    }

    // Deduplicate by absolute path
    return [...new Set(paths)];
  }

  /**
   * Discover files matching a single format definition.
   */
  private async discoverForFormat(
    rootUri: vscode.Uri,
    def: FormatDefinition,
  ): Promise<string[]> {
    if (def.isHierarchical) {
      return this.discoverHierarchical(rootUri, def);
    } else if (def.validPaths.includes('.')) {
      return this.discoverStandalone(rootUri, def);
    } else {
      return this.discoverDirectory(rootUri, def);
    }
  }

  private async discoverHierarchical(
    rootUri: vscode.Uri,
    def: FormatDefinition,
  ): Promise<string[]> {
    const paths: string[] = [];
    for (const fileName of def.validNames) {
      const ciGlob = toCaseInsensitiveGlob(fileName);
      const pattern = new vscode.RelativePattern(rootUri, `**/${ciGlob}`);
      const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**');
      for (const uri of uris) {
        paths.push(uri.fsPath);
      }
    }
    return paths;
  }

  private async discoverStandalone(
    rootUri: vscode.Uri,
    def: FormatDefinition,
  ): Promise<string[]> {
    const paths: string[] = [];
    for (const fileName of def.validNames) {
      const fileUri = vscode.Uri.joinPath(rootUri, fileName);
      if (await this.fileExists(fileUri.fsPath)) {
        paths.push(fileUri.fsPath);
      }
    }
    return paths;
  }

  private async discoverDirectory(
    rootUri: vscode.Uri,
    def: FormatDefinition,
  ): Promise<string[]> {
    const paths: string[] = [];
    for (const dir of def.validPaths) {
      const dirUri = vscode.Uri.joinPath(rootUri, dir);
      const exts = def.validExtensions;
      if (exts.length === 0) {
        continue;
      }
      const extGlob = exts.length === 1 ? `*${exts[0]}` : `*{${exts.join(',')}}`;
      const pattern = new vscode.RelativePattern(dirUri, `**/${extGlob}`);
      try {
        const uris = await vscode.workspace.findFiles(pattern);
        for (const uri of uris) {
          paths.push(uri.fsPath);
        }
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
    const uri = vscode.Uri.file(filePath);
    const stat = await vscode.workspace.fs.stat(uri);
    const contentBytes = await vscode.workspace.fs.readFile(uri);
    const content = Buffer.from(contentBytes).toString('utf-8');

    return classify(filePath, content, stat.size, new Date(stat.mtime), workspaceRoot);
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      return true;
    } catch {
      return false;
    }
  }
}

