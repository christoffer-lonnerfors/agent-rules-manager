import { describe, it, expect } from 'vitest';
import { extractReferences, extractDiscoveryReferences } from './referenceExtractor';

describe('extractReferences', () => {
  it('extracts markdown link paths', () => {
    const body = 'See [the guide](./docs/guide.md) for details';
    expect(extractReferences(body)).toContain('docs/guide.md');
  });

  it('extracts backtick-quoted paths', () => {
    const body = 'Check `src/utils/helper.ts` for the implementation';
    expect(extractReferences(body)).toContain('src/utils/helper.ts');
  });

  it('skips HTTP URLs in markdown links', () => {
    const body = 'See [docs](https://example.com/guide.md)';
    expect(extractReferences(body)).toEqual([]);
  });

  it('skips anchor links', () => {
    const body = 'See [section](#overview)';
    expect(extractReferences(body)).toEqual([]);
  });

  it('skips absolute paths', () => {
    const body = 'See [config](/etc/config.yml)';
    expect(extractReferences(body)).toEqual([]);
  });

  it('skips paths without a slash (not file references)', () => {
    const body = 'Use `package.json` for config';
    expect(extractReferences(body)).toEqual([]);
  });

  it('skips paths without a file extension', () => {
    const body = 'See [folder](./src/utils)';
    expect(extractReferences(body)).toEqual([]);
  });

  it('deduplicates references', () => {
    const body = 'See [a](./docs/guide.md) and [b](./docs/guide.md)';
    expect(extractReferences(body)).toEqual(['docs/guide.md']);
  });

  it('strips leading ./ from paths', () => {
    const body = 'See [x](./src/foo.ts)';
    const refs = extractReferences(body);
    expect(refs).toContain('src/foo.ts');
    expect(refs).not.toContain('./src/foo.ts');
  });

  it('extracts multiple references from mixed content', () => {
    const body = `
See [guide](./docs/guide.md) for setup.
Also check \`lib/utils/helper.ts\` for helpers.
And [external](https://example.com) for more.
    `;
    const refs = extractReferences(body);
    expect(refs).toContain('docs/guide.md');
    expect(refs).toContain('lib/utils/helper.ts');
    expect(refs).toHaveLength(2);
  });
});

describe('extractDiscoveryReferences', () => {
  it('extracts .md file references from markdown links', () => {
    const body = 'See [guide](./docs/setup.md) for setup';
    expect(extractDiscoveryReferences(body)).toContain('docs/setup.md');
  });

  it('extracts bare filename .md references (no slash)', () => {
    const body = 'See [setup](setup.md)';
    expect(extractDiscoveryReferences(body)).toContain('setup.md');
  });

  it('extracts .mdc and .mdx files', () => {
    const body = 'See [a](rule.mdc) and [b](doc.mdx)';
    const refs = extractDiscoveryReferences(body);
    expect(refs).toContain('rule.mdc');
    expect(refs).toContain('doc.mdx');
  });

  it('does NOT extract backtick-quoted paths', () => {
    const body = 'Check `docs/guide.md` for details';
    expect(extractDiscoveryReferences(body)).toEqual([]);
  });

  it('skips non-discovery extensions like .ts', () => {
    const body = 'See [code](./src/index.ts)';
    expect(extractDiscoveryReferences(body)).toEqual([]);
  });

  it('skips URLs', () => {
    const body = 'See [docs](https://example.com/guide.md)';
    expect(extractDiscoveryReferences(body)).toEqual([]);
  });
});
