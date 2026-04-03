/** The 7 supported AI agent rule formats */
export type RuleFormat =
  | 'cursor'
  | 'windsurf'
  | 'kiro'
  | 'antigravity'
  | 'augment'
  | 'claude-code'
  | 'agents-md';

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

  /** File size in bytes */
  fileSize: number;

  /** Last modified timestamp (ISO string) */
  lastModified: string;

  /** Raw frontmatter fields (preserved for format-specific display) */
  rawFrontmatter: Record<string, unknown> | undefined;

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

/** Similarity match between two rules */
export interface SimilarityMatch {
  ruleA: string; // ID
  ruleB: string; // ID
  similarity: number; // Jaccard similarity 0..1
}



