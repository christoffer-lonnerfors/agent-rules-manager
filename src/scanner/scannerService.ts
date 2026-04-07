import * as vscode from 'vscode';
import { RuleStore } from '../logical/ruleStore';
import { ScannerFileSystem, TreeWalker } from './treeWalker';

// ── VS Code file system adapter ───────────────────────────────────────

class VsCodeFileSystem implements ScannerFileSystem {
  async readFile(filePath: string): Promise<{ content: string; size: number; mtime: Date }> {
    const uri = vscode.Uri.file(filePath);
    const stat = await vscode.workspace.fs.stat(uri);
    const bytes = await vscode.workspace.fs.readFile(uri);
    return {
      content: Buffer.from(bytes).toString('utf-8'),
      size: stat.size,
      mtime: new Date(stat.mtime),
    };
  }

  async fileExists(filePath: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
      return true;
    } catch {
      return false;
    }
  }

  async findFiles(baseDir: string, include: string, exclude?: string): Promise<string[]> {
    const pattern = new vscode.RelativePattern(vscode.Uri.file(baseDir), include);
    const uris = await vscode.workspace.findFiles(pattern, exclude);
    return uris.map((u) => u.fsPath);
  }
}

// ── Scanner service ───────────────────────────────────────────────────

/**
 * Orchestrates workspace scanning using the tree-walking pipeline.
 * Discovers → classifies → follows references → stores as ClassifiedFile[].
 */
export class ScannerService {
  private _onScanStarted = new vscode.EventEmitter<void>();
  private _onScanCompleted = new vscode.EventEmitter<{ count: number; durationMs: number }>();
  readonly onScanStarted = this._onScanStarted.event;
  readonly onScanCompleted = this._onScanCompleted.event;

  private scanning = false;
  private readonly walker = new TreeWalker(new VsCodeFileSystem());

  constructor(private readonly ruleIndex: RuleStore) {}

  get isScanning(): boolean {
    return this.scanning;
  }

  /**
   * Run a full workspace scan. Discovers all rule files, parses them,
   * and replaces the current index.
   * @param options.silent If true, suppress info notifications (used for auto-scans)
   */
  async scan(options?: { silent?: boolean }): Promise<void> {
    const silent = options?.silent ?? false;
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      if (!silent) {
        vscode.window.showWarningMessage('Agent Rules Manager: No workspace folder open.');
      }
      return;
    }

    if (this.scanning) {
      if (!silent) {
        vscode.window.showInformationMessage('Agent Rules Manager: Scan already in progress.');
      }
      return;
    }

    this.scanning = true;
    this._onScanStarted.fire();
    const startTime = Date.now();

    try {
      const workspaceRoot = workspaceFolder.uri.fsPath;

      // Tree-walk: discover → classify → follow references
      const rules = await this.walker.walk(workspaceRoot);

      await this.ruleIndex.replaceAll(rules);

      const durationMs = Date.now() - startTime;
      this._onScanCompleted.fire({ count: rules.length, durationMs });

      if (!silent) {
        vscode.window.showInformationMessage(
          `Agent Rules Manager: Found ${rules.length} rule(s) in ${durationMs}ms.`,
        );
      }
    } catch (err) {
      console.error('Agent Rules Manager: Scan failed:', err);
      if (!silent) {
        vscode.window.showErrorMessage(`Agent Rules Manager: Scan failed — ${err}`);
      }
    } finally {
      this.scanning = false;
    }
  }

  dispose(): void {
    this._onScanStarted.dispose();
    this._onScanCompleted.dispose();
  }
}
