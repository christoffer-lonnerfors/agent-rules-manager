import * as path from 'path';
import * as fs from 'fs';
import type { LogicalRule } from '../logical/logicalRule';
import type { ClassifiedFile } from '../scanner/classifiedFile';

/**
 * Slug rules aligned with legacy description-based filenames in ruleWriter.
 */
export function slugifyDescription(description: string): string {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Basename of `fileName` without extension, slugified (lowercase, hyphenated). */
export function normalizeRuleStem(fileName: string): string {
  const stem = path.parse(fileName).name;
  return slugifyDescription(stem);
}

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) {
    return n;
  }
  if (n === 0) {
    return m;
  }
  const row = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) {
    row[j] = j;
  }
  for (let i = 1; i <= m; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[n];
}

/** Ratio in [0, 1]; 1 = identical. */
export function levenshteinRatio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) {
    return 1;
  }
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) {
    return 1;
  }
  return 1 - levenshteinDistance(a, b) / maxLen;
}

export function isValidSlug(slug: string): boolean {
  return slug.length > 0 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug);
}

function fallbackSlugFromLogicalRuleId(ruleId: string): string {
  const compact = ruleId.replace(/[^a-z0-9]+/gi, '').slice(0, 12);
  return compact.length > 0 ? compact : 'rule';
}

export type SlugSelectionMode = 'A' | 'B' | 'C';

export interface ChooseRuleFileSlugOptions {
  mode: SlugSelectionMode;
  logicalRule: LogicalRule;
  /** Body source (most recently modified); used for mode A and as C fallback. */
  source: ClassifiedFile;
  targetDir: string;
  targetExt: string;
  /**
   * Mode B: pass the same file `pickPrimaryClassifiedFile` would choose (mirrors logical rule label).
   * Ignored for A/C.
   */
  primaryForSlug?: ClassifiedFile;
  /** Injected for tests; defaults to `fs.readdirSync`. */
  readdirSync?: typeof fs.readdirSync;
}

/**
 * Mode A: slug from normalized stem of `source.fileName` (file the body is copied from).
 * Mode B: slug from normalized stem of `primaryForSlug.fileName` (caller supplies primary).
 * Mode C: if any constituent rule's stem matches an existing file stem in `targetDir` for `targetExt`,
 *         use that stem; else same as mode A.
 *
 * Fallbacks: invalid primary slug → `slugifyDescription(logicalRule.description)` →
 *             compact slice of `logicalRule.id` → `"rule"`.
 */
export function chooseRuleFileSlug(opts: ChooseRuleFileSlugOptions): string {
  const { mode, logicalRule, source, targetDir, targetExt, primaryForSlug } = opts;
  const readdirSync = opts.readdirSync ?? fs.readdirSync;

  let primary = '';
  if (mode === 'A') {
    primary = normalizeRuleStem(source.fileName);
  } else if (mode === 'B') {
    const p = primaryForSlug ?? source;
    primary = normalizeRuleStem(p.fileName);
  } else {
    primary = stemMatchingTargetDir(logicalRule, targetDir, targetExt, readdirSync, source);
  }

  if (isValidSlug(primary)) {
    return primary;
  }

  const fromDesc = slugifyDescription(logicalRule.description ?? '');
  if (isValidSlug(fromDesc)) {
    return fromDesc;
  }

  return fallbackSlugFromLogicalRuleId(logicalRule.id);
}

function stemMatchingTargetDir(
  logicalRule: LogicalRule,
  targetDir: string,
  targetExt: string,
  readdirSync: typeof fs.readdirSync,
  source: ClassifiedFile,
): string {
  let names: string[];
  try {
    names = readdirSync(targetDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(targetExt))
      .map((e) => e.name);
  } catch {
    return normalizeRuleStem(source.fileName);
  }

  const stemsInTarget = new Set(names.map((n) => normalizeRuleStem(n)));

  for (const r of logicalRule.rules) {
    const s = normalizeRuleStem(r.fileName);
    if (s && stemsInTarget.has(s)) {
      return s;
    }
  }

  return normalizeRuleStem(source.fileName);
}

const MAX_SLUG_COLLISION_ATTEMPTS = 1000;

/**
 * Returns a filename stem (no extension) unique under `targetDir` with suffix `-2`, `-3`, … if needed.
 */
export function allocateUniqueSlugStem(
  targetDir: string,
  baseSlug: string,
  targetExt: string,
  existsSync: (p: string) => boolean,
): string {
  const safeBase = isValidSlug(baseSlug) ? baseSlug : 'rule';
  for (let n = 0; n < MAX_SLUG_COLLISION_ATTEMPTS; n++) {
    const stem = n === 0 ? safeBase : `${safeBase}-${n + 1}`;
    const candidate = path.join(targetDir, stem + targetExt);
    if (!existsSync(candidate)) {
      return stem;
    }
  }
  throw new Error(
    `Could not allocate a unique rule filename under ${targetDir} after ${MAX_SLUG_COLLISION_ATTEMPTS} attempts.`,
  );
}
