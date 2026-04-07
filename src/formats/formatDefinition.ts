// ── Trigger ──────────────────────────────────────────────────────────

/** Normalized activation trigger for a rule file */
export type RuleTrigger = 'always' | 'glob' | 'agent_requested' | 'manual';

// ── Link patterns ────────────────────────────────────────────────────

/**
 * A pattern for extracting file path references from rule body content.
 *
 * Pure parser concern — extracts links only. How extracted links are
 * interpreted (alias vs reference) is a downstream semantic decision.
 */
export interface LinkPattern {
  /** Identifier for this pattern (e.g. 'markdown-link', 'at-import') */
  id: string;
  /** Regex with one capture group for the file path. */
  regex: RegExp;
}

/** A reference extracted by applying a LinkPattern to body content */
export interface ExtractedLink {
  /** Which pattern produced this link */
  patternId: string;
  /** The raw captured file path */
  target: string;
}

// ── Frontmatter field definitions ────────────────────────────────────

/** The classified rule property that a frontmatter field maps to */
export type FieldMapping = 'trigger' | 'globs' | 'description';

/** Expected type of a frontmatter field value */
export type FieldType = 'string' | 'boolean' | 'string[]';

/**
 * Declares a known frontmatter field for a format.
 *
 * Each field entry drives both directions of the format pipeline:
 * - Read (classification): `valueMap` maps raw YAML values → normalized rule properties
 * - Write (composition): `writeValueMap` maps normalized rule properties → raw YAML values
 */
export interface FrontmatterFieldDef {
  /** Field name as it appears in YAML frontmatter (e.g. 'trigger', 'alwaysApply') */
  name: string;
  /** Expected value type — used for both validation (read) and serialization (write) */
  type: FieldType;
  /** Which classified rule property this field populates */
  mapsTo: FieldMapping;
  /**
   * Read direction: maps raw format-specific values to normalized triggers.
   * e.g. { 'always_on': 'always', 'model_decision': 'agent_requested' }
   */
  valueMap?: Record<string, RuleTrigger>;
  /**
   * Write direction: maps normalized trigger values to format-specific YAML values.
   * Omit an entry to suppress the field for that trigger (e.g. cursor-rules omits
   * alwaysApply entirely for agent_requested).
   */
  writeValueMap?: Partial<Record<RuleTrigger, string>>;
  /**
   * Only emit this field when the rule's trigger is one of these values.
   * Omit to always emit the field (when a value is available).
   */
  emitWhen?: RuleTrigger[];
}

/**
 * Format-level defaults that apply when frontmatter fields are absent.
 */
export interface FormatDefaults {
  /** Default trigger when no trigger field is present in frontmatter */
  trigger: RuleTrigger;
  /**
   * Whether having a description field (without globs or explicit trigger)
   * implies agent_requested trigger. Cursor convention.
   */
  descriptionImpliesAgentRequested?: boolean;
}

// ── Shared link patterns ─────────────────────────────────────────────

/** Markdown links: [text](./path/to/file.md) */
export const MARKDOWN_LINK: LinkPattern = {
  id: 'markdown-link',
  regex: /\[[^\]]*\]\(([^)]+)\)/g,
};

/** Backtick-quoted paths: `some/path.ext` */
export const BACKTICK_PATH: LinkPattern = {
  id: 'backtick-path',
  regex: /`([^`\n]+)`/g,
};

/** Claude Code @-import: @AGENTS.md or @./path/to/file.md */
export const AT_IMPORT: LinkPattern = {
  id: 'at-import',
  regex: /(?:^|\n)\s*@([^\s@]+\.[a-zA-Z0-9]+)\s*(?:\n|$)/g,
};

export const STANDARD_LINKS: LinkPattern[] = [MARKDOWN_LINK, BACKTICK_PATH];

// ── Format definition ────────────────────────────────────────────────

/**
 * Declarative definition of an AI agent rule file format.
 *
 * Drives the entire scanner pipeline: discovery → classification →
 * parsing → reference extraction. The scanner engine is format-agnostic;
 * all format-specific knowledge lives here.
 */
export interface FormatDefinition {
  /** Format identifier */
  id: string;

  /** Human-readable label (for UI display) */
  label: string;

  /** Icon file stem (without extension) used to load resources/icons/{light,dark}/<icon>.svg */
  icon: string;

  /**
   * Whether this format participates in initial seed discovery.
   * When false, files are only classified into this format when followed via
   * a reference link from another rule — never as discovery entry points.
   * Defaults to true.
   */
  discoverable?: boolean;

  // ── File matching (lexer) ──────────────────────────────────────────

  /**
   * Directory paths (relative to workspace root) where this format's
   * rule files live. e.g. ['.cursor/rules'], ['.claude/rules'].
   * Use ['**'] or leave empty for formats discovered by name only.
   */
  validPaths: string[];

  /**
   * Exact file names that identify this format.
   * e.g. ['CLAUDE.md'], ['.windsurfrules'], ['.cursorrules'].
   * Use ['*'] for formats that match any file name in their directories.
   */
  validNames: string[];

  /** File extensions this format uses. e.g. ['.md'], ['.md', '.mdc'] */
  validExtensions: string[];

  /**
   * Whether this format uses hierarchical (directory-based) scoping.
   * When true, files can appear at any directory level and their scope
   * is derived from their position in the directory tree rather than
   * from frontmatter fields.
   */
  isHierarchical: boolean;

  /**
   * For named-file formats: when the target file already exists, append
   * the new content (separated by `---`) instead of warning and aborting.
   * Defaults to false (warn on conflict).
   */
  appendOnConflict?: boolean;

  // ── Parsing (parser) ───────────────────────────────────────────────

  /** Frontmatter fields supported by this format and how they map to classified rule properties */
  frontmatterFields: FrontmatterFieldDef[];

  /** Defaults when frontmatter fields are absent */
  defaults: FormatDefaults;

  /** Patterns for extracting file path references from body content */
  linkPatterns: LinkPattern[];
}
