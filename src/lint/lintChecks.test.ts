import { describe, it, expect } from 'vitest';
import { LogicalRule, IndexedRule } from '../types';
import { computeMinHash } from '../hashing/minHasher';
import { LintConfig } from './lintCheck';
import { divergedContent } from './checks/divergedContent';
import { emptyBody } from './checks/emptyBody';
import { missingDescription } from './checks/missingDescription';
import { missingPrimary } from './checks/missingPrimary';
import { extensionMismatch } from './checks/extensionMismatch';
import { ruleTooLarge } from './checks/ruleTooLarge';
import { computeIssues } from './lintEngine';

function makeIndexedRule(overrides: Partial<IndexedRule> = {}): IndexedRule {
  return {
    id: 'r1',
    filePath: '/workspace/.cursor/rules/r.md',
    fileName: 'r.md',
    fileExtension: '.md',
    format: 'cursor',
    sourceType: 'directory_rule',
    trigger: 'always',
    description: 'A rule',
    globs: undefined,
    contentHash: computeMinHash('test content'),
    bodyHash: 'hash1',
    bodyLength: 100,
    fileSize: 150,
    lastModified: '2025-01-01T00:00:00Z',
    rawFrontmatter: undefined,
    references: [],
    ...overrides,
  };
}

function makeLogicalRule(overrides: Partial<LogicalRule> = {}): LogicalRule {
  return {
    id: 'lr1',
    description: 'Test rule',
    trigger: 'always',
    globs: undefined,
    formats: ['cursor'],
    rules: [makeIndexedRule()],
    minSimilarity: 1.0,
    ...overrides,
  };
}

const defaultConfig: LintConfig = {
  agent: '',
  detectDivergence: true,
  lintEnabled: true,
  maxRuleTokens: 2000,
};

describe('divergedContent', () => {
  it('reports no issue for single-file rules', () => {
    const lr = makeLogicalRule({ rules: [makeIndexedRule()] });
    expect(divergedContent.run(lr, defaultConfig)).toEqual([]);
  });

  it('reports no issue when similarity is 1.0', () => {
    const lr = makeLogicalRule({
      rules: [makeIndexedRule({ id: 'a' }), makeIndexedRule({ id: 'b' })],
      minSimilarity: 1.0,
    });
    expect(divergedContent.run(lr, defaultConfig)).toEqual([]);
  });

  it('reports divergence when similarity < 1.0', async () => {
    const lr = makeLogicalRule({
      rules: [makeIndexedRule({ id: 'a' }), makeIndexedRule({ id: 'b' })],
      minSimilarity: 0.85,
    });
    const issues = await divergedContent.run(lr, defaultConfig);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('diverged-content');
  });

  it('respects detectDivergence=false config', () => {
    const lr = makeLogicalRule({ minSimilarity: 0.5, rules: [makeIndexedRule({ id: 'a' }), makeIndexedRule({ id: 'b' })] });
    expect(divergedContent.run(lr, { ...defaultConfig, detectDivergence: false })).toEqual([]);
  });
});

describe('emptyBody', () => {
  it('warns when body is fewer than 10 chars', async () => {
    const lr = makeLogicalRule({ rules: [makeIndexedRule({ bodyLength: 5 })] });
    const issues = await emptyBody.run(lr, defaultConfig);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('empty-body');
  });

  it('does not warn when body is 10+ chars', () => {
    const lr = makeLogicalRule({ rules: [makeIndexedRule({ bodyLength: 100 })] });
    expect(emptyBody.run(lr, defaultConfig)).toEqual([]);
  });
});

