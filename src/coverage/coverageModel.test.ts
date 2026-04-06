import { describe, it, expect, beforeEach } from 'vitest';
import { CoverageModel } from './coverageModel';
import { ClassifiedFile } from '../scanner/classifiedFile';
import { computeMinHash } from '../hashing/minHasher';

function makeRule(overrides: Partial<ClassifiedFile>): ClassifiedFile {
  return {
    id: 'r1',
    filePath: '/workspace/.cursor/rules/r.md',
    relativePath: '.cursor/rules/r.md',
    fileName: 'r.md',
    fileExtension: '.md',
    format: 'cursor-rules',
    isHierarchical: false,
    isStandalone: false,
    body: 'test content',
    rawFrontmatter: undefined,
    frontmatterFields: {},
    trigger: 'always',
    description: 'Test rule',
    globs: undefined,
    contentHash: computeMinHash('test'),
    bodyHash: 'abc123',
    bodyLength: 350,
    links: [],
    fileSize: 400,
    lastModified: '2025-01-01T00:00:00Z',
    diagnostics: [],
    ...overrides,
  };
}

describe('CoverageModel', () => {
  let model: CoverageModel;

  beforeEach(() => {
    model = new CoverageModel();
  });

  describe('rebuild', () => {
    it('classifies always-on rules into baseline', () => {
      model.rebuild([makeRule({ trigger: 'always', bodyLength: 350 })]);
      const summary = model.getBaselineSummary();
      expect(summary.rules).toHaveLength(1);
      expect(summary.totalTokens).toBeGreaterThan(0);
    });

    it('classifies agent_requested rules into potential', () => {
      model.rebuild([makeRule({ trigger: 'agent_requested', bodyLength: 200 })]);
      const summary = model.getPotentialSummary();
      expect(summary.rules).toHaveLength(1);
      expect(summary.totalTokens).toBeGreaterThan(0);
    });

    it('excludes manual rules', () => {
      model.rebuild([makeRule({ trigger: 'manual' })]);
      expect(model.getBaselineSummary().rules).toHaveLength(0);
      expect(model.getPotentialSummary().rules).toHaveLength(0);
    });

    it('excludes document format rules', () => {
      model.rebuild([makeRule({ format: 'document', trigger: 'always' })]);
      expect(model.getBaselineSummary().rules).toHaveLength(0);
    });

    it('treats glob rules without patterns as always-on', () => {
      model.rebuild([makeRule({ trigger: 'glob', globs: undefined })]);
      expect(model.getBaselineSummary().rules).toHaveLength(1);
    });

    it('filters by agent when agentId is provided', () => {
      const rules = [
        makeRule({ id: 'r1', format: 'cursor-rules', trigger: 'always' }),
        makeRule({ id: 'r2', format: 'kiro', trigger: 'always' }),
      ];
      model.rebuild(rules, 'cursor');
      // cursor reads cursor + agents-md, not kiro
      expect(model.getBaselineSummary().rules).toHaveLength(1);
    });
  });

  describe('getFileCoverage', () => {
    it('includes always-on tokens for any file', () => {
      model.rebuild([makeRule({ trigger: 'always', bodyLength: 350 })]);
      const cov = model.getFileCoverage('src/index.ts');
      expect(cov.tokens).toBeGreaterThan(0);
      expect(cov.alwaysRules).toHaveLength(1);
    });

    it('adds glob-matched rule tokens to always-on baseline', () => {
      model.rebuild([
        makeRule({ id: 'a', trigger: 'always', bodyLength: 100 }),
        makeRule({ id: 'g', trigger: 'glob', globs: ['src/**/*.ts'], bodyLength: 200 }),
      ]);
      const matched = model.getFileCoverage('src/index.ts');
      const unmatched = model.getFileCoverage('docs/readme.md');
      expect(matched.tokens).toBeGreaterThan(unmatched.tokens);
      expect(matched.globRules).toHaveLength(1);
      expect(unmatched.globRules).toHaveLength(0);
    });

    it('lists agent_requested rules but does not add their tokens', () => {
      model.rebuild([makeRule({ id: 'ar', trigger: 'agent_requested', bodyLength: 500 })]);
      const cov = model.getFileCoverage('src/index.ts');
      expect(cov.tokens).toBe(0);
      expect(cov.agentRequestedRules).toHaveLength(1);
    });
  });

  describe('buildTree', () => {
    it('creates a tree with directory and file nodes', () => {
      model.rebuild([makeRule({ trigger: 'always', bodyLength: 100 })]);
      const state = model.buildTree(['src/a.ts', 'src/b.ts', 'lib/c.ts'], 128000, 'Cursor');

      expect(state.tree.isDirectory).toBe(true);
      // Should have two directory children: src and lib
      const dirNames = state.tree.children.filter((c) => c.isDirectory).map((c) => c.name);
      expect(dirNames).toContain('src');
      expect(dirNames).toContain('lib');
    });

    it('sorts directories before files', () => {
      model.rebuild([]);
      const state = model.buildTree(['a.ts', 'sub/b.ts'], 128000, '');
      const types = state.tree.children.map((c) => c.isDirectory);
      // directory first, file second
      expect(types).toEqual([true, false]);
    });

    it('identifies the hottest file in summary', () => {
      model.rebuild([makeRule({ trigger: 'glob', globs: ['hot/**'], bodyLength: 1000 })]);
      const state = model.buildTree(['hot/a.ts', 'cold/b.ts'], 128000, '');
      expect(state.summary.hottestFile?.path).toBe('hot/a.ts');
    });

    it('propagates max token cost to parent directories', () => {
      model.rebuild([makeRule({ trigger: 'glob', globs: ['src/**'], bodyLength: 700 })]);
      const state = model.buildTree(['src/a.ts', 'src/b.ts'], 128000, '');
      const srcDir = state.tree.children.find((c) => c.name === 'src');
      expect(srcDir?.tokens).toBeGreaterThan(0);
    });
  });
});
