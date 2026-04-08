import * as path from 'path';
import * as vscode from 'vscode';
import { ClassifiedFile } from '../scanner/classifiedFile';
import { generateRuleId } from '../scanner/formatClassifier';
import { LogicalRule } from './logicalRule';
import { buildLogicalRules } from './logicalRuleBuilder';

const STORAGE_KEY = 'agentRules.ruleIndex.v2';

/**
 * In-memory store of ClassifiedFiles with persistence to workspaceState.
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

  /** Load persisted store from workspaceState */
  load(): void {
    const stored = this.context.workspaceState.get<ClassifiedFile[]>(STORAGE_KEY);
    this.rules.clear();
    if (stored) {
      for (const rule of stored) {
        this.rules.set(rule.id, rule);
      }
    }
  }

  /** Persist current store to workspaceState */
  async save(): Promise<void> {
    const allRules = Array.from(this.rules.values());
    await this.context.workspaceState.update(STORAGE_KEY, allRules);
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