describe('missingDescription', () => {
  it('warns when agent_requested rule has no description', async () => {
    const lr = makeLogicalRule({ trigger: 'agent_requested', description: '' });
    const issues = await missingDescription.run(lr, defaultConfig);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('missing-description');
  });

  it('warns when description is too short', async () => {
    const lr = makeLogicalRule({ trigger: 'agent_requested', description: 'short' });
    const issues = await missingDescription.run(lr, defaultConfig);
    expect(issues).toHaveLength(1);
  });

  it('does not warn for always-on rules even without description', () => {
    const lr = makeLogicalRule({ trigger: 'always', description: '' });
    expect(missingDescription.run(lr, defaultConfig)).toEqual([]);
  });

  it('does not warn when description is adequate', () => {
    const lr = makeLogicalRule({ trigger: 'agent_requested', description: 'A sufficiently long description for agent discovery' });
    expect(missingDescription.run(lr, defaultConfig)).toEqual([]);
  });
});

describe('missingPrimary', () => {
  it('does not warn when no agent is selected', () => {
    const lr = makeLogicalRule();
    expect(missingPrimary.run(lr, { ...defaultConfig, agent: '' })).toEqual([]);
  });

  it('does not warn when rule has a format readable by the agent', () => {
    const lr = makeLogicalRule({ formats: ['cursor'], rules: [makeIndexedRule({ format: 'cursor' })] });
    expect(missingPrimary.run(lr, { ...defaultConfig, agent: 'cursor' })).toEqual([]);
  });

  it('warns when rule has no format readable by the agent', async () => {
    const lr = makeLogicalRule({ formats: ['kiro'], rules: [makeIndexedRule({ format: 'kiro' })] });
    const issues = await missingPrimary.run(lr, { ...defaultConfig, agent: 'cursor' });
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('missing-primary');
  });
});

describe('extensionMismatch', () => {
  it('warns when extensionMismatch flag is set', async () => {
    const lr = makeLogicalRule({ rules: [makeIndexedRule({ extensionMismatch: true })] });
    const issues = await extensionMismatch.run(lr, defaultConfig);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('extension-mismatch');
    expect(issues[0].severity).toBe('error');
  });

  it('does not warn for correct extensions', () => {
    const lr = makeLogicalRule({ rules: [makeIndexedRule({ extensionMismatch: false })] });
    expect(extensionMismatch.run(lr, defaultConfig)).toEqual([]);
  });
});

describe('ruleTooLarge', () => {
  it('warns when estimated tokens exceed threshold', async () => {
    // 10000 chars / 3.5 ≈ 2857 tokens > 2000 threshold
    const lr = makeLogicalRule({ rules: [makeIndexedRule({ bodyLength: 10000 })] });
    const issues = await ruleTooLarge.run(lr, defaultConfig);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('rule-too-large');
  });

  it('does not warn when under threshold', () => {
    const lr = makeLogicalRule({ rules: [makeIndexedRule({ bodyLength: 100 })] });
    expect(ruleTooLarge.run(lr, defaultConfig)).toEqual([]);
  });
});

describe('computeIssues (lintEngine)', () => {
  it('runs structural checks even when lintEnabled is false', async () => {
    const lr = makeLogicalRule({
      minSimilarity: 0.5,
      rules: [makeIndexedRule({ id: 'a' }), makeIndexedRule({ id: 'b' })],
    });
    const issues = await computeIssues(lr, { ...defaultConfig, lintEnabled: false });
    expect(issues.some(i => i.id === 'diverged-content')).toBe(true);
  });

  it('skips lint checks when lintEnabled is false', async () => {
    const lr = makeLogicalRule({ rules: [makeIndexedRule({ bodyLength: 0 })] });
    const issues = await computeIssues(lr, { ...defaultConfig, lintEnabled: false });
    expect(issues.some(i => i.id === 'empty-body')).toBe(false);
  });

  it('runs all checks when lintEnabled is true', async () => {
    const lr = makeLogicalRule({ rules: [makeIndexedRule({ bodyLength: 0 })] });
    const issues = await computeIssues(lr, defaultConfig);
    expect(issues.some(i => i.id === 'empty-body')).toBe(true);
  });
});
