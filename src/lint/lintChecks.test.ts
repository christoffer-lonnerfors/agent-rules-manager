import { describe, it, expect } from 'vitest';
import { LogicalRule } from '../logical/logicalRule';
import { computeMinHash } from '../hashing/minHasher';
import { LintConfig } from './lintCheck';
import { ClassifiedFile } from '../scanner/classifiedFile';
import { divergedContent } from './checks/divergedContent';
import { emptyBody } from './checks/emptyBody';
import { missingDescription } from './checks/missingDescription';
import { missingPrimary } from './checks/missingPrimary';
import { ruleTooLarge } from './checks/ruleTooLarge';
import { globMissingPatterns } from './checks/globMissingPatterns';
import { globTooBroad } from './checks/globTooBroad';
import { alwaysOnRedundantGlobs } from './checks/alwaysOnRedundantGlobs';
import { globNoWorkspaceMatch } from './checks/globNoWorkspaceMatch';
import { computeIssues, computeFileDiagnostics } from './lintEngine';

function makeClassifiedFile(overrides: Partial<ClassifiedFile> = {}): ClassifiedFile {
  return {
    id: 'r1',
    filePath: '/workspace/.cursor/rules/r.md',
    relativePath: '.cursor/rules/r.md',
    fileName: 'r.md',
    fileExtension: '.md',
    format: 'cursor-rules',
    isHierarchical: false,
    isStandalone: false,
    body: 'test content with enough characters to pass empty body check',
    rawFrontmatter: undefined,
    frontmatterFields: {},
    trigger: 'always',
    globs: undefined,
    description: 'A rule',
    contentHash: computeMinHash('test content'),
    bodyHash: 'hash1',
    bodyLength: 100,
    links: [],
    fileSize: 150,
    lastModified: '2025-01-01T00:00:00Z',
    diagnostics: [],
    ...overrides,
  };
}

function makeLogicalRule(overrides: Partial<LogicalRule> = {}): LogicalRule {
  return {
    id: 'lr1',
    description: 'Test rule',
    trigger: 'always',
    globs: undefined,
    formats: ['cursor-rules'],
    rules: [makeClassifiedFile()],
    isDiverged: false,
    similarity: 1.0,
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
    const lr = makeLogicalRule({ rules: [makeClassifiedFile()] });
    expect(divergedContent.run(lr, defaultConfig)).toEqual([]);
  });

  it('reports no issue when similarity is 1.0', () => {
    const lr = makeLogicalRule({
      rules: [makeClassifiedFile({ id: 'a' }), makeClassifiedFile({ id: 'b' })],
      isDiverged: false,
      similarity: 1.0,
    });
    expect(divergedContent.run(lr, defaultConfig)).toEqual([]);
  });

  it('reports divergence when similarity < 1.0', async () => {
    const lr = makeLogicalRule({
      rules: [makeClassifiedFile({ id: 'a' }), makeClassifiedFile({ id: 'b' })],
      isDiverged: true,
      similarity: 0.85,
    });
    const issues = await divergedContent.run(lr, defaultConfig);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('diverged-content');
  });

  it('respects detectDivergence=false config', () => {
    const lr = makeLogicalRule({
      isDiverged: true,
      similarity: 0.5,
      rules: [makeClassifiedFile({ id: 'a' }), makeClassifiedFile({ id: 'b' })],
    });
    expect(divergedContent.run(lr, { ...defaultConfig, detectDivergence: false })).toEqual([]);
  });
});

describe('emptyBody', () => {
  it('warns when body is fewer than 10 chars', async () => {
    const file = makeClassifiedFile({ bodyLength: 5 });
    const issues = await emptyBody.run(file, defaultConfig);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('empty-body');
  });

  it('does not warn when body is 10+ chars', () => {
    const file = makeClassifiedFile({ bodyLength: 100 });
    expect(emptyBody.run(file, defaultConfig)).toEqual([]);
  });
});

