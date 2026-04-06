import { describe, it, expect } from 'vitest';
import { estimateTokens, estimateLogicalRuleTokens, formatTokenCount } from './tokenEstimator';

describe('estimateTokens', () => {
  it('returns 0 for zero characters', () => {
    expect(estimateTokens(0)).toBe(0);
  });

  it('returns 0 for negative character count', () => {
    expect(estimateTokens(-100)).toBe(0);
  });

  it('returns a positive integer for positive input', () => {
    const result = estimateTokens(100);
    expect(result).toBeGreaterThan(0);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('rounds up (ceiling) to give conservative estimate', () => {
    // 1 char / 3.5 = 0.286 → should ceil to 1
    expect(estimateTokens(1)).toBe(1);
  });

  it('scales proportionally with character count', () => {
    const small = estimateTokens(100);
    const large = estimateTokens(1000);
    expect(large).toBeGreaterThan(small);
    // Should be roughly 10x
    expect(large / small).toBeCloseTo(10, 0);
  });
});

describe('estimateLogicalRuleTokens', () => {
  it('returns 0 for empty rules array', () => {
    expect(estimateLogicalRuleTokens([])).toBe(0);
  });

  it('uses the maximum bodyLength across rules', () => {
    const rules = [
      { bodyLength: 100 },
      { bodyLength: 500 },
      { bodyLength: 200 },
    ];
    const result = estimateLogicalRuleTokens(rules);
    expect(result).toBe(estimateTokens(500));
  });

  it('handles single rule', () => {
    const result = estimateLogicalRuleTokens([{ bodyLength: 350 }]);
    expect(result).toBe(estimateTokens(350));
  });
});

describe('formatTokenCount', () => {
  it('formats small counts as "≈ N tokens"', () => {
    expect(formatTokenCount(450)).toBe('≈ 450 tokens');
  });

  it('formats 1000+ as "≈ Nk tokens"', () => {
    expect(formatTokenCount(1200)).toBe('≈ 1.2k tokens');
  });

  it('drops .0 for even thousands', () => {
    expect(formatTokenCount(2000)).toBe('≈ 2k tokens');
  });

  it('formats zero', () => {
    expect(formatTokenCount(0)).toBe('≈ 0 tokens');
  });

  it('formats 999 without k suffix', () => {
    expect(formatTokenCount(999)).toBe('≈ 999 tokens');
  });

  it('formats exactly 1000 with k suffix', () => {
    expect(formatTokenCount(1000)).toBe('≈ 1k tokens');
  });
});
