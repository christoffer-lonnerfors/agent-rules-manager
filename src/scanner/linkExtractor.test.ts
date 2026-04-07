import { describe, it, expect } from 'vitest';
import { extractLinks } from './linkExtractor';
import { getFormatDefinition } from './formatRegistry';

const claudeMd = getFormatDefinition('claude-md');
const cursorRules = getFormatDefinition('cursor-rules');

// ── Markdown links ────────────────────────────────────────────────────

describe('extractLinks — markdown links', () => {
  it('extracts a relative markdown link', () => {
    const links = extractLinks('See [reference](./docs/rules.md) for details', claudeMd);
    expect(links).toContainEqual({ patternId: 'markdown-link', target: './docs/rules.md' });
  });

  it('extracts multiple markdown links', () => {
    const links = extractLinks('[a](./a.md) and [b](./b.md)', claudeMd);
    expect(links).toHaveLength(2);
  });

  it('skips URLs in markdown links', () => {
    const links = extractLinks('[docs](https://example.com/docs)', claudeMd);
    expect(links).toHaveLength(0);
  });

  it('skips anchor-only links', () => {
    const links = extractLinks('[section](#overview)', claudeMd);
    expect(links).toHaveLength(0);
  });

  it('skips absolute paths', () => {
    const links = extractLinks('[root](/etc/hosts)', claudeMd);
    expect(links).toHaveLength(0);
  });

  it('skips extensionless targets', () => {
    const links = extractLinks('[no-ext](./some-dir)', claudeMd);
    expect(links).toHaveLength(0);
  });
});

// ── Backtick paths ────────────────────────────────────────────────────

describe('extractLinks — backtick paths', () => {
  it('extracts a backtick path with extension', () => {
    const links = extractLinks('Check `config/settings.json` for details', claudeMd);
    expect(links).toContainEqual({ patternId: 'backtick-path', target: 'config/settings.json' });
  });

  it('skips backtick content without extension', () => {
    const links = extractLinks('Run `npm install` to set up', claudeMd);
    expect(links).toHaveLength(0);
  });

  it('skips URLs in backticks', () => {
    const links = extractLinks('Visit `https://example.com/page`', claudeMd);
    expect(links).toHaveLength(0);
  });
});

// ── @-import (claude-md only) ─────────────────────────────────────────

describe('extractLinks — at-import', () => {
  it('extracts @-import in claude-md', () => {
    const links = extractLinks('@AGENTS.md', claudeMd);
    expect(links).toContainEqual({ patternId: 'at-import', target: 'AGENTS.md' });
  });

  it('extracts @-import with relative path', () => {
    const links = extractLinks('@./docs/guide.md', claudeMd);
    expect(links).toContainEqual({ patternId: 'at-import', target: './docs/guide.md' });
  });

  it('does not extract @-import for cursor-rules (no AT_IMPORT pattern)', () => {
    const links = extractLinks('@AGENTS.md', cursorRules);
    const atImports = links.filter((l) => l.patternId === 'at-import');
    expect(atImports).toHaveLength(0);
  });
});

// ── Multiple patterns on same content ────────────────────────────────

describe('extractLinks — multiple patterns', () => {
  it('extracts from both markdown and backtick in one pass', () => {
    const body = 'See [ref](./rules.md) and also `config.json`';
    const links = extractLinks(body, claudeMd);
    expect(links).toContainEqual({ patternId: 'markdown-link', target: './rules.md' });
    expect(links).toContainEqual({ patternId: 'backtick-path', target: 'config.json' });
  });

  it('returns empty array for body with no links', () => {
    const links = extractLinks('Just plain text with no references here', claudeMd);
    expect(links).toHaveLength(0);
  });
});
