import { describe, it, expect } from 'vitest';
import {
  AgentId,
  getAgentDefinition,
  getReadableFormats,
  getDefaultWriteFormat,
  getEffectiveWriteFormat,
  isRuleCoveredByAgent,
  AGENT_DEFINITIONS,
} from './agentRegistry';

describe('getAgentDefinition', () => {
  it('returns definition for each known agent', () => {
    for (const def of AGENT_DEFINITIONS) {
      const result = getAgentDefinition(def.id as AgentId);
      expect(result.id).toBe(def.id);
      expect(result.label).toBeTruthy();
    }
  });
});

describe('getReadableFormats', () => {
  it('includes primary formats', () => {
    const formats = getReadableFormats('cursor');
    expect(formats).toContain('cursor-rules');
    expect(formats).toContain('cursorrules');
  });

  it('includes supported cross-agent formats', () => {
    const formats = getReadableFormats('cursor');
    expect(formats).toContain('agents-md');
  });

  it('claude-code reads claude-md, agents-md, and claude-code formats', () => {
    const formats = getReadableFormats('claude-code');
    expect(formats).toContain('claude-rules');
    expect(formats).toContain('claude-local');
    expect(formats).toContain('claude-md');
    expect(formats).toContain('agents-md');
  });

  it('windsurf only reads its own formats', () => {
    const formats = getReadableFormats('windsurf');
    expect(formats).toEqual(['windsurf-rules', 'windsurfrules']);
  });
});

describe('getDefaultWriteFormat', () => {
  it('returns the primary format for each agent', () => {
    expect(getDefaultWriteFormat('cursor')).toBe('cursor-rules');
    expect(getDefaultWriteFormat('windsurf')).toBe('windsurf-rules');
    expect(getDefaultWriteFormat('claude-code')).toBe('claude-rules');
  });
});

describe('getEffectiveWriteFormat', () => {
  it('uses the override when it is readable by the agent', () => {
    // claude-code can read agents-md
    expect(getEffectiveWriteFormat('claude-code', 'agents-md')).toBe('agents-md');
  });

  it('falls back to default when override is not readable', () => {
    // windsurf cannot read cursor format
    expect(getEffectiveWriteFormat('windsurf', 'cursor-rules')).toBe('windsurf-rules');
  });

  it('falls back to default when override is empty', () => {
    expect(getEffectiveWriteFormat('cursor', '')).toBe('cursor-rules');
  });
});

describe('isRuleCoveredByAgent', () => {
  it('returns true when rule has a format the agent reads', () => {
    expect(isRuleCoveredByAgent(['cursor-rules', 'windsurf-rules'], 'cursor')).toBe(true);
  });

  it('returns true for cross-agent format coverage', () => {
    // Cursor reads agents-md
    expect(isRuleCoveredByAgent(['agents-md'], 'cursor')).toBe(true);
  });

  it('returns false when no format is readable', () => {
    expect(isRuleCoveredByAgent(['kiro'], 'cursor')).toBe(false);
  });

  it('returns false for empty format list', () => {
    expect(isRuleCoveredByAgent([], 'cursor')).toBe(false);
  });
});
