import { describe, it, expect } from 'vitest';
import { mapTrigger } from './triggerMapper';
import { getFormatDefinition } from '../formats/formatRegistry';

const WS = '/workspace';

// ── Hierarchical files ────────────────────────────────────────────────

describe('mapTrigger — hierarchical', () => {
  const def = getFormatDefinition('claude-md');

  it('root file → always', () => {
    const result = mapTrigger(def, {}, `${WS}/CLAUDE.md`, WS);
    expect(result.trigger).toBe('always');
    expect(result.globs).toBeUndefined();
  });

  it('nested file → glob derived from directory', () => {
    const result = mapTrigger(def, {}, `${WS}/src/components/CLAUDE.md`, WS);
    expect(result.trigger).toBe('glob');
    expect(result.globs).toEqual(['src/components/**/*']);
  });
});

// ── Standalone files ──────────────────────────────────────────────────

describe('mapTrigger — standalone', () => {
  it('.cursorrules → always', () => {
    const def = getFormatDefinition('cursorrules');
    const result = mapTrigger(def, {}, `${WS}/.cursorrules`, WS);
    expect(result.trigger).toBe('always');
  });

  it('.windsurfrules → always', () => {
    const def = getFormatDefinition('windsurfrules');
    const result = mapTrigger(def, {}, `${WS}/.windsurfrules`, WS);
    expect(result.trigger).toBe('always');
  });
});

// ── Boolean trigger fields ────────────────────────────────────────────

describe('mapTrigger — boolean trigger fields', () => {
  const def = getFormatDefinition('cursor-rules');

  it('alwaysApply: true → always', () => {
    const result = mapTrigger(def, { alwaysApply: true }, `${WS}/.cursor/rules/r.mdc`, WS);
    expect(result.trigger).toBe('always');
  });

  it('alwaysApply: false → falls through to default (manual)', () => {
    const result = mapTrigger(def, { alwaysApply: false }, `${WS}/.cursor/rules/r.mdc`, WS);
    expect(result.trigger).toBe('manual');
  });
});

// ── String trigger fields ─────────────────────────────────────────────

describe('mapTrigger — string trigger fields', () => {
  const def = getFormatDefinition('windsurf-rules');

  it('trigger: always_on → always', () => {
    const result = mapTrigger(def, { trigger: 'always_on' }, `${WS}/.windsurf/rules/r.md`, WS);
    expect(result.trigger).toBe('always');
  });

  it('trigger: model_decision → agent_requested', () => {
    const result = mapTrigger(def, { trigger: 'model_decision' }, `${WS}/.windsurf/rules/r.md`, WS);
    expect(result.trigger).toBe('agent_requested');
  });

  it('trigger: glob + globs → glob with patterns', () => {
    const result = mapTrigger(
      def,
      { trigger: 'glob', globs: ['*.ts', '*.tsx'] },
      `${WS}/.windsurf/rules/r.md`,
      WS,
    );
    expect(result.trigger).toBe('glob');
    expect(result.globs).toEqual(['*.ts', '*.tsx']);
  });

  it('trigger: manual → manual', () => {
    const result = mapTrigger(def, { trigger: 'manual' }, `${WS}/.windsurf/rules/r.md`, WS);
    expect(result.trigger).toBe('manual');
  });
});

// ── Implicit glob (no trigger field) ─────────────────────────────────

describe('mapTrigger — implicit glob', () => {
  it('cursor-rules: globs without trigger → glob', () => {
    const def = getFormatDefinition('cursor-rules');
    const result = mapTrigger(def, { globs: ['src/**'] }, `${WS}/.cursor/rules/r.mdc`, WS);
    expect(result.trigger).toBe('glob');
    expect(result.globs).toEqual(['src/**']);
  });

  it('claude-rules: paths field → glob', () => {
    const def = getFormatDefinition('claude-rules');
    const result = mapTrigger(def, { paths: ['src/**', 'lib/**'] }, `${WS}/.claude/rules/r.md`, WS);
    expect(result.trigger).toBe('glob');
    expect(result.globs).toEqual(['src/**', 'lib/**']);
  });
});

// ── Cursor descriptionImpliesAgentRequested ───────────────────────────

describe('mapTrigger — descriptionImpliesAgentRequested', () => {
  const def = getFormatDefinition('cursor-rules');

  it('description only → agent_requested', () => {
    const result = mapTrigger(
      def,
      { description: 'Help with tests' },
      `${WS}/.cursor/rules/r.mdc`,
      WS,
    );
    expect(result.trigger).toBe('agent_requested');
    expect(result.description).toBe('Help with tests');
  });

  it('no frontmatter → manual (format default)', () => {
    const result = mapTrigger(def, {}, `${WS}/.cursor/rules/r.mdc`, WS);
    expect(result.trigger).toBe('manual');
  });
});

// ── Description extraction ────────────────────────────────────────────

describe('mapTrigger — description', () => {
  it('extracts description from frontmatter field', () => {
    const def = getFormatDefinition('windsurf-rules');
    const result = mapTrigger(
      def,
      { description: 'My rule', trigger: 'always_on' },
      `${WS}/.windsurf/rules/r.md`,
      WS,
    );
    expect(result.description).toBe('My rule');
  });

  it('returns undefined when no description field', () => {
    const def = getFormatDefinition('windsurf-rules');
    const result = mapTrigger(def, { trigger: 'always_on' }, `${WS}/.windsurf/rules/r.md`, WS);
    expect(result.description).toBeUndefined();
  });

  it('returns undefined for formats without a description field', () => {
    const def = getFormatDefinition('claude-md');
    const result = mapTrigger(def, {}, `${WS}/CLAUDE.md`, WS);
    expect(result.description).toBeUndefined();
  });
});

// ── Glob normalization ────────────────────────────────────────────────

describe('mapTrigger — glob normalization', () => {
  const def = getFormatDefinition('cursor-rules');

  it('string glob → wrapped in array', () => {
    const result = mapTrigger(def, { globs: '*.ts' }, `${WS}/.cursor/rules/r.mdc`, WS);
    expect(result.globs).toEqual(['*.ts']);
  });

  it('array glob → filtered to strings', () => {
    const result = mapTrigger(
      def,
      { globs: ['*.ts', 42, '*.tsx'] },
      `${WS}/.cursor/rules/r.mdc`,
      WS,
    );
    expect(result.globs).toEqual(['*.ts', '*.tsx']);
  });
});
