import { describe, it, expect } from 'vitest';
import { parseFrontmatter, extractFirstHeading } from './frontmatterParser';

describe('parseFrontmatter', () => {
  it('extracts valid YAML fields and body', () => {
    const content = `---
description: My rule
alwaysApply: true
---
Rule body content here`;

    const result = parseFrontmatter(content);
    expect(result.fields).toEqual({ description: 'My rule', alwaysApply: true });
    expect(result.body).toBe('Rule body content here');
    expect(result.rawYaml).toContain('description: My rule');
  });

  it('returns empty fields and full body when no frontmatter', () => {
    const content = 'Just plain markdown content';
    const result = parseFrontmatter(content);
    expect(result.fields).toEqual({});
    expect(result.body).toBe('Just plain markdown content');
    expect(result.rawYaml).toBeUndefined();
  });

  it('handles empty content', () => {
    const result = parseFrontmatter('');
    expect(result.fields).toEqual({});
    expect(result.body).toBe('');
    expect(result.rawYaml).toBeUndefined();
  });

  it('returns empty fields on malformed YAML but preserves body', () => {
    const content = `---
: invalid: yaml: [unclosed
---
Body after bad frontmatter`;

    const result = parseFrontmatter(content);
    expect(result.fields).toEqual({});
    expect(result.body).toBe('Body after bad frontmatter');
  });

  it('treats YAML arrays as no-frontmatter (only objects are valid)', () => {
    const content = `---
- item1
- item2
---
Body`;

    const result = parseFrontmatter(content);
    expect(result.fields).toEqual({});
    expect(result.body).toBe('Body');
  });

  it('handles frontmatter with no body', () => {
    const content = `---
description: No body rule
---`;

    const result = parseFrontmatter(content);
    expect(result.fields).toEqual({ description: 'No body rule' });
    expect(result.body).toBe('');
  });

  it('preserves complex YAML types (arrays, nested objects)', () => {
    const content = `---
globs:
  - "*.ts"
  - "*.tsx"
tags:
  priority: high
---
Body`;

    const result = parseFrontmatter(content);
    expect(result.fields.globs).toEqual(['*.ts', '*.tsx']);
    expect(result.fields.tags).toEqual({ priority: 'high' });
  });

  it('does not treat mid-file --- as frontmatter', () => {
    const content = `Some content
---
not: frontmatter
---
More content`;

    const result = parseFrontmatter(content);
    expect(result.fields).toEqual({});
    expect(result.body).toContain('Some content');
  });
});

describe('extractFirstHeading', () => {
  it('extracts an h1 heading', () => {
    expect(extractFirstHeading('# My Rule')).toBe('My Rule');
  });

  it('extracts an h2 heading', () => {
    expect(extractFirstHeading('## Sub Heading')).toBe('Sub Heading');
  });

  it('extracts the first heading when multiple exist', () => {
    const body = `Some intro text
## First
### Second`;
    expect(extractFirstHeading(body)).toBe('First');
  });

  it('returns undefined when no heading exists', () => {
    expect(extractFirstHeading('Just plain text')).toBeUndefined();
  });

  it('trims whitespace from heading text', () => {
    expect(extractFirstHeading('#   Spaced Out  ')).toBe('Spaced Out');
  });

  it('handles h6 headings', () => {
    expect(extractFirstHeading('###### Deep Heading')).toBe('Deep Heading');
  });

  it('does not match seven or more hashes', () => {
    expect(extractFirstHeading('####### Not a heading')).toBeUndefined();
  });
});
