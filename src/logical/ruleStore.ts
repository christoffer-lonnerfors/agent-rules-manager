import * as path from 'path';
import * as vscode from 'vscode';
import { ClassifiedFile } from '../scanner/classifiedFile';
import { LogicalRule } from './logicalRule';
import { buildLogicalRules } from './logicalRuleBuilder';

const STORAGE_FILE = 'ruleIndex.v2.json';
/** Legacy memento key — cleared on first load to reclaim space */
const LEGACY_STORAGE_KEY = 'agentRules.ruleIndex.v2';

/**
 * In-memory store of ClassifiedFiles with persistence to disk (storageUri).
 * Produces a derived logical-rule view by grouping near-duplicate files across formats.
 */
export class RuleStore {
  private rules = new Map<string, ClassifiedFile>();
  private rulesByPath = new Map<string, ClassifiedFile>();
  private logicalRulesCache: LogicalRule[] | null = null;
  private backlinkIndex: Map<string, string[]> | null = null;
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Load persisted store from disk, falling back to legacy workspaceState */
  async load(): Promise<void> {
    this.rules.clear();
    const stored = await this.readFromDisk();
    if (stored) {
      for (const rule of stored) {
        this.rules.set(rule.id, rule);
      }
      // Clear the legacy memento entry so VS Code stops warning about its size
      await this.context.workspaceState.update(LEGACY_STORAGE_KEY, undefined);
    } else {
      const legacy = this.context.workspaceState.get<ClassifiedFile[]>(LEGACY_STORAGE_KEY);
      if (legacy) {
        for (const rule of legacy) {
          this.rules.set(rule.id, rule);
        }
        await this.save();
        await this.context.workspaceState.update(LEGACY_STORAGE_KEY, undefined);
      }
    }
  }

  /** Persist current store to disk */
  async save(): Promise<void> {
    const allRules = Array.from(this.rules.values());
    await this.writeToDisk(allRules);
  }

  private storageUri(): vscode.Uri | undefined {
    return this.context.storageUri
      ? vscode.Uri.joinPath(this.context.storageUri, STORAGE_FILE)
      : undefined;
  }

  private async readFromDisk(): Promise<ClassifiedFile[] | undefined> {
    const uri = this.storageUri();
    if (!uri) {
      return undefined;
    }
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return JSON.parse(Buffer.from(bytes).toString('utf8')) as ClassifiedFile[];
    } catch {
      return undefined;
    }
  }

  private async writeToDisk(rules: ClassifiedFile[]): Promise<void> {
    const uri = this.storageUri();
    if (!uri) {
      return;
    }
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(rules), 'utf8'));
  }

  /** Replace the entire store with new rules (used on full scan) */
  async replaceAll(rules: ClassifiedFile[]): Promise<void> {
    this.rules.clear();
    this.rulesByPath.clear();
    for (const rule of rules) {
      this.rules.set(rule.id, rule);
      this.rulesByPath.set(rule.filePath, rule);
    }
    this.logicalRulesCache = null;
    this.backlinkIndex = null;
    await this.save();
    this._onDidChange.fire();
  }

  /** Get a single rule by ID */
  get(id: string): ClassifiedFile | undefined {
    return this.rules.get(id);
  }

  /** Get all stored rules */
  getAll(): ClassifiedFile[] {
    return Array.from(this.rules.values());
  }

  /** Get rules filtered by format */
  getByFormat(format: string): ClassifiedFile[] {
    return this.getAll().filter((r) => r.format === format);
  }

  /** Get rules filtered by trigger */
  getByTrigger(trigger: string): ClassifiedFile[] {
    return this.getAll().filter((r) => r.trigger === trigger);
  }

  /** Number of stored rules */
  get size(): number {
    return this.rules.size;
  }

  /** Whether the store has any rules */
  get isEmpty(): boolean {
    return this.rules.size === 0;
  }

  /**
   * Get logical rules (grouped from stored rules via MinHash similarity).
   * Result is lazily computed and cached — invalidated on replaceAll() / clear().
   */
  getLogicalRules(): LogicalRule[] {
    if (this.logicalRulesCache === null) {
      this.logicalRulesCache = buildLogicalRules(this.getAll());
    }
    return this.logicalRulesCache;
  }

  /** Clear the store entirely */
  async clear(): Promise<void> {
    this.rules.clear();
    this.rulesByPath.clear();
    this.logicalRulesCache = null;
    this.backlinkIndex = null;
    await this.save();
    this._onDidChange.fire();
  }

  /** Get all rules that contain a link pointing at the given rule */
  getReferencedBy(ruleId: string): ClassifiedFile[] {
    if (!this.backlinkIndex) {
      this.backlinkIndex = this.buildBacklinkIndex();
    }
    return (this.backlinkIndex.get(ruleId) ?? [])
      .map((id) => this.rules.get(id))
      .filter((r): r is ClassifiedFile => r !== undefined);
  }

  private buildBacklinkIndex(): Map<string, string[]> {
    const index = new Map<string, string[]>();
    for (const rule of this.rules.values()) {
      for (const link of rule.links) {
        const absTarget = path.resolve(path.dirname(rule.filePath), link.target);
        const target = this.rulesByPath.get(absTarget);
        if (target) {
          const sources = index.get(target.id) ?? [];
          sources.push(rule.id);
          index.set(target.id, sources);
        }
      }
    }
    return index;
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

// Re-export for callers that imported generateRuleId from here
export { generateRuleId } from '../scanner/formatClassifier';
