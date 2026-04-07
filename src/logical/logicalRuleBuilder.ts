import { ClassifiedFile } from '../scanner/classifiedFile';
import { LogicalRule, RuleFormat } from './logicalRule';
import { computeSimilarity } from '../hashing/minHasher';

/** Threshold for flagging as "near duplicate" */
const DUPLICATE_THRESHOLD = 0.9;

/**
 * Groups ClassifiedFiles into LogicalRules by merging near-duplicates
 * across different formats using MinHash similarity.
 *
 * Rules within the same format are never merged — only cross-format
 * duplicates are combined into a single LogicalRule.
 */
export function buildLogicalRules(rules: ClassifiedFile[]): LogicalRule[] {
  // Union-Find for grouping
  const parent = new Map<string, string>();

  function find(x: string): string {
    if (!parent.has(x)) {
      parent.set(x, x);
    }
    let root = x;
    while (parent.get(root) !== root) {
      root = parent.get(root)!;
    }
    // Path compression
    let current = x;
    while (current !== root) {
      const next = parent.get(current)!;
      parent.set(current, root);
      current = next;
    }
    return root;
  }

  function union(a: string, b: string): void {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent.set(rootB, rootA);
    }
  }

  // Compare all cross-format pairs
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      // Only merge across different formats
      if (rules[i].format === rules[j].format) {
        continue;
      }

      const similarity = computeSimilarity(rules[i].contentHash, rules[j].contentHash);

      if (similarity >= DUPLICATE_THRESHOLD) {
        union(rules[i].id, rules[j].id);
      }
    }
  }

  // Collect groups
  const groups = new Map<string, ClassifiedFile[]>();
  for (const rule of rules) {
    const root = find(rule.id);
    if (!groups.has(root)) {
      groups.set(root, []);
    }
    groups.get(root)!.push(rule);
  }

  return Array.from(groups.values()).map(createLogicalRule);
}

/**
 * Create a LogicalRule from a group of ClassifiedFiles.
 * Picks the best description and merges format lists.
 */
function createLogicalRule(rules: ClassifiedFile[]): LogicalRule {
  const primary = pickPrimaryRule(rules);

  // Stable ID: sorted join of constituent IDs, independent of which file is primary.
  // Remains stable even if descriptions are added/changed across constituent files.
  const id = rules
    .map((r) => r.id)
    .sort()
    .join(':');

  const formats = [...new Set(rules.map((r) => r.format))].sort() as RuleFormat[];

  const description = primary.description ?? primary.fileName.replace(/\.[^.]+$/, '');

  // Divergence: authoritative exact-hash check
  const isDiverged = rules.length > 1 && !rules.every((r) => r.bodyHash === rules[0].bodyHash);

  // Approximate similarity for display — only computed when content has diverged.
  // MinHash can return 1.0 even for non-identical content; cap at 0.99 so the
  // percentage display never says "100% similar" for a rule we know has diverged.
  let similarity = 1.0;
  if (isDiverged) {
    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        const sim = computeSimilarity(rules[i].contentHash, rules[j].contentHash);
        if (sim < similarity) {
          similarity = sim;
        }
      }
    }
    if (similarity >= 1.0) {
      similarity = 0.99;
    }
  }

  const bestGlobs = pickBestGlobs(rules);
  const trigger = bestGlobs ? 'glob' : primary.trigger;

  return {
    id,
    description,
    trigger,
    globs: bestGlobs ?? primary.globs,
    formats,
    rules: rules.sort((a, b) => a.format.localeCompare(b.format)),
    isDiverged,
    similarity,
  };
}

/** Pick the most informative rule as the primary representative */
function pickPrimaryRule(rules: ClassifiedFile[]): ClassifiedFile {
  // Prefer rules with a description
  const withDescription = rules.filter((r) => r.description);
  if (withDescription.length > 0) {
    return withDescription[0];
  }

  // Prefer directory rules over standalone/hierarchical
  const directoryRules = rules.filter((r) => !r.isHierarchical && !r.isStandalone);
  if (directoryRules.length > 0) {
    return directoryRules[0];
  }

  return rules[0];
}

/**
 * Pick the best (most explicit) globs from a group of rules.
 * Prefers explicit frontmatter globs from directory rules over implicit
 * globs derived from hierarchical file paths.
 * Returns undefined if no rule has globs.
 */
function pickBestGlobs(rules: ClassifiedFile[]): string[] | undefined {
  // First: prefer directory rules with explicit globs
  const dirWithGlobs = rules.filter(
    (r) => !r.isHierarchical && !r.isStandalone && r.globs?.length,
  );
  if (dirWithGlobs.length > 0) {
    return dirWithGlobs[0].globs;
  }

  // Then: any rule with globs (including implicit from hierarchical)
  const anyWithGlobs = rules.filter((r) => r.globs?.length);
  if (anyWithGlobs.length > 0) {
    return anyWithGlobs[0].globs;
  }

  return undefined;
}
