import { describe, it, expect } from 'vitest';
import {
  hasIssue,
  maxSeverity,
  getLogicalIssues,
  getFileIssues,
  dedupeFileIssues,
  RuleIssue,
} from './ruleIssues';

const warning: RuleIssue = { id: 'empty-body', severity: 'warning', message: 'empty' };
const error: RuleIssue = {
  id: 'extension-mismatch',
  severity: 'error',
  message: 'mismatch',
  ruleId: 'r1',
};
const info: RuleIssue = { id: 'missing-description', severity: 'info', message: 'desc' };

describe('hasIssue', () => {
  it('returns true when issue is present', () => {
    expect(hasIssue([warning, error], 'empty-body')).toBe(true);
  });

  it('returns false when issue is absent', () => {
    expect(hasIssue([warning], 'extension-mismatch')).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(hasIssue([], 'empty-body')).toBe(false);
  });
});

describe('maxSeverity', () => {
  it('returns "error" when errors are present', () => {
    expect(maxSeverity([warning, error, info])).toBe('error');
  });

  it('returns "warning" when no errors', () => {
    expect(maxSeverity([warning, info])).toBe('warning');
  });

  it('returns "info" when only info issues', () => {
    expect(maxSeverity([info])).toBe('info');
  });

  it('returns undefined for empty array', () => {
    expect(maxSeverity([])).toBeUndefined();
  });
});

describe('getLogicalIssues', () => {
  it('returns only issues without ruleId', () => {
    const result = getLogicalIssues([warning, error]);
    expect(result).toEqual([warning]);
  });
});

describe('getFileIssues', () => {
  it('returns only issues matching the ruleId', () => {
    const other: RuleIssue = { id: 'empty-body', severity: 'warning', message: 'x', ruleId: 'r2' };
    const result = getFileIssues([warning, error, other], 'r1');
    expect(result).toEqual([error]);
  });
});

describe('dedupeFileIssues', () => {
  it('deduplicates file issues with same id and message', () => {
    const a: RuleIssue = { id: 'empty-body', severity: 'warning', message: 'empty', ruleId: 'r1' };
    const b: RuleIssue = { id: 'empty-body', severity: 'warning', message: 'empty', ruleId: 'r2' };
    const result = dedupeFileIssues([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].ruleId).toBeUndefined(); // promoted to logical-level
  });

  it('preserves issues with different messages under same id', () => {
    const a: RuleIssue = {
      id: 'broken-reference',
      severity: 'warning',
      message: 'file A not found',
      ruleId: 'r1',
    };
    const b: RuleIssue = {
      id: 'broken-reference',
      severity: 'warning',
      message: 'file B not found',
      ruleId: 'r1',
    };
    const result = dedupeFileIssues([a, b]);
    expect(result).toHaveLength(2);
  });

  it('ignores logical-level issues (no ruleId)', () => {
    const result = dedupeFileIssues([warning]);
    expect(result).toEqual([]);
  });
});
