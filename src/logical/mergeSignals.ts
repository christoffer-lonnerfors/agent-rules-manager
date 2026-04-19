import { ClassifiedFile } from '../scanner/classifiedFile';
import { levenshteinRatio, normalizeRuleStem } from '../utils/ruleSlug';

/** Primary cross-format merge: MinHash body similarity at or above this value. */
export const DUPLICATE_THRESHOLD = 0.9;

/** Lower bound on body MinHash similarity for secondary merge (exclusive upper bound: primary threshold). */
export const SECONDARY_BODY_MIN = 0.62;

/**
 * When at least one side lacks an explicit frontmatter/heading description, secondary merge
 * requires body similarity at least this high (still below DUPLICATE_THRESHOLD).
 */
export const SECONDARY_BODY_STEM_ONLY_MIN = 0.72;

/** Minimum Levenshtein ratio between normalized stems to count as "near identical" filenames. */
export const STEM_LEVENSHTEIN_MIN = 0.9;

function normalizeExplicitDescription(desc: string): string {
  return desc.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function stemStrongMatch(a: ClassifiedFile, b: ClassifiedFile): boolean {
  const sa = normalizeRuleStem(a.fileName);
  const sb = normalizeRuleStem(b.fileName);
  if (!sa || !sb) {
    return false;
  }
  if (sa === sb) {
    return true;
  }
  return levenshteinRatio(sa, sb) >= STEM_LEVENSHTEIN_MIN;
}

/**
 * Secondary cross-format merge when body MinHash is below duplicate threshold but metadata agrees.
 *
 * - Body similarity in [SECONDARY_BODY_MIN, DUPLICATE_THRESHOLD).
 * - Strong filename signal: equal normalized stems or high Levenshtein ratio on stems.
 * - If both rules have explicit descriptions, normalized descriptions must match (and the lower
 *   body floor SECONDARY_BODY_MIN applies).
 * - If either side lacks an explicit description, require body similarity >= SECONDARY_BODY_STEM_ONLY_MIN.
 */
export function shouldSecondaryMergePair(
  a: ClassifiedFile,
  b: ClassifiedFile,
  bodySim: number,
): boolean {
  if (bodySim < SECONDARY_BODY_MIN || bodySim >= DUPLICATE_THRESHOLD) {
    return false;
  }
  if (!stemStrongMatch(a, b)) {
    return false;
  }

  const ta = a.description?.trim();
  const tb = b.description?.trim();
  if (ta && tb) {
    return normalizeExplicitDescription(ta) === normalizeExplicitDescription(tb);
  }

  return bodySim >= SECONDARY_BODY_STEM_ONLY_MIN;
}
