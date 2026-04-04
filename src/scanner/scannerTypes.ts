/** The 8 supported AI agent rule formats */
export type RuleFormat =
  | 'cursor'
  | 'windsurf'
  | 'kiro'
  | 'antigravity'
  | 'augment'
  | 'claude-code'
  | 'claude-md'
  | 'agents-md';

/** Human-readable labels for each format (used in UI and lint messages) */
export const FORMAT_LABELS: Record<RuleFormat, string> = {
  'cursor': 'Cursor',
  'windsurf': 'Windsurf',
  'kiro': 'Kiro',
  'antigravity': 'Antigravity',
  'augment': 'Augment',
  'claude-code': 'Claude Code',
  'claude-md': 'CLAUDE.md',
  'agents-md': 'AGENTS.md',
};

// ── Agent concept ──────────────────────────────────────────────────────

/** Supported AI agent identifiers */
export type AgentId =
  | 'cursor'
  | 'windsurf'
  | 'kiro'
  | 'antigravity'
  | 'augment'
  | 'claude-code';

/** Configuration for a single AI agent */
export interface AgentConfig {
  /** Agent identifier */
  id: AgentId;
  /** Human-readable label (used in UI) */
  label: string;
  /** Agent-specific format(s) where new rules are written by default */
  primaryFormats: RuleFormat[];
  /** Cross-agent formats this agent also reads at runtime */
  supportedFormats: RuleFormat[];
}

/** Human-readable labels for each agent (used in UI) */
export const AGENT_LABELS: Record<AgentId, string> = {
  'cursor': 'Cursor',
  'windsurf': 'Windsurf',
  'kiro': 'Kiro',
  'antigravity': 'Antigravity',
  'augment': 'Augment',
  'claude-code': 'Claude Code',
};

/**
 * Agent configurations — maps each agent to its primary and supported formats.
 * Based on official documentation for each agent.
 */
export const AGENT_CONFIGS: AgentConfig[] = [
  {
    id: 'cursor',
    label: 'Cursor',
    primaryFormats: ['cursor'],
    supportedFormats: ['agents-md'],
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    primaryFormats: ['windsurf'],
    supportedFormats: [],
  },
  {
    id: 'kiro',
    label: 'Kiro',
    primaryFormats: ['kiro'],
    supportedFormats: [],
  },
  {
    id: 'antigravity',
    label: 'Antigravity',
    primaryFormats: ['antigravity'],
    supportedFormats: [],
  },
  {
    id: 'augment',
    label: 'Augment',
    primaryFormats: ['augment'],
    supportedFormats: ['agents-md', 'claude-md'],
  },
  {
    id: 'claude-code',
    label: 'Claude Code',
    primaryFormats: ['claude-code'],
    supportedFormats: ['claude-md', 'agents-md'],
  },
];

/** Get the agent config for a given agent ID */
export function getAgentConfig(agentId: AgentId): AgentConfig {
  return AGENT_CONFIGS.find(a => a.id === agentId)!;
}

/** Get all formats an agent can read (primary + supported) */
export function getReadableFormats(agentId: AgentId): RuleFormat[] {
  const config = getAgentConfig(agentId);
  return [...config.primaryFormats, ...config.supportedFormats];
}

/** Get the default write format for an agent (first primary format) */
export function getDefaultWriteFormat(agentId: AgentId): RuleFormat {
  return getAgentConfig(agentId).primaryFormats[0];
}

/**
 * Get the effective write format, validating that it's readable by the agent.
 * Falls back to the agent's default write format if the override is invalid.
 */
export function getEffectiveWriteFormat(agentId: AgentId, writeFormatOverride: RuleFormat | ''): RuleFormat {
  if (writeFormatOverride) {
    const readable = getReadableFormats(agentId);
    if (readable.includes(writeFormatOverride)) {
      return writeFormatOverride;
    }
  }
  return getDefaultWriteFormat(agentId);
}

/** Check whether a logical rule is covered by any of the agent's readable formats */
export function isRuleCoveredByAgent(ruleFormats: RuleFormat[], agentId: AgentId): boolean {
  const readable = getReadableFormats(agentId);
  return ruleFormats.some(f => readable.includes(f));
}

