import { describe, it, expect } from 'vitest';
import { shouldSecondaryMergePair, DUPLICATE_THRESHOLD, SECONDARY_BODY_MIN } from './mergeSignals';
import type { ClassifiedFile } from '../scanner/classifiedFile';

function stubFile(overrides: Partial<ClassifiedFile>): ClassifiedFile {
  return {
    id: 'id',
    filePath: '/x',
    relativePath: 'x',
    fileName: 'rule.md',
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

describe('shouldSecondaryMergePair', () => {
  it('returns false at or above primary duplicate threshold', () => {
    const a = stubFile({ fileName: 'api.md' });
    const b = stubFile({ fileName: 'api.md', format: 'windsurf-rules' });
    expect(shouldSecondaryMergePair(a, b, DUPLICATE_THRESHOLD)).toBe(false);
  });

  it('returns false below secondary body floor', () => {
    const a = stubFile({ fileName: 'api.md' });
    const b = stubFile({ fileName: 'api.md', format: 'windsurf-rules' });
    expect(shouldSecondaryMergePair(a, b, SECONDARY_BODY_MIN - 0.01)).toBe(false);
  });

  it('merges when stems match, both descriptions equal, sim in band', () => {
    const a = stubFile({
      fileName: 'api.md',
      format: 'cursor-rules',
      description: 'API Rules',
    });
    const b = stubFile({
      fileName: 'api.md',
      format: 'windsurf-rules',
      description: 'API Rules',
    });
    expect(shouldSecondaryMergePair(a, b, 0.7)).toBe(true);
  });

  it('rejects when descriptions differ even if stems match', () => {
    const a = stubFile({ fileName: 'api.md', description: 'One' });
    const b = stubFile({ fileName: 'api.md', format: 'windsurf-rules', description: 'Two' });
    expect(shouldSecondaryMergePair(a, b, 0.7)).toBe(false);
  });

  it('requires higher sim when a description is missing', () => {
    const a = stubFile({ fileName: 'api.md', description: 'Only here' });
    const b = stubFile({ fileName: 'api.md', format: 'windsurf-rules' });
    expect(shouldSecondaryMergePair(a, b, 0.65)).toBe(false);
    expect(shouldSecondaryMergePair(a, b, 0.75)).toBe(true);
  });
});