describe('missingDescription', () => {
  it('warns when agent_requested rule has no description', async () => {
    const file = makeClassifiedFile({ trigger: 'agent_requested', description: '' });
    const issues = await missingDescription.run(file, defaultConfig);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('missing-description');
  });

  it('warns when description is too short', async () => {
    const file = makeClassifiedFile({ trigger: 'agent_requested', description: 'short' });
    const issues = await missingDescription.run(file, defaultConfig);
    expect(issues).toHaveLength(1);
  });

  it('does not warn for always-on rules even without description', () => {
    const file = makeClassifiedFile({ trigger: 'always', description: '' });
    expect(missingDescription.run(file, defaultConfig)).toEqual([]);
  });

  it('does not warn when description is adequate', () => {
    const file = makeClassifiedFile({
      trigger: 'agent_requested',
      description: 'A sufficiently long description for agent discovery',
    });
    expect(missingDescription.run(file, defaultConfig)).toEqual([]);
  });
});

describe('missingPrimary', () => {
  it('does not warn when no agent is selected', () => {
    const lr = makeLogicalRule();
    expect(missingPrimary.run(lr, { ...defaultConfig, agent: '' })).toEqual([]);
  });

  it('does not warn when rule has a format readable by the agent', () => {
    const lr = makeLogicalRule({
      formats: ['cursor-rules'],
      rules: [makeClassifiedFile({ format: 'cursor-rules' })],
    });
    expect(missingPrimary.run(lr, { ...defaultConfig, agent: 'cursor' })).toEqual([]);
  });

  it('warns when rule has no format readable by the agent', async () => {
    const lr = makeLogicalRule({
      formats: ['kiro'],
      rules: [makeClassifiedFile({ format: 'kiro' })],
    });
    const issues = await missingPrimary.run(lr, { ...defaultConfig, agent: 'cursor' });
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('missing-primary');
  });
});

describe('ruleTooLarge', () => {
  it('warns when estimated tokens exceed threshold', async () => {
    // 10000 chars / 3.5 ≈ 2857 tokens > 2000 threshold
    const file = makeClassifiedFile({ bodyLength: 10000 });
    const issues = await ruleTooLarge.run(file, defaultConfig);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('rule-too-large');
  });

  it('does not warn when under threshold', () => {
    const file = makeClassifiedFile({ bodyLength: 100 });
    expect(ruleTooLarge.run(file, defaultConfig)).toEqual([]);
  });
});

describe('globMissingPatterns', () => {
  it('does not fire for non-glob triggers', () => {
    const file = makeClassifiedFile({ trigger: 'always', globs: undefined });
    expect(globMissingPatterns.run(file, defaultConfig)).toEqual([]);
  });

  it('errors when trigger is glob but globs is undefined', async () => {
    const file = makeClassifiedFile({ trigger: 'glob', globs: undefined });
    const issues = await globMissingPatterns.run(file, defaultConfig);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('glob-missing-patterns');
    expect(issues[0].severity).toBe('error');
  });

  it('errors when trigger is glob but globs is empty array', async () => {
    const file = makeClassifiedFile({ trigger: 'glob', globs: [] });
    const issues = await globMissingPatterns.run(file, defaultConfig);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('glob-missing-patterns');
  });

  it('does not fire when glob patterns are present', () => {
    const file = makeClassifiedFile({ trigger: 'glob', globs: ['**/*.ts'] });
    expect(globMissingPatterns.run(file, defaultConfig)).toEqual([]);
  });
});

