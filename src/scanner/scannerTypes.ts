import { RuleFormat } from '../types';

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
