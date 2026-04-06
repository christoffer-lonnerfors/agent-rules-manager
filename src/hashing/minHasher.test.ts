import { describe, it, expect } from 'vitest';
import { computeMinHash, computeSimilarity, MINHASH_K } from './minHasher';

describe('computeMinHash', () => {
  it('returns a signature of length MINHASH_K', () => {
    const sig = computeMinHash('hello world foo bar baz');
    expect(sig).toHaveLength(MINHASH_K);
  });

  it('returns the same signature for identical content', () => {
    const content = 'Use conventional commits for all changes';
    expect(computeMinHash(content)).toEqual(computeMinHash(content));
  });

  it('returns a stable signature across calls (deterministic)', () => {
    const sig1 = computeMinHash('Always use TypeScript strict mode');
    const sig2 = computeMinHash('Always use TypeScript strict mode');
    expect(sig1).toEqual(sig2);
  });

  it('is case-insensitive', () => {
    const upper = computeMinHash('USE STRICT MODE');
    const lower = computeMinHash('use strict mode');
    expect(upper).toEqual(lower);
  });

  it('ignores punctuation differences', () => {
    const withPunct = computeMinHash('Hello, world! Use strict-mode.');
    const withoutPunct = computeMinHash('Hello world Use strict mode');
    expect(withPunct).toEqual(withoutPunct);
  });

  it('returns all-same signature for empty content', () => {
    const sig = computeMinHash('');
    expect(sig).toHaveLength(MINHASH_K);
    // All values should be the same (the prime sentinel)
    expect(new Set(sig).size).toBe(1);
  });

  it('handles whitespace-only content like empty', () => {
    const empty = computeMinHash('');
    const spaces = computeMinHash('   \n\t  ');
    expect(spaces).toEqual(empty);
  });

  it('produces different signatures for unrelated content', () => {
    const sig1 = computeMinHash('Configure ESLint rules for TypeScript projects');
    const sig2 = computeMinHash('Deploy Docker containers to Kubernetes cluster');
    expect(sig1).not.toEqual(sig2);
  });
});

describe('computeSimilarity', () => {
  it('returns 1.0 for identical signatures', () => {
    const sig = computeMinHash('Always run tests before pushing');
    expect(computeSimilarity(sig, sig)).toBe(1.0);
  });

  it('returns high similarity for near-duplicate content', () => {
    const a = computeMinHash(
      'Always use conventional commits for version control changes in this project',
    );
    const b = computeMinHash(
      'Always use conventional commits for version control changes in this repo',
    );
    expect(computeSimilarity(a, b)).toBeGreaterThan(0.7);
  });

  it('returns low similarity for unrelated content', () => {
    const a = computeMinHash(
      'Configure ESLint with strict TypeScript rules for the frontend application',
    );
    const b = computeMinHash(
      'Set up PostgreSQL database migrations using Flyway for the backend service',
    );
    expect(computeSimilarity(a, b)).toBeLessThan(0.3);
  });

  it('returns 0 for empty signatures', () => {
    expect(computeSimilarity([], [])).toBe(0);
  });

  it('returns 0 for mismatched signature lengths', () => {
    expect(computeSimilarity([1, 2, 3], [1, 2])).toBe(0);
  });

  it('returns 1.0 when comparing empty-content signatures', () => {
    const a = computeMinHash('');
    const b = computeMinHash('');
    expect(computeSimilarity(a, b)).toBe(1.0);
  });
});
