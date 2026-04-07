import { describe, it, expect } from 'vitest';
import {
  AgentId,
  getAgentDefinition,
  getReadableFormats,
  getWritableFormats,
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
  it('includes the primary format', () => {
    const formats = getReadableFormats('cursor');
    expect(formats).toContain('cursor-rules');
  });

  it('includes legacy formats', () => {
    const formats = getReadableFormats('cursor');
    expect(formats).toContain('cursorrules');
  });

  it('includes supported cross-agent formats', () => {
    const formats = getReadableFormats('cursor');
    expect(formats).toContain('agents-md');
  });

  it('windsurf reads its own formats and agents-md', () => {
    const formats = getReadableFormats('windsurf');
    expect(formats).toContain('windsurf-rules');
    expect(formats).toContain('windsurfrules');
    expect(formats).toContain('agents-md');
  });

  it('claude-code reads claude-md, agents-md, and claude-code formats', () => {
    const formats = getReadableFormats('claude-code');
    expect(formats).toContain('claude-rules');
    expect(formats).toContain('claude-local');
    expect(formats).toContain('claude-md');
    expect(formats).toContain('agents-md');
  });
});

describe('getWritableFormats', () => {
  it('excludes legacy formats', () => {
    expect(getWritableFormats('cursor')).not.toContain('cursorrules');
    expect(getWritableFormats('windsurf')).not.toContain('windsurfrules');
    expect(getWritableFormats('augment')).not.toContain('augment-guidelines');
  });

  it('includes the primary format', () => {
    expect(getWritableFormats('cursor')).toContain('cursor-rules');
    expect(getWritableFormats('windsurf')).toContain('windsurf-rules');
  });

  it('includes agents-md as a writable cross-agent format', () => {
    expect(getWritableFormats('cursor')).toContain('agents-md');
    expect(getWritableFormats('windsurf')).toContain('agents-md');
    expect(getWritableFormats('claude-code')).toContain('agents-md');
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
  it('uses the override when it is writable by the agent', () => {
    expect(getEffectiveWriteFormat('claude-code', 'agents-md')).toBe('agents-md');
  });

  it('falls back to default when override is not readable', () => {
    expect(getEffectiveWriteFormat('windsurf', 'cursor-rules')).toBe('windsurf-rules');
  });

  it('falls back to default when override is a legacy (non-writable) format', () => {
    expect(getEffectiveWriteFormat('cursor', 'cursorrules')).toBe('cursor-rules');
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
    expect(isRuleCoveredByAgent(['agents-md'], 'cursor')).toBe(true);
  });

  it('returns false when no format is readable', () => {
    expect(isRuleCoveredByAgent(['kiro'], 'cursor')).toBe(false);
  });

  it('returns false for empty format list', () => {
    expect(isRuleCoveredByAgent([], 'cursor')).toBe(false);
  });
});
