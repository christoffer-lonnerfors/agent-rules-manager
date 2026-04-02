import { IndexedRule, SimilarityMatch } from '../scanner/scannerTypes';
import { computeSimilarity } from '../hashing/minHasher';

/** Threshold for flagging as "high similarity" */
export const SIMILARITY_THRESHOLD = 0.7;

/** Threshold for flagging as "near duplicate" */
export const DUPLICATE_THRESHOLD = 0.9;

/**
 * Finds all pairs of rules with similarity above the given threshold.
 * Uses pairwise MinHash signature comparison.
 */
export function findSimilarPairs(
  rules: IndexedRule[],
  threshold: number = SIMILARITY_THRESHOLD
): SimilarityMatch[] {
  const matches: SimilarityMatch[] = [];

  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const similarity = computeSimilarity(
        rules[i].contentHash,
        rules[j].contentHash
      );

      if (similarity >= threshold) {
        matches.push({
          ruleA: rules[i].id,
          ruleB: rules[j].id,
          similarity,
        });
      }
    }
  }

  // Sort by similarity descending
  matches.sort((a, b) => b.similarity - a.similarity);
  return matches;
}

/**
 * Groups rules into clusters of similar content.
 * Returns arrays of rule IDs that are similar to each other.
 */
export function findDuplicateGroups(
  rules: IndexedRule[],
  threshold: number = DUPLICATE_THRESHOLD
): string[][] {
  const matches = findSimilarPairs(rules, threshold);

  // Union-Find to cluster connected rules
  const parent = new Map<string, string>();

  function find(x: string): string {
    if (!parent.has(x)) { parent.set(x, x); }
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

  for (const match of matches) {
    union(match.ruleA, match.ruleB);
  }

  // Collect groups
  const groups = new Map<string, string[]>();
  for (const match of matches) {
    for (const id of [match.ruleA, match.ruleB]) {
      const root = find(id);
      if (!groups.has(root)) {
        groups.set(root, []);
      }
      const group = groups.get(root)!;
      if (!group.includes(id)) {
        group.push(id);
      }
    }
  }

  return Array.from(groups.values()).filter(g => g.length > 1);
}

/**
 * Get all rules that are similar to a specific rule.
 */
export function findSimilarTo(
  targetRule: IndexedRule,
  allRules: IndexedRule[],
  threshold: number = SIMILARITY_THRESHOLD
): Array<{ rule: IndexedRule; similarity: number }> {
  const results: Array<{ rule: IndexedRule; similarity: number }> = [];

  for (const rule of allRules) {
    if (rule.id === targetRule.id) { continue; }

    const similarity = computeSimilarity(targetRule.contentHash, rule.contentHash);
    if (similarity >= threshold) {
      results.push({ rule, similarity });
    }
  }

  results.sort((a, b) => b.similarity - a.similarity);
  return results;
}

