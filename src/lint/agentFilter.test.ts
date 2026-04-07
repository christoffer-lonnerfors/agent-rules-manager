import { describe, it, expect } from 'vitest';
import { filterIssuesForAgent } from './agentFilter';
import { LogicalRule } from '../types';
import { ClassifiedFile } from '../scanner/classifiedFile';
import { RuleIssue } from './ruleIssues';
import { computeMinHash } from '../hashing/minHasher';

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
    body: 'test content',
    rawFrontmatter: undefined,
    frontmatterFields: {},
    trigger: 'always',
    description: 'A rule',
    globs: undefined,
    contentHash: computeMinHash('test'),
    bodyHash: 'h1',
    bodyLength: 100,
    links: [],
    fileSize: 150,
    lastModified: '2025-01-01T00:00:00Z',
    diagnostics: [],
    ...overrides,
  };
}

function makeLR(rules: ClassifiedFile[]): LogicalRule {
  return {
    id: 'lr1',
    description: 'Test',
    trigger: 'always',
    globs: undefined,
    formats: [...new Set(rules.map((r) => r.format))],
    rules,
    isDiverged: false,
    similarity: 1.0,
  };
}

describe('filterIssuesForAgent', () => {
  it('returns all issues when no agent is selected', () => {
    const issues: RuleIssue[] = [
      { id: 'empty-body', severity: 'warning', message: 'empty', ruleId: 'r1' },
      { id: 'diverged-content', severity: 'warning', message: 'diverged' },
    ];
    const lr = makeLR([makeClassifiedFile()]);
    expect(filterIssuesForAgent(issues, lr, '')).toEqual(issues);
  });

  it('keeps file-level issues for agent-readable formats', () => {
    const cursorRule = makeClassifiedFile({ id: 'cr', format: 'cursor-rules' });
    const lr = makeLR([cursorRule]);
    const issues: RuleIssue[] = [
      { id: 'empty-body', severity: 'warning', message: 'empty', ruleId: 'cr' },
    ];
    const result = filterIssuesForAgent(issues, lr, 'cursor');
    expect(result).toHaveLength(1);
  });

  it('removes file-level issues for formats the agent cannot read', () => {
    const kiroRule = makeClassifiedFile({ id: 'kr', format: 'kiro' });
    const lr = makeLR([kiroRule]);
    const issues: RuleIssue[] = [
      { id: 'empty-body', severity: 'warning', message: 'empty', ruleId: 'kr' },
    ];
    const result = filterIssuesForAgent(issues, lr, 'cursor');
    expect(result).toHaveLength(0);
  });

  it('always keeps missing-primary issues', () => {
    const kiroRule = makeClassifiedFile({ id: 'kr', format: 'kiro' });
    const lr = makeLR([kiroRule]);
    const issues: RuleIssue[] = [
      { id: 'missing-primary', severity: 'warning', message: 'Not readable by Cursor' },
    ];
    const result = filterIssuesForAgent(issues, lr, 'cursor');
    expect(result).toHaveLength(1);
  });

  it('keeps diverged-content only when agent has readable files', () => {
    const cursorRule = makeClassifiedFile({ id: 'cr', format: 'cursor-rules' });
    const lr = makeLR([cursorRule]);
    const issues: RuleIssue[] = [
      { id: 'diverged-content', severity: 'warning', message: 'diverged' },
    ];
    expect(filterIssuesForAgent(issues, lr, 'cursor')).toHaveLength(1);

    // No cursor file → should be filtered out
    const kiroRule = makeClassifiedFile({ id: 'kr', format: 'kiro' });
    const lr2 = makeLR([kiroRule]);
    expect(filterIssuesForAgent(issues, lr2, 'cursor')).toHaveLength(0);
  });
});
