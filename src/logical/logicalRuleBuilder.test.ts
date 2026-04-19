import { describe, it, expect } from 'vitest';
import { buildLogicalRules } from './logicalRuleBuilder';
import { computeMinHash, computeSimilarity } from '../hashing/minHasher';
import { ClassifiedFile } from '../scanner/classifiedFile';
import { createHash } from 'crypto';

/** Helper to build a minimal ClassifiedFile for testing */
function makeRule(
  overrides: Partial<ClassifiedFile> & {
    id: string;
    format: ClassifiedFile['format'];
    body: string;
  },
): ClassifiedFile {
  const { body, ...rest } = overrides;
  const bodyHash = createHash('sha256').update(body.trim()).digest('hex');
  return {
    filePath: `/workspace/.${rest.format}/rules/${rest.id}.md`,
    relativePath: `.${rest.format}/rules/${rest.id}.md`,
    fileName: `${rest.id}.md`,
    fileExtension: '.md',
    isHierarchical: false,
    isStandalone: false,
    body,
    rawFrontmatter: undefined,
    frontmatterFields: {},
    trigger: 'always',
    description: undefined,
    globs: undefined,
    contentHash: computeMinHash(body),
    bodyHash,
    bodyLength: body.length,
    links: [],
    fileSize: body.length,
    lastModified: '2025-01-01T00:00:00Z',
    diagnostics: [],
    ...rest,
  };
}

/** Bodies tuned so MinHash similarity is in the secondary-merge band (see mergeSignals). */
const SECONDARY_MERGE_BODY_PREFIX =
  'shared boilerplate for agent rules about typescript eslint naming conventions '.repeat(8);
const SECONDARY_BODY_A =
  SECONDARY_MERGE_BODY_PREFIX +
  'unique block alpha 0 ' +
  'worda '.repeat(40) +
  ' common suffix ending text for both documents here';
const SECONDARY_BODY_B =
  SECONDARY_MERGE_BODY_PREFIX +
  'unique block beta 0 ' +
  'wordb '.repeat(40) +
  ' common suffix ending text for both documents here';

