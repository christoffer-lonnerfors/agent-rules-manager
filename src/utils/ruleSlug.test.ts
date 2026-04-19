import { describe, it, expect, vi } from 'vitest';
import {
  slugifyDescription,
  normalizeRuleStem,
  levenshteinDistance,
  levenshteinRatio,
  isValidSlug,
  chooseRuleFileSlug,
  allocateUniqueSlugStem,
} from './ruleSlug';
import type { LogicalRule } from '../logical/logicalRule';
import type { ClassifiedFile } from '../scanner/classifiedFile';

function minimalClassified(overrides: Partial<ClassifiedFile> & Pick<ClassifiedFile, 'fileName'>): ClassifiedFile {
  return {
    id: 'x',
    filePath: '/w/' + overrides.fileName,
    relativePath: overrides.fileName,
    fileExtension: '.md',
    format: 'cursor-rules',
    isHierarchical: false,
    isStandalone: false,
    body: '',
    rawFrontmatter: undefined,
    frontmatterFields: {},
    trigger: 'always',
    globs: undefined,
    description: undefined,
    contentHash: [],
    bodyHash: '',
    bodyLength: 0,
    links: [],
    fileSize: 0,
    lastModified: '',
    diagnostics: [],
    ...overrides,
  } as ClassifiedFile;
}

function minimalLogicalRule(
  rules: ClassifiedFile[],
  overrides: Partial<LogicalRule> = {},
): LogicalRule {
  return {
    id: rules.map((r) => r.id).sort().join(':'),
    description: 'Default desc',
    trigger: 'always',
    globs: undefined,
    formats: ['cursor-rules'],
    rules,
    isDiverged: false,
    similarity: 1,
    ...overrides,
  };
}

describe('slugifyDescription', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyDescription('Hello World')).toBe('hello-world');
  });

  it('trims edge punctuation', () => {
    expect(slugifyDescription('---Foo---')).toBe('foo');
  });
});

describe('normalizeRuleStem', () => {
  it('strips extension and slugifies', () => {
    expect(normalizeRuleStem('TypeScript_Rules.mdc')).toBe('typescript-rules');
  });
});

describe('levenshteinDistance', () => {
  it('matches known values', () => {
    expect(levenshteinDistance('', '')).toBe(0);
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('levenshteinRatio', () => {
  it('is 1 for identical strings', () => {
    expect(levenshteinRatio('api', 'api')).toBe(1);
  });
});

describe('isValidSlug', () => {
  it('rejects empty', () => {
    expect(isValidSlug('')).toBe(false);
  });

  it('accepts hyphenated slug', () => {
    expect(isValidSlug('my-rule')).toBe(true);
  });
});

describe('chooseRuleFileSlug', () => {
  const lr = minimalLogicalRule(
    [
      minimalClassified({ id: 'a', fileName: 'alpha.md', description: 'Alpha Title' }),
      minimalClassified({ id: 'b', fileName: 'beta.md' }),
    ],
    { description: 'From logical', id: 'aid:bid' },
  );
  const source = lr.rules[0];

  it('mode A uses source file stem', () => {
    expect(
      chooseRuleFileSlug({
        mode: 'A',
        logicalRule: lr,
        source,
        targetDir: '/tmp',
        targetExt: '.md',
      }),
    ).toBe('alpha');
  });

  it('mode B uses primaryForSlug stem', () => {
    expect(
      chooseRuleFileSlug({
        mode: 'B',
        logicalRule: lr,
        source,
        primaryForSlug: lr.rules[1],
        targetDir: '/tmp',
        targetExt: '.md',
      }),
    ).toBe('beta');
  });

  it('falls back to description then id when stem invalid', () => {
    const weird = minimalLogicalRule([minimalClassified({ id: 'z', fileName: '---.md' })], {
      description: 'Good Desc Here',
      id: 'abc123def',
    });
    expect(
      chooseRuleFileSlug({
        mode: 'A',
        logicalRule: weird,
        source: weird.rules[0],
        targetDir: '/tmp',
        targetExt: '.md',
      }),
    ).toBe('good-desc-here');
  });

  it('mode C prefers constituent stem present in target dir', () => {
    const readdirSync = vi.fn(() => [
      { name: 'typescript.md', isFile: () => true },
      { name: 'other.md', isFile: () => true },
    ]) as unknown as typeof import('fs').readdirSync;

    const rules = [
      minimalClassified({ id: '1', fileName: 'unrelated.md' }),
      minimalClassified({ id: '2', fileName: 'TypeScript.md' }),
    ];
    const logical = minimalLogicalRule(rules, { description: 'ignored' });

    expect(
      chooseRuleFileSlug({
        mode: 'C',
        logicalRule: logical,
        source: rules[0],
        targetDir: '/tmp',
        targetExt: '.md',
        readdirSync,
      }),
    ).toBe('typescript');
  });
});

describe('allocateUniqueSlugStem', () => {
  it('returns base when free', () => {
    const exists = vi.fn(() => false);
    expect(allocateUniqueSlugStem('/d', 'foo', '.md', exists)).toBe('foo');
  });

  it('appends -2 when base taken', () => {
    const exists = vi.fn((p: string) => p.endsWith('foo.md'));
    expect(allocateUniqueSlugStem('/d', 'foo', '.md', exists)).toBe('foo-2');
  });

  it('uses rule when base slug invalid', () => {
    const exists = vi.fn(() => false);
    expect(allocateUniqueSlugStem('/d', '!!!', '.md', exists)).toBe('rule');
  });
});
