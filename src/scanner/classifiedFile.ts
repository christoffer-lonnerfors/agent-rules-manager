import { RuleFormat, RuleTrigger } from '../formats';
import { ExtractedLink } from '../formats/formatDefinition';

// ── File-level diagnostic ────────────────────────────────────────────

/**
 * A diagnostic produced during file classification.
 * Covers file-level issues only — cross-file issues (divergence,
 * missing coverage) are computed in semantic analysis.
 */
export interface FileDiagnostic {
  /** Machine-readable identifier, e.g. 'unknown-frontmatter-field', 'empty-body' */
  id: string;
  /** Severity level */
  severity: 'error' | 'warning' | 'info';
  /** Human-readable message */
  message: string;
}

// ── Classified file ──────────────────────────────────────────────────

/**
 * The output of the format classifier — a single rule file fully parsed,
 * classified, and validated in one pass.
 *
 * This is the intermediate representation between the lexer (file discovery)
 * and semantic analysis (cross-file linting, logical rule grouping).
 */
export interface ClassifiedFile {
  // ── Identity ───────────────────────────────────────────────────────

  /** Unique ID (deterministic hash of filePath) */
  id: string;
  /** Absolute file path */
  filePath: string;
  /** Path relative to workspace root */
  relativePath: string;
  /** File name including extension, e.g. 'my-rule.mdc' */
  fileName: string;
  /** File extension including dot, e.g. '.mdc' */
  fileExtension: string;

  // ── Classification ─────────────────────────────────────────────────

  /** Matched format definition ID */
  format: RuleFormat;
  /** Whether this format uses directory-based scoping */
  isHierarchical: boolean;
  /** Whether this format is a single standalone file at the workspace root */
  isStandalone: boolean;

  // ── Parsed content ─────────────────────────────────────────────────

  /** Content body after frontmatter extraction */
  body: string;
  /** Raw YAML string between --- delimiters, undefined if no frontmatter */
  rawFrontmatter: string | undefined;
  /** All parsed frontmatter fields (known + unknown) */
  frontmatterFields: Record<string, unknown>;

  // ── Mapped properties ──────────────────────────────────────────────

  /** Normalized activation trigger */
  trigger: RuleTrigger;
  /** Normalized glob patterns, if applicable */
  globs: string[] | undefined;
  /** Human-readable description (from frontmatter or first heading) */
  description: string | undefined;

  // ── Hashing ────────────────────────────────────────────────────────

  /** MinHash signature of body content (for similarity comparison) */
  contentHash: number[];
  /** SHA-256 hash of body (for quick equality checks) */
  bodyHash: string;
  /** Trimmed body length in characters */
  bodyLength: number;

  // ── References ─────────────────────────────────────────────────────

  /** All links extracted by the format's link patterns */
  links: ExtractedLink[];

  // ── Metadata ───────────────────────────────────────────────────────

  /** File size in bytes */
  fileSize: number;
  /** Last modified timestamp (ISO 8601) */
  lastModified: string;

  // ── File-level diagnostics ─────────────────────────────────────────

  /** Issues found during classification (file-level only) */
  diagnostics: FileDiagnostic[];
}
