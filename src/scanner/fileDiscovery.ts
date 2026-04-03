import * as vscode from 'vscode';
import * as path from 'path';
import { DiscoveredFile, FormatScanConfig } from './scannerTypes';
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

  // Deduplicate by filePath — if a file was claimed by multiple formats,
  // keep the LAST one (later formats in FORMAT_CONFIGS are more specific/main)
  const byPath = new Map<string, DiscoveredFile>();
  for (const file of discovered) {
    byPath.set(file.filePath, file);
  }

  return Array.from(byPath.values());
}

/** Text-like extensions we consider as potential rule files when checking for mismatches */
const TEXT_LIKE_EXTENSIONS = ['.md', '.mdc', '.mdx', '.txt', '.yaml', '.yml'];

async function discoverDirectoryRules(
  rootUri: vscode.Uri,
  config: FormatScanConfig
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
    const mismatchExts = TEXT_LIKE_EXTENSIONS.filter(ext => !config.extensions.includes(ext));
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
  config: FormatScanConfig
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
  config: FormatScanConfig
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
    .map(ch => {
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
async function findFilesRecursive(
  dirUri: vscode.Uri,
  extensions: string[]
): Promise<string[]> {
  const results: string[] = [];

  // Build a glob pattern for vscode.workspace.findFiles
  const extGlob = extensions.length === 1
    ? `*${extensions[0]}`
    : `*{${extensions.join(',')}}`;
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

