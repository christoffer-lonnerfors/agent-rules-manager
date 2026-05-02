import { describe, it, expect } from 'vitest';
import {
  buildRuleMetaComment,
  findSlugSection,
  detectConflict,
  computeNamedFileContent,
} from './ruleConverter';

describe('buildRuleMetaComment', () => {
  it('emits only slug when trigger is always', () => {
    expect(buildRuleMetaComment('foo')).toBe('<!-- rule-meta: {"slug":"foo"} -->');
  });

  it('omits trigger when it is always', () => {
    expect(buildRuleMetaComment('foo', undefined, 'always')).toBe(
      '<!-- rule-meta: {"slug":"foo"} -->',
    );
  });

  it('includes trigger and globs for glob-scoped rule', () => {
    const result = buildRuleMetaComment('ts-style', ['src/**/*.ts'], 'glob', 'TypeScript Style');
    expect(result).toBe(
      '<!-- rule-meta: {"slug":"ts-style","trigger":"glob","globs":["src/**/*.ts"],"description":"TypeScript Style"} -->',
    );
  });

  it('omits globs when trigger is not glob', () => {
    const result = buildRuleMetaComment('foo', ['src/**/*.ts'], 'agent_requested');
    expect(result).toBe('<!-- rule-meta: {"slug":"foo","trigger":"agent_requested"} -->');
  });
});

describe('findSlugSection', () => {
  const makeSection = (slug: string, body = 'body') =>
    `<!-- rule-meta: {"slug":"${slug}"} -->\n\n${body}\n`;

  it('finds a single section spanning the full content', () => {
    const content = makeSection('foo');
    const result = findSlugSection(content, 'foo');
    expect(result).toEqual({ sectionStart: 0, sectionEnd: content.length });
  });

  it('finds the first of two sections correctly (ends before second marker)', () => {
    const s1 = makeSection('foo');
    const s2 = makeSection('bar');
    const content = s1 + s2;
    const result = findSlugSection(content, 'foo');
    expect(result).toEqual({ sectionStart: 0, sectionEnd: s1.length });
  });

  it('finds the second of two sections (starts at second marker, ends at EOF)', () => {
    const s1 = makeSection('foo');
    const s2 = makeSection('bar');
    const content = s1 + s2;
    const result = findSlugSection(content, 'bar');
    expect(result).toEqual({ sectionStart: s1.length, sectionEnd: content.length });
  });

  it('returns undefined when slug is not present', () => {
    const content = makeSection('foo');
    expect(findSlugSection(content, 'missing')).toBeUndefined();
  });

  it('skips malformed JSON markers and finds a valid one', () => {
    const malformed = '<!-- rule-meta: {not json} -->\n\nsome body\n';
    const valid = makeSection('real');
    const content = malformed + valid;
    const result = findSlugSection(content, 'real');
    expect(result).toBeDefined();
    expect(result!.sectionStart).toBe(malformed.length);
    expect(result!.sectionEnd).toBe(content.length);
  });
});

describe('detectConflict', () => {
  it('returns none when content is undefined', () => {
    expect(detectConflict(undefined, 'foo')).toBe('none');
  });

  it('returns same-slug when content contains a matching rule-meta section', () => {
    const content = '<!-- rule-meta: {"slug":"foo"} -->\n\nbody\n';
    expect(detectConflict(content, 'foo')).toBe('same-slug');
  });

  it('returns file-exists-no-slug when content exists but has no matching slug', () => {
    const content = '<!-- rule-meta: {"slug":"other"} -->\n\nbody\n';
    expect(detectConflict(content, 'foo')).toBe('file-exists-no-slug');
  });
});

describe('computeNamedFileContent', () => {
  const META = '<!-- rule-meta: {"slug":"foo"} -->';
  const BODY = 'Rule body here.';

  it('create strategy returns only the new section', () => {
    const result = computeNamedFileContent(undefined, 'foo', META, BODY, 'create');
    expect(result).toBe(`${META}\n\n${BODY}\n`);
  });

  it('append strategy concatenates with double newline separator', () => {
    const existing = '<!-- rule-meta: {"slug":"other"} -->\n\nOther body\n';
    const result = computeNamedFileContent(existing, 'foo', META, BODY, 'append');
    expect(result).toBe(`${existing.trimEnd()}\n\n${META}\n\n${BODY}\n`);
  });

  it('replace strategy splices out the old section and inserts the new one', () => {
    const oldSection = '<!-- rule-meta: {"slug":"foo"} -->\n\nOld body\n';
    const result = computeNamedFileContent(oldSection, 'foo', META, BODY, 'replace');
    expect(result).toBe(`${META}\n\n${BODY}\n`);
  });

  it('replace falls back to append when slug is not present', () => {
    const existing = '<!-- rule-meta: {"slug":"other"} -->\n\nOther body\n';
    const result = computeNamedFileContent(existing, 'foo', META, BODY, 'replace');
    expect(result).toBe(`${existing.trimEnd()}\n\n${META}\n\n${BODY}\n`);
  });
});
