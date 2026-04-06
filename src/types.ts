export { RuleFormat, FORMAT_LABELS, RuleTrigger } from './formats';
export { ClassifiedFile } from './scanner/classifiedFile';

import { ClassifiedFile } from './scanner/classifiedFile';
import { RuleFormat, RuleTrigger } from './formats';

/**
 * A logical rule that merges near-duplicate ClassifiedFiles across formats.
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
  rules: ClassifiedFile[];

  /** Minimum pairwise similarity among merged rules (1.0 = identical, <1.0 = diverged) */
  minSimilarity: number;
}
