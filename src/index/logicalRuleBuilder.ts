import { IndexedRule, LogicalRule, RuleFormat } from '../types';
import { computeSimilarity } from '../hashing/minHasher';

/** Threshold for flagging as "near duplicate" */
const DUPLICATE_THRESHOLD = 0.9;

/**
 * Groups IndexedRules into LogicalRules by merging near-duplicates
 * across different formats using MinHash similarity.
 *
 * Rules within the same format are never merged — only cross-format
 * duplicates are combined into a single LogicalRule.
 */
export function buildLogicalRules(rules: IndexedRule[]): LogicalRule[] {
  // Union-Find for grouping
  const parent = new Map<string, string>();

  function find(x: string): string {
    if (!parent.has(x)) { parent.set(x, x); }
    let root = x;
    while (parent.get(root) !== root) {
      root = parent.get(root)!;
    }
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
      if (rules[i].format === rules[j].format) { continue; }

      const similarity = computeSimilarity(
        rules[i].contentHash,
        rules[j].contentHash
      );

      if (similarity >= DUPLICATE_THRESHOLD) {
        union(rules[i].id, rules[j].id);
      }
    }
  }

  // Collect groups
  const groups = new Map<string, IndexedRule[]>();
  for (const rule of rules) {
    const root = find(rule.id);
    if (!groups.has(root)) {
      groups.set(root, []);
    }
    groups.get(root)!.push(rule);
  }

  // Convert groups to LogicalRules
  const logicalRules: LogicalRule[] = [];
  for (const groupRules of groups.values()) {
    logicalRules.push(createLogicalRule(groupRules));
  }

  return logicalRules;
}

/**
 * Create a LogicalRule from a group of IndexedRules.
 * Picks the best description and merges format lists.
 */
function createLogicalRule(rules: IndexedRule[]): LogicalRule {
  // Pick the "primary" rule — prefer one with a description, then by format priority
  const primary = pickPrimaryRule(rules);

  // Collect unique formats, sorted
  const formats = [...new Set(rules.map(r => r.format))].sort() as RuleFormat[];

  // Best description: prefer frontmatter description, then heading-derived
  const description = primary.description
    ?? primary.fileName.replace(/\.[^.]+$/, ''); // fallback to filename without extension

  // Detect divergence using exact body hash (SHA-256).
  // If any two rules have different body hashes, the group has diverged.
  // MinHash similarity is still reported for the tooltip (approximate %).
  let minSimilarity = 1.0;
  if (rules.length > 1) {
    // Check exact divergence first
    const firstHash = rules[0].bodyHash;
    const allIdentical = rules.every(r => r.bodyHash === firstHash);
    if (!allIdentical) {
      // Compute approximate similarity for display purposes
      for (let i = 0; i < rules.length; i++) {
        for (let j = i + 1; j < rules.length; j++) {
          const sim = computeSimilarity(rules[i].contentHash, rules[j].contentHash);
          if (sim < minSimilarity) {
            minSimilarity = sim;
          }
        }
      }
      // Ensure we always flag divergence even if MinHash says 1.0
      if (minSimilarity >= 1.0) {
        minSimilarity = 0.99;
      }
    }
  }

  // Merge globs: prefer the most specific/explicit globs from any member.
  // Directory rules with explicit frontmatter globs are more informative than
  // implicit globs derived from hierarchical file placement.
  const bestGlobs = pickBestGlobs(rules);
  const trigger = bestGlobs ? 'glob' : primary.trigger;

  return {
    id: primary.id,
    description,
    trigger,
    globs: bestGlobs ?? primary.globs,
    formats,
    rules: rules.sort((a, b) => a.format.localeCompare(b.format)),
    minSimilarity,
  };
}

/** Pick the most informative rule as the primary representative */
function pickPrimaryRule(rules: IndexedRule[]): IndexedRule {
  // Prefer rules with a description
  const withDescription = rules.filter(r => r.description);
  if (withDescription.length > 0) {
    return withDescription[0];
  }

  // Prefer directory rules over standalone/hierarchical
  const directoryRules = rules.filter(r => r.sourceType === 'directory_rule');
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
function pickBestGlobs(rules: IndexedRule[]): string[] | undefined {
  // First: prefer directory rules with explicit globs
  const dirWithGlobs = rules.filter(r => r.sourceType === 'directory_rule' && r.globs?.length);
  if (dirWithGlobs.length > 0) {
    return dirWithGlobs[0].globs;
  }

  // Then: any rule with globs (including implicit from hierarchical)
  const anyWithGlobs = rules.filter(r => r.globs?.length);
  if (anyWithGlobs.length > 0) {
    return anyWithGlobs[0].globs;
  }

  return undefined;
}

