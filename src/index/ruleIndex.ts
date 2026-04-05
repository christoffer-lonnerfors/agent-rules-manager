import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { IndexedRule, LogicalRule } from '../types';
import { buildLogicalRules } from './logicalRuleBuilder';

const STORAGE_KEY = 'agentRules.ruleIndex';

/**
 * In-memory rule index with persistence to workspaceState.
 */
export class RuleIndex {
  private rules = new Map<string, IndexedRule>();
  private logicalRulesCache: LogicalRule[] | null = null;
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly context: vscode.ExtensionContext) { }

  /** Load persisted index from workspaceState */
  load(): void {
    const stored = this.context.workspaceState.get<IndexedRule[]>(STORAGE_KEY);
    this.rules.clear();
    if (stored) {
      for (const rule of stored) {
        this.rules.set(rule.id, rule);
      }
    }
  }

  /** Persist current index to workspaceState */
  async save(): Promise<void> {
    const allRules = Array.from(this.rules.values());
    await this.context.workspaceState.update(STORAGE_KEY, allRules);
  }

  /** Replace the entire index with new rules (used on full scan) */
  async replaceAll(rules: IndexedRule[]): Promise<void> {
    this.rules.clear();
    for (const rule of rules) {
      this.rules.set(rule.id, rule);
    }
    this.logicalRulesCache = null;
    await this.save();
    this._onDidChange.fire();
  }

  /** Get a single rule by ID */
  get(id: string): IndexedRule | undefined {
    return this.rules.get(id);
  }

  /** Get all indexed rules */
  getAll(): IndexedRule[] {
    return Array.from(this.rules.values());
  }

  /** Get rules filtered by format */
  getByFormat(format: string): IndexedRule[] {
    return this.getAll().filter(r => r.format === format);
  }

  /** Get rules filtered by trigger */
  getByTrigger(trigger: string): IndexedRule[] {
    return this.getAll().filter(r => r.trigger === trigger);
  }

  /** Number of indexed rules */
  get size(): number {
    return this.rules.size;
  }

  /** Whether the index has any rules */
  get isEmpty(): boolean {
    return this.rules.size === 0;
  }

  /**
   * Get logical rules (grouped from indexed rules via MinHash similarity).
   * Result is lazily computed and cached — invalidated on replaceAll() / clear().
   */
  getLogicalRules(): LogicalRule[] {
    if (this.logicalRulesCache === null) {
      this.logicalRulesCache = buildLogicalRules(this.getAll());
    }
    return this.logicalRulesCache;
  }

  /** Clear the index entirely */
  async clear(): Promise<void> {
    this.rules.clear();
    this.logicalRulesCache = null;
    await this.save();
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

/** Generate a deterministic ID for a rule based on its file path */
export function generateRuleId(filePath: string): string {
  return crypto.createHash('sha256').update(filePath).digest('hex').substring(0, 16);
}