/** Normalized activation trigger */
export type RuleTrigger = 'always' | 'glob' | 'agent_requested' | 'manual';

/** Source file type — distinguishes directory rules from special standalone files */
export type RuleSourceType =
  | 'directory_rule'    // File in a format's rules directory
  | 'standalone_file'   // Root-level special file (.windsurfrules, .augment-guidelines, CLAUDE.local.md)
  | 'hierarchical_md';  // AGENTS.md or CLAUDE.md discovered hierarchically

/** A single indexed rule with all extracted metadata */
export interface IndexedRule {
  /** Unique ID (deterministic hash of filePath) */
  id: string;

  /** Absolute file path */
  filePath: string;

  /** File name including extension (e.g., "my-rule.mdc") */
  fileName: string;

  /** File extension (e.g., ".mdc", ".md") */
  fileExtension: string;

  /** Which format this rule belongs to */
  format: RuleFormat;

  /** How the file was discovered */
  sourceType: RuleSourceType;

  /** Normalized activation trigger */
  trigger: RuleTrigger;

  /** Human-readable description (from frontmatter, if present) */
  description: string | undefined;

  /** Glob patterns (normalized to string[]), regardless of source field name */
  globs: string[] | undefined;

  /** MinHash signature of the rule body content (128 × uint32) */
  contentHash: number[];

  /** SHA-256 hex digest of the trimmed rule body (for exact divergence detection) */
  bodyHash: string;

  /** Character length of the rule body (content after frontmatter) */
  bodyLength: number;

  /** File size in bytes */
  fileSize: number;

  /** Last modified timestamp (ISO string) */
  lastModified: string;

  /** Raw frontmatter fields (preserved for format-specific display) */
  rawFrontmatter: Record<string, unknown> | undefined;

  /**
   * Relative file paths referenced from the rule body (markdown links, etc.).
   * Resolved relative to the rule file's directory during scanning.
   * Used by the broken-reference lint check.
   */
  references: string[];

  /**
   * True when the file sits in a format directory but has the wrong extension
   * (e.g., .mdc in .augment/rules/). The rule is still indexed and grouped,
   * but the tree view will show a warning indicator.
   */
  extensionMismatch?: boolean;
}

/** Format-specific scanning configuration */
export interface FormatScanConfig {
  format: RuleFormat;
  /** Directories to scan recursively (relative to workspace root) */
  directories: string[];
  /** File extensions to match in those directories */
  extensions: string[];
  /** Special standalone files at workspace root */
  standaloneFiles: string[];
  /** Hierarchical MD filenames to discover in root + subdirectories */
  hierarchicalFiles: string[];
}

/** Result of parsing frontmatter from a rule file */
export interface ParsedFrontmatter {
  /** Extracted YAML fields */
  fields: Record<string, unknown>;
  /** Content body after frontmatter */
  body: string;
  /** Raw frontmatter string (between --- delimiters) */
  rawYaml: string;
}

/**
 * A logical rule that merges near-duplicate IndexedRules across formats.
 * Represents a single "concept" that may exist in multiple agent rule formats.
 */
export interface LogicalRule {
  /** Unique ID (derived from the group's primary rule) */
  id: string;

  /** Best available description (frontmatter > heading > filename) */
  description: string;

  /** Normalized activation trigger (from the primary rule) */
  trigger: RuleTrigger;

  /** Glob patterns (from the primary rule, if applicable) */
  globs: string[] | undefined;

  /** Which formats have a version of this rule */
  formats: RuleFormat[];

  /** The individual rule files that make up this logical rule */
  rules: IndexedRule[];

  /** Minimum pairwise similarity among merged rules (1.0 = identical, <1.0 = diverged) */
  minSimilarity: number;
}

/** A discovered file before full parsing */
export interface DiscoveredFile {
  /** Absolute path */
  filePath: string;
  /** Detected format */
  format: RuleFormat;
  /** How it was found */
  sourceType: RuleSourceType;
  /** True when the file extension doesn't match the format's expected extensions */
  extensionMismatch?: boolean;
}
