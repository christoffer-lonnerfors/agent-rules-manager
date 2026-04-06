import * as vscode from 'vscode';
import * as path from 'path';
import { DiscoveredFile, CandidateFile } from '../types';
import { FormatScanConfig } from './scannerTypes';
import { FORMAT_CONFIGS } from './formatDetector';

/**
 * Discovers all candidate rule files in the workspace.
 * Scans format directories, standalone files, and hierarchical MD files.
 */
export async function discoverFiles(workspaceRoot: string): Promise<DiscoveredFile[]> {
  const discovered: DiscoveredFile[] = [];
  const rootUri = vscode.Uri.file(workspaceRoot);

  for (const config of FORMAT_CONFIGS) {
    const [dirFiles, standaloneFiles, hierarchicalFiles] = await Promise.all([
      discoverDirectoryRules(rootUri, config),
      discoverStandaloneFiles(rootUri, config),
      discoverHierarchicalFiles(rootUri, config),
    ]);
    discovered.push(...dirFiles, ...standaloneFiles, ...hierarchicalFiles);
  }

  // No deduplication — a file can legitimately belong to multiple formats
  // (e.g. CLAUDE.md is both 'claude-md' format, readable by multiple agents).
  // Each format's scan config produces its own DiscoveredFile entries.
  // However, within the same format, deduplicate by filePath.
  const byFormatAndPath = new Map<string, DiscoveredFile>();
  for (const file of discovered) {
    const key = `${file.format}::${file.filePath}`;
    byFormatAndPath.set(key, file);
  }

  return Array.from(byFormatAndPath.values());
}

/** Text-like extensions we consider as potential rule files when checking for mismatches */
const TEXT_LIKE_EXTENSIONS = ['.md', '.mdc', '.mdx', '.txt', '.yaml', '.yml'];

async function discoverDirectoryRules(
  rootUri: vscode.Uri,
  config: FormatScanConfig,
): Promise<DiscoveredFile[]> {
  const results: DiscoveredFile[] = [];

  for (const dir of config.directories) {
    const dirUri = vscode.Uri.joinPath(rootUri, dir);

    // Discover files with correct extensions
    const files = await findFilesRecursive(dirUri, config.extensions);
    for (const filePath of files) {
      results.push({
        filePath,
        format: config.format,
        sourceType: 'directory_rule',
      });
    }

    // Also discover text-like files with WRONG extensions (extension mismatch)
    const mismatchExts = TEXT_LIKE_EXTENSIONS.filter((ext) => !config.extensions.includes(ext));
    if (mismatchExts.length > 0) {
      const mismatchFiles = await findFilesRecursive(dirUri, mismatchExts);
      for (const filePath of mismatchFiles) {
        results.push({
          filePath,
          format: config.format,
          sourceType: 'directory_rule',
          extensionMismatch: true,
        });
      }
    }
  }

  return results;
}

async function discoverStandaloneFiles(
  rootUri: vscode.Uri,
  config: FormatScanConfig,
): Promise<DiscoveredFile[]> {
  const results: DiscoveredFile[] = [];

  for (const fileName of config.standaloneFiles) {
    const fileUri = vscode.Uri.joinPath(rootUri, fileName);
    if (await fileExists(fileUri)) {
      results.push({
        filePath: fileUri.fsPath,
        format: config.format,
        sourceType: 'standalone_file',
      });
    }
  }

  return results;
}

async function discoverHierarchicalFiles(
  rootUri: vscode.Uri,
  config: FormatScanConfig,
): Promise<DiscoveredFile[]> {
  if (config.hierarchicalFiles.length === 0) {
    return [];
  }

  const results: DiscoveredFile[] = [];

  for (const fileName of config.hierarchicalFiles) {
    // Use a case-insensitive glob to catch variations like agents.md, Agents.md
    // on case-sensitive file systems (Linux)
    const ciGlob = toCaseInsensitiveGlob(fileName);
    const pattern = new vscode.RelativePattern(rootUri, `**/${ciGlob}`);
    const uris = await vscode.workspace.findFiles(pattern, '**/node_modules/**');

    for (const uri of uris) {
      results.push({
        filePath: uri.fsPath,
        format: config.format,
        sourceType: 'hierarchical_md',
      });
    }
  }

  return results;
}

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

/** Recursively find files with given extensions under a directory */
async function findFilesRecursive(dirUri: vscode.Uri, extensions: string[]): Promise<string[]> {
  const results: string[] = [];

  // Build a glob pattern for vscode.workspace.findFiles
  const extGlob = extensions.length === 1 ? `*${extensions[0]}` : `*{${extensions.join(',')}}`;
  const pattern = new vscode.RelativePattern(dirUri, `**/${extGlob}`);

  const uris = await vscode.workspace.findFiles(pattern);
  for (const uri of uris) {
    results.push(uri.fsPath);
  }

  return results;
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * Discovers all candidate files in the workspace using configurable glob patterns.
 * Returns a Map of absolute file path → CandidateFile for quick lookup during
 * reference resolution (Phase 3).
 */
export async function discoverCandidates(
  workspaceRoot: string,
): Promise<Map<string, CandidateFile>> {
  const cfg = vscode.workspace.getConfiguration('agentRules');
  const patterns: string[] = cfg.get('candidatePatterns', ['**/*.md', '**/*.mdc', '**/*.mdx']);
  const excludes: string[] = cfg.get('candidateExclude', [
    '**/node_modules/**',
    '**/dist/**',
    '**/.git/**',
  ]);

  const rootUri = vscode.Uri.file(workspaceRoot);
  const excludePattern = excludes.length > 0 ? `{${excludes.join(',')}}` : undefined;

  const candidates = new Map<string, CandidateFile>();

  for (const pattern of patterns) {
    const relPattern = new vscode.RelativePattern(rootUri, pattern);
    const uris = await vscode.workspace.findFiles(relPattern, excludePattern);

    for (const uri of uris) {
      const filePath = uri.fsPath;
      if (candidates.has(filePath)) {
        continue;
      }

      try {
        const stat = await vscode.workspace.fs.stat(uri);
        candidates.set(filePath, {
          filePath,
          fileExtension: path.extname(filePath).toLowerCase(),
          fileSize: stat.size,
        });
      } catch {
        // File may have been deleted between findFiles and stat — skip
      }
    }
  }

  return candidates;
}