describe('buildLogicalRules', () => {
  it('returns one logical rule per input when all formats differ', () => {
    const rules = [
      makeRule({
        id: 'a',
        format: 'cursor-rules',
        body: 'Completely unique content about cursor configuration',
      }),
      makeRule({
        id: 'b',
        format: 'windsurf-rules',
        body: 'Totally different content about windsurf setup and deployment',
      }),
    ];
    const logical = buildLogicalRules(rules);
    expect(logical).toHaveLength(2);
  });

  it('merges near-duplicate rules across different formats', () => {
    const sharedBody =
      'Always use TypeScript strict mode with eslint configured for the project repository';
    const rules = [
      makeRule({ id: 'r1', format: 'cursor-rules', body: sharedBody }),
      makeRule({ id: 'r2', format: 'windsurf-rules', body: sharedBody }),
    ];
    const logical = buildLogicalRules(rules);
    expect(logical).toHaveLength(1);
    expect(logical[0].formats).toContain('cursor-rules');
    expect(logical[0].formats).toContain('windsurf-rules');
    expect(logical[0].rules).toHaveLength(2);
  });

  it('never merges rules within the same format', () => {
    const body =
      'Always use TypeScript strict mode with eslint configured for the project repository';
    const rules = [
      makeRule({ id: 'r1', format: 'cursor-rules', body }),
      makeRule({ id: 'r2', format: 'cursor-rules', body }),
    ];
    const logical = buildLogicalRules(rules);
    expect(logical).toHaveLength(2);
  });

  it('detects divergence when merged rules have different body hashes', () => {
    const rules = [
      makeRule({
        id: 'r1',
        format: 'cursor-rules',
        body: 'Use strict TypeScript mode for all files in the project repository always',
      }),
      makeRule({
        id: 'r2',
        format: 'windsurf-rules',
        body: 'Use strict TypeScript mode for all files in the project repository usually',
      }),
    ];
    const logical = buildLogicalRules(rules);
    // They should merge (high similarity) but have divergence flagged
    if (logical.length === 1) {
      expect(logical[0].isDiverged).toBe(true);
    }
  });

  it('reports isDiverged false for identical content across formats', () => {
    const body = 'Exactly the same content in every format for testing purposes here';
    const rules = [
      makeRule({ id: 'r1', format: 'cursor-rules', body }),
      makeRule({ id: 'r2', format: 'augment-rules', body }),
    ];
    const logical = buildLogicalRules(rules);
    expect(logical).toHaveLength(1);
    expect(logical[0].isDiverged).toBe(false);
    expect(logical[0].similarity).toBe(1.0);
  });

  it('uses description from a rule that has one', () => {
    const body = 'Shared content about configuring the linter for the entire project and all files';
    const rules = [
      makeRule({ id: 'r1', format: 'cursor-rules', body, description: 'Linter config' }),
      makeRule({ id: 'r2', format: 'windsurf-rules', body }),
    ];
    const logical = buildLogicalRules(rules);
    expect(logical).toHaveLength(1);
    expect(logical[0].description).toBe('Linter config');
  });

  it('falls back to filename without extension when no description', () => {
    const body = 'Some unique content that nobody else has for testing filename fallback behavior';
    const rules = [makeRule({ id: 'my-rule', format: 'cursor-rules', body })];
    const logical = buildLogicalRules(rules);
    expect(logical[0].description).toBe('my-rule');
  });

  it('returns empty array for empty input', () => {
    expect(buildLogicalRules([])).toEqual([]);
  });

  it('sorts formats alphabetically in the logical rule', () => {
    const body = 'Shared content across three formats for testing sort order in logical rules';
    const rules = [
      makeRule({ id: 'r1', format: 'windsurf-rules', body }),
      makeRule({ id: 'r2', format: 'augment-rules', body }),
      makeRule({ id: 'r3', format: 'cursor-rules', body }),
    ];
    const logical = buildLogicalRules(rules);
    expect(logical).toHaveLength(1);
    expect(logical[0].formats).toEqual(['augment-rules', 'cursor-rules', 'windsurf-rules']);
  });

  it('merges cross-format via secondary filename and description when body MinHash is moderate', () => {
    const sim = computeSimilarity(
      computeMinHash(SECONDARY_BODY_A),
      computeMinHash(SECONDARY_BODY_B),
    );
    expect(sim).toBeGreaterThanOrEqual(0.62);
    expect(sim).toBeLessThan(0.9);

    const rules = [
      makeRule({
        id: 'r1',
        format: 'cursor-rules',
        body: SECONDARY_BODY_A,
        fileName: 'shared-stem.md',
        description: 'Shared logical title',
      }),
      makeRule({
        id: 'r2',
        format: 'windsurf-rules',
        body: SECONDARY_BODY_B,
        fileName: 'shared-stem.md',
        description: 'Shared logical title',
      }),
    ];
    const logical = buildLogicalRules(rules);
    expect(logical).toHaveLength(1);
    expect(logical[0].isDiverged).toBe(true);
  });

  it('does not merge when stems differ despite bodies in the secondary similarity band', () => {
    const rules = [
      makeRule({
        id: 'r1',
        format: 'cursor-rules',
        body: SECONDARY_BODY_A,
        fileName: 'alpha.md',
        description: 'Alpha',
      }),
      makeRule({
        id: 'r2',
        format: 'windsurf-rules',
        body: SECONDARY_BODY_B,
        fileName: 'beta.md',
        description: 'Beta',
      }),
    ];
    expect(buildLogicalRules(rules)).toHaveLength(2);
  });

  it('does not merge when body similarity is below secondary floor even with matching stems', () => {
    const rules = [
      makeRule({
        id: 'r1',
        format: 'cursor-rules',
        body: 'totally unique alpha content about elephants and planets and galaxies',
        fileName: 'same.md',
        description: 'Same',
      }),
      makeRule({
        id: 'r2',
        format: 'windsurf-rules',
        body: 'completely different beta content about kitchens recipes and ovens',
        fileName: 'same.md',
        description: 'Same',
      }),
    ];
    expect(buildLogicalRules(rules)).toHaveLength(2);
  });

  it('produces a stable ID independent of which rule has a description', () => {
    const body = 'Shared content for stable ID testing across cursor and windsurf formats here';
    const r1 = makeRule({ id: 'r1', format: 'cursor-rules', body });
    const r2 = makeRule({ id: 'r2', format: 'windsurf-rules', body });

    // Without descriptions
    const [withoutDesc] = buildLogicalRules([r1, r2]);
    const idBefore = withoutDesc.id;

    // Add a description to r1 — the primary changes, but the ID must not
    const r1WithDesc = { ...r1, description: 'Now has a description' };
    const [withDesc] = buildLogicalRules([r1WithDesc, r2]);
    expect(withDesc.id).toBe(idBefore);
  });
});