describe('globTooBroad', () => {
  it('does not fire for non-glob triggers', () => {
    const file = makeClassifiedFile({ trigger: 'always', globs: undefined });
    expect(globTooBroad.run(file, defaultConfig)).toEqual([]);
  });

  it('does not fire when globs is undefined', () => {
    const file = makeClassifiedFile({ trigger: 'glob', globs: undefined });
    expect(globTooBroad.run(file, defaultConfig)).toEqual([]);
  });

  it('warns for pattern "**"', async () => {
    const file = makeClassifiedFile({ trigger: 'glob', globs: ['**'] });
    const issues = await globTooBroad.run(file, defaultConfig);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('glob-too-broad');
    expect(issues[0].severity).toBe('warning');
  });

  it('warns for pattern "**/*"', async () => {
    const file = makeClassifiedFile({ trigger: 'glob', globs: ['**/*'] });
    const issues = await globTooBroad.run(file, defaultConfig);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('glob-too-broad');
  });

  it('warns for pattern "**/**"', async () => {
    const file = makeClassifiedFile({ trigger: 'glob', globs: ['**/**'] });
    const issues = await globTooBroad.run(file, defaultConfig);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('glob-too-broad');
  });

  it('does not fire for specific patterns', () => {
    const file = makeClassifiedFile({ trigger: 'glob', globs: ['**/*.ts', 'src/**'] });
    expect(globTooBroad.run(file, defaultConfig)).toEqual([]);
  });
});

describe('alwaysOnRedundantGlobs', () => {
  it('does not fire when trigger is always and globs is undefined', () => {
    const file = makeClassifiedFile({ trigger: 'always', globs: undefined });
    expect(alwaysOnRedundantGlobs.run(file, defaultConfig)).toEqual([]);
  });

  it('warns when trigger is always and globs are present', async () => {
    const file = makeClassifiedFile({ trigger: 'always', globs: ['**/*.ts'] });
    const issues = await alwaysOnRedundantGlobs.run(file, defaultConfig);
    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe('always-on-redundant-globs');
    expect(issues[0].severity).toBe('warning');
  });

  it('does not fire when trigger is glob', () => {
    const file = makeClassifiedFile({ trigger: 'glob', globs: ['**/*.ts'] });
    expect(alwaysOnRedundantGlobs.run(file, defaultConfig)).toEqual([]);
  });

  it('does not fire when trigger is agent_requested', () => {
    const file = makeClassifiedFile({ trigger: 'agent_requested', globs: ['**/*.ts'] });
    expect(alwaysOnRedundantGlobs.run(file, defaultConfig)).toEqual([]);
  });
});

describe('globNoWorkspaceMatch', () => {
  it('does not fire for non-glob triggers', async () => {
    const file = makeClassifiedFile({ trigger: 'always', globs: undefined });
    const issues = await globNoWorkspaceMatch.run(file, defaultConfig);
    expect(issues).toEqual([]);
  });

  it('does not fire when globs is undefined (defers to globMissingPatterns)', async () => {
    const file = makeClassifiedFile({ trigger: 'glob', globs: undefined });
    const issues = await globNoWorkspaceMatch.run(file, defaultConfig);
    expect(issues).toEqual([]);
  });
});

describe('computeIssues (cross-file lintEngine)', () => {
  it('runs structural checks even when lintEnabled is false', async () => {
    const lr = makeLogicalRule({
      isDiverged: true,
      similarity: 0.5,
      rules: [makeClassifiedFile({ id: 'a' }), makeClassifiedFile({ id: 'b' })],
    });
    const issues = await computeIssues(lr, { ...defaultConfig, lintEnabled: false });
    expect(issues.some((i) => i.id === 'diverged-content')).toBe(true);
  });
});

describe('computeFileDiagnostics (file-level lintEngine)', () => {
  it('skips lint checks when lintEnabled is false', async () => {
    const file = makeClassifiedFile({ bodyLength: 0 });
    const diags = await computeFileDiagnostics(file, { ...defaultConfig, lintEnabled: false });
    expect(diags.some((d) => d.id === 'empty-body')).toBe(false);
  });

  it('runs lint checks when lintEnabled is true', async () => {
    const file = makeClassifiedFile({ bodyLength: 0 });
    const diags = await computeFileDiagnostics(file, defaultConfig);
    expect(diags.some((d) => d.id === 'empty-body')).toBe(true);
  });
});
