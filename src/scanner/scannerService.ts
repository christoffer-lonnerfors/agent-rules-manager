import * as vscode from 'vscode';
import * as path from 'path';
import * as crypto from 'crypto';
import { IndexedRule } from '../types';
import { discoverFiles } from './fileDiscovery';
import { parseFrontmatter, extractFirstHeading } from './frontmatterParser';
import { normalizeTrigger } from './triggerNormalizer';
import { extractReferences } from './referenceExtractor';
import { computeMinHash } from '../hashing/minHasher';
import { RuleIndex, generateRuleId } from '../index/ruleIndex';
import { mapWithConcurrency } from '../utils/concurrency';

/**
 * Orchestrates workspace scanning: discovers files, parses frontmatter,
 * normalizes triggers, computes MinHash signatures, and populates the index.
 */
export class ScannerService {
  private _onScanStarted = new vscode.EventEmitter<void>();
  private _onScanCompleted = new vscode.EventEmitter<{ count: number; durationMs: number }>();
  readonly onScanStarted = this._onScanStarted.event;
  readonly onScanCompleted = this._onScanCompleted.event;

  private scanning = false;

  constructor(private readonly ruleIndex: RuleIndex) { }

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
      const discovered = await discoverFiles(workspaceRoot);

      const results = await mapWithConcurrency(
        discovered,
        async (file) => {
          try {
            return await this.processFile(file.filePath, file.format, file.sourceType, workspaceRoot, file.extensionMismatch);
          } catch (err) {
            console.warn(`Agent Rules Manager: Failed to process ${file.filePath}:`, err);
            return undefined;
          }
        },
        20,
      );
      const rules = results.filter((r): r is IndexedRule => r !== undefined);

      await this.ruleIndex.replaceAll(rules);

      const durationMs = Date.now() - startTime;
      this._onScanCompleted.fire({ count: rules.length, durationMs });

      if (!silent) {
        vscode.window.showInformationMessage(
          `Agent Rules Manager: Found ${rules.length} rule(s) in ${durationMs}ms.`
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

  private async processFile(
    filePath: string,
    format: IndexedRule['format'],
    sourceType: IndexedRule['sourceType'],
    workspaceRoot: string,
    extensionMismatch?: boolean
  ): Promise<IndexedRule | undefined> {
    const uri = vscode.Uri.file(filePath);
    const stat = await vscode.workspace.fs.stat(uri);
    const contentBytes = await vscode.workspace.fs.readFile(uri);
    const content = Buffer.from(contentBytes).toString('utf-8');

    const { fields, body } = parseFrontmatter(content);
    const { trigger, globs, description: fmDescription } = normalizeTrigger(
      format, fields, filePath, sourceType, workspaceRoot
    );

    // Fall back to first markdown heading if no frontmatter description
    const description = fmDescription ?? extractFirstHeading(body);

    const contentHash = computeMinHash(body);
    const bodyHash = crypto.createHash('sha256').update(body).digest('hex');
    const bodyLength = body.trim().length;
    const references = extractReferences(body);

    return {
      id: generateRuleId(filePath),
      filePath,
      fileName: path.basename(filePath),
      fileExtension: path.extname(filePath).toLowerCase(),
      format,
      sourceType,
      trigger,
      description,
      globs,
      contentHash,
      bodyHash,
      bodyLength,
      references,
      fileSize: stat.size,
      lastModified: new Date(stat.mtime).toISOString(),
      rawFrontmatter: Object.keys(fields).length > 0 ? fields : undefined,
      ...(extensionMismatch ? { extensionMismatch: true } : {}),
    };
  }

  dispose(): void {
    this._onScanStarted.dispose();
    this._onScanCompleted.dispose();
  }
}