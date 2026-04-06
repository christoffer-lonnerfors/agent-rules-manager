import { describe, it, expect } from 'vitest';
import { extractCommonDirectory, deriveGlobFromHierarchicalPath } from './scopeTranslator';

describe('extractCommonDirectory', () => {
  it('returns the directory prefix for a single glob', () => {
    expect(extractCommonDirectory(['src/api/*.ts'])).toBe('src/api');
  });

  it('returns the common ancestor for multiple globs', () => {
    expect(extractCommonDirectory(['src/api/handlers/*.ts', 'src/api/utils/*.ts']))
      .toBe('src/api');
  });

  it('returns the shallowest common ancestor across different trees', () => {
    expect(extractCommonDirectory(['src/api/*.ts', 'src/models/*.ts']))
      .toBe('src');
  });

  it('returns empty string for root-level globs', () => {
    expect(extractCommonDirectory(['*.ts'])).toBe('');
  });

  it('returns empty string for empty array', () => {
    expect(extractCommonDirectory([])).toBe('');
  });

  it('handles glob with no wildcard (literal file path)', () => {
    // A literal path like "src/api/foo.ts" — last segment is a filename, not a dir
    expect(extractCommonDirectory(['src/api/foo.ts'])).toBe('src/api');
  });

  it('handles double-star globs', () => {
    expect(extractCommonDirectory(['src/**/*.ts'])).toBe('src');
  });

  it('returns empty for undefined/null input', () => {
    expect(extractCommonDirectory(undefined as unknown as string[])).toBe('');
    expect(extractCommonDirectory(null as unknown as string[])).toBe('');
  });
});

describe('deriveGlobFromHierarchicalPath', () => {
  it('returns a glob for a subdirectory file', () => {
    expect(deriveGlobFromHierarchicalPath('/workspace/src/api/AGENTS.md', '/workspace'))
      .toBe('src/api/**/*');
  });

  it('returns undefined for a root-level file', () => {
    expect(deriveGlobFromHierarchicalPath('/workspace/CLAUDE.md', '/workspace'))
      .toBeUndefined();
  });

  it('handles deeply nested paths', () => {
    expect(deriveGlobFromHierarchicalPath('/workspace/a/b/c/AGENTS.md', '/workspace'))
      .toBe('a/b/c/**/*');
  });
});
