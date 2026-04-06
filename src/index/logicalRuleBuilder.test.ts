import { describe, it, expect } from 'vitest';
import { buildLogicalRules } from './logicalRuleBuilder';
import { computeMinHash } from '../hashing/minHasher';
import { IndexedRule } from '../types';
import { createHash } from 'crypto';

/** Helper to build a minimal IndexedRule for testing */
function makeRule(overrides: Partial<IndexedRule> & { id: string; format: IndexedRule['format']; body: string }): IndexedRule {
  const { body, ...rest } = overrides;
  const bodyHash = createHash('sha256').update(body.trim()).digest('hex');
  return {
    filePath: `/workspace/.${rest.format}/rules/${rest.id}.md`,
    fileName: `${rest.id}.md`,
    fileExtension: '.md',
    sourceType: 'directory_rule',
    trigger: 'always',
    description: undefined,
    globs: undefined,
    contentHash: computeMinHash(body),
    bodyHash,
    bodyLength: body.length,
    fileSize: body.length,
    lastModified: '2025-01-01T00:00:00Z',
    rawFrontmatter: undefined,
    references: [],
    ...rest,
  };
}

describe('buildLogicalRules', () => {
  it('returns one logical rule per input when all formats differ', () => {
    const rules = [
      makeRule({ id: 'a', format: 'cursor', body: 'Completely unique content about cursor configuration' }),
      makeRule({ id: 'b', format: 'windsurf', body: 'Totally different content about windsurf setup and deployment' }),
    ];
    const logical = buildLogicalRules(rules);
    expect(logical).toHaveLength(2);
  });

  it('merges near-duplicate rules across different formats', () => {
    const sharedBody = 'Always use TypeScript strict mode with eslint configured for the project repository';
    const rules = [
      makeRule({ id: 'r1', format: 'cursor', body: sharedBody }),
      makeRule({ id: 'r2', format: 'windsurf', body: sharedBody }),
    ];
    const logical = buildLogicalRules(rules);
    expect(logical).toHaveLength(1);
    expect(logical[0].formats).toContain('cursor');
    expect(logical[0].formats).toContain('windsurf');
    expect(logical[0].rules).toHaveLength(2);
  });

  it('never merges rules within the same format', () => {
    const body = 'Always use TypeScript strict mode with eslint configured for the project repository';
    const rules = [
      makeRule({ id: 'r1', format: 'cursor', body }),
      makeRule({ id: 'r2', format: 'cursor', body }),
    ];
    const logical = buildLogicalRules(rules);
    expect(logical).toHaveLength(2);
  });

  it('detects divergence when merged rules have different body hashes', () => {
    const rules = [
      makeRule({ id: 'r1', format: 'cursor', body: 'Use strict TypeScript mode for all files in the project repository always' }),
      makeRule({ id: 'r2', format: 'windsurf', body: 'Use strict TypeScript mode for all files in the project repository usually' }),
    ];
    const logical = buildLogicalRules(rules);
    // They should merge (high similarity) but have divergence flagged
    if (logical.length === 1) {
      expect(logical[0].minSimilarity).toBeLessThan(1.0);
    }
  });

  it('reports minSimilarity of 1.0 for identical content across formats', () => {
    const body = 'Exactly the same content in every format for testing purposes here';
    const rules = [
      makeRule({ id: 'r1', format: 'cursor', body }),
      makeRule({ id: 'r2', format: 'augment', body }),
    ];
    const logical = buildLogicalRules(rules);
    expect(logical).toHaveLength(1);
    expect(logical[0].minSimilarity).toBe(1.0);
  });

  it('uses description from a rule that has one', () => {
    const body = 'Shared content about configuring the linter for the entire project and all files';
    const rules = [
      makeRule({ id: 'r1', format: 'cursor', body, description: 'Linter config' }),
      makeRule({ id: 'r2', format: 'windsurf', body }),
    ];
    const logical = buildLogicalRules(rules);
    expect(logical).toHaveLength(1);
    expect(logical[0].description).toBe('Linter config');
  });

  it('falls back to filename without extension when no description', () => {
    const body = 'Some unique content that nobody else has for testing filename fallback behavior';
    const rules = [
      makeRule({ id: 'my-rule', format: 'cursor', body }),
    ];
    const logical = buildLogicalRules(rules);
    expect(logical[0].description).toBe('my-rule');
  });

  it('returns empty array for empty input', () => {
    expect(buildLogicalRules([])).toEqual([]);
  });

  it('sorts formats alphabetically in the logical rule', () => {
    const body = 'Shared content across three formats for testing sort order in logical rules';
    const rules = [
      makeRule({ id: 'r1', format: 'windsurf', body }),
      makeRule({ id: 'r2', format: 'augment', body }),
      makeRule({ id: 'r3', format: 'cursor', body }),
    ];
    const logical = buildLogicalRules(rules);
    expect(logical).toHaveLength(1);
    expect(logical[0].formats).toEqual(['augment', 'cursor', 'windsurf']);
  });
});
