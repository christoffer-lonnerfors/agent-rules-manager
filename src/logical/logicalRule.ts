import { ClassifiedFile } from '../scanner/classifiedFile';
import { RuleFormat, RuleTrigger } from '../formats/formatRegistry';

/**
 * A logical rule that merges near-duplicate ClassifiedFiles across formats.
 * Represents a single "concept" that may exist in multiple agent rule formats.
 */
export interface LogicalRule {
  /** Stable ID derived from sorted constituent rule IDs — independent of which file is primary */
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
  rules: ClassifiedFile[];

  /** True when constituent rules have different body content (authoritative, exact-hash-based) */
  isDiverged: boolean;

  /** Approximate minimum pairwise similarity (0.0–1.0); only meaningful when isDiverged is true */
  similarity: number;
}
