import * as vscode from 'vscode';
import { CandidateFile } from '../types';

/**
 * In-memory store for unresolved candidate files.
 * These are files that matched candidatePatterns but were neither
 * pattern-classified nor promoted via reference resolution.
 */
export class CandidateStore {
  private candidates = new Map<string, CandidateFile>();
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  /** Replace all candidates (called after each scan) */
  replaceAll(candidates: CandidateFile[]): void {
    this.candidates.clear();
    for (const c of candidates) {
      this.candidates.set(c.filePath, c);
    }
    this._onDidChange.fire();
  }

  /** Get all unresolved candidates */
  getAll(): CandidateFile[] {
    return Array.from(this.candidates.values());
  }

  /** Check if a file path is a known candidate */
  has(filePath: string): boolean {
    return this.candidates.has(filePath);
  }

  /** Number of unresolved candidates */
  get size(): number {
    return this.candidates.size;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
