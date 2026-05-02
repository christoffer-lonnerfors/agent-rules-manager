import { describe, it, expect } from 'vitest';
import { parseSections } from './ruleSplitter';

describe('parseSections', () => {
  it('returns empty array for empty string', () => {
    expect(parseSections('')).toEqual([]);
  });

  it('returns empty array when no rule-meta markers are present', () => {
    expect(parseSections('# Just a heading\n\nSome content.')).toEqual([]);
  });

  it('parses a single section with no body', () => {
    const content = '<!-- rule-meta: {"slug":"foo"} -->';
    const result = parseSections(content);
    expect(result).toHaveLength(1);
    expect(result[0].meta.slug).toBe('foo');
    expect(result[0].body).toBe('');
  });

  it('trims leading and trailing blank lines from body', () => {
    const content = '<!-- rule-meta: {"slug":"foo"} -->\n\n\nBody text\n\n';
    const result = parseSections(content);
    expect(result[0].body).toBe('Body text');
  });

  it('parses two sections with correct slugs and bodies', () => {
    const content = [
      '<!-- rule-meta: {"slug":"first"} -->',
      '',
      'First body',
      '<!-- rule-meta: {"slug":"second"} -->',
      '',
      'Second body',
    ].join('\n');
    const result = parseSections(content);
    expect(result).toHaveLength(2);
    expect(result[0].meta.slug).toBe('first');
    expect(result[0].body).toBe('First body');
    expect(result[1].meta.slug).toBe('second');
    expect(result[1].body).toBe('Second body');
  });

  it('skips malformed JSON markers', () => {
    const content = [
      '<!-- rule-meta: {not valid json} -->',
      'content before valid',
      '<!-- rule-meta: {"slug":"valid"} -->',
      'Valid body',
    ].join('\n');
    const result = parseSections(content);
    expect(result).toHaveLength(1);
    expect(result[0].meta.slug).toBe('valid');
  });

  it('ignores content before the first marker', () => {
    const content = 'Preamble text\n\n<!-- rule-meta: {"slug":"foo"} -->\n\nBody';
    const result = parseSections(content);
    expect(result).toHaveLength(1);
    expect(result[0].body).toBe('Body');
  });

  it('preserves all meta fields when present', () => {
    const meta = { slug: 'ts-style', trigger: 'glob', globs: ['src/**/*.ts'], description: 'TypeScript Style' };
    const content = `<!-- rule-meta: ${JSON.stringify(meta)} -->\n\nBody`;
    const result = parseSections(content);
    expect(result[0].meta).toEqual(meta);
  });

  it('leaves trigger undefined when marker omits it (always-on default)', () => {
    const content = '<!-- rule-meta: {"slug":"foo"} -->\n\nBody';
    const result = parseSections(content);
    expect(result[0].meta.trigger).toBeUndefined();
  });

  it('skips markers without a slug field', () => {
    const content = '<!-- rule-meta: {"trigger":"glob"} -->\n\nBody';
    expect(parseSections(content)).toHaveLength(0);
  });
});
