import { describe, it, expect } from 'vitest';
import { normalizeTrigger } from './triggerNormalizer';

const WS = '/workspace';

describe('normalizeTrigger', () => {
  describe('standalone files', () => {
    it('always returns trigger "always" regardless of fields', () => {
      const result = normalizeTrigger(
        'cursor',
        { alwaysApply: false },
        '/workspace/.cursorrules',
        'standalone_file',
        WS,
      );
      expect(result.trigger).toBe('always');
    });

    it('extracts description from fields', () => {
      const result = normalizeTrigger(
        'windsurf',
        { description: 'My desc' },
        '/workspace/.windsurfrules',
        'standalone_file',
        WS,
      );
      expect(result.description).toBe('My desc');
    });
  });

  describe('hierarchical MDs', () => {
    it('returns "always" for root-level files', () => {
      const result = normalizeTrigger(
        'claude-md',
        {},
        '/workspace/CLAUDE.md',
        'hierarchical_md',
        WS,
      );
      expect(result.trigger).toBe('always');
      expect(result.globs).toBeUndefined();
    });

    it('returns "glob" with implicit glob for subdirectory files', () => {
      const result = normalizeTrigger(
        'agents-md',
        {},
        '/workspace/src/api/AGENTS.md',
        'hierarchical_md',
        WS,
      );
      expect(result.trigger).toBe('glob');
      expect(result.globs).toEqual(['src/api/**/*']);
    });
  });

  describe('cursor format', () => {
    it('returns "always" when alwaysApply is true', () => {
      const result = normalizeTrigger(
        'cursor',
        { alwaysApply: true },
        '/workspace/.cursor/rules/r.mdc',
        'directory_rule',
        WS,
      );
      expect(result.trigger).toBe('always');
    });

    it('returns "glob" when globs are provided', () => {
      const result = normalizeTrigger(
        'cursor',
        { globs: ['*.ts'] },
        '/workspace/.cursor/rules/r.mdc',
        'directory_rule',
        WS,
      );
      expect(result.trigger).toBe('glob');
      expect(result.globs).toEqual(['*.ts']);
    });

    it('returns "agent_requested" when only description is present', () => {
      const result = normalizeTrigger(
        'cursor',
        { description: 'Help with tests' },
        '/workspace/.cursor/rules/r.mdc',
        'directory_rule',
        WS,
      );
      expect(result.trigger).toBe('agent_requested');
    });

    it('returns "manual" when no fields are present', () => {
      const result = normalizeTrigger(
        'cursor',
        {},
        '/workspace/.cursor/rules/r.mdc',
        'directory_rule',
        WS,
      );
      expect(result.trigger).toBe('manual');
    });
  });

  describe('windsurf format', () => {
    it.each([
      ['always_on', 'always'],
      ['glob', 'glob'],
      ['model_decision', 'agent_requested'],
      ['manual', 'manual'],
    ] as const)('maps trigger "%s" to "%s"', (input, expected) => {
      const result = normalizeTrigger(
        'windsurf',
        { trigger: input, globs: ['*.ts'] },
        '/workspace/.windsurf/rules/r.md',
        'directory_rule',
        WS,
      );
      expect(result.trigger).toBe(expected);
    });

    it('defaults to "always" when trigger field is absent', () => {
      const result = normalizeTrigger(
        'windsurf',
        {},
        '/workspace/.windsurf/rules/r.md',
        'directory_rule',
        WS,
      );
      expect(result.trigger).toBe('always');
    });
  });

  describe('kiro format', () => {
    it('maps inclusion "always" to trigger "always"', () => {
      const result = normalizeTrigger(
        'kiro',
        { inclusion: 'always' },
        '/workspace/.kiro/steering/r.md',
        'directory_rule',
        WS,
      );
      expect(result.trigger).toBe('always');
    });

    it('maps inclusion "fileMatch" to trigger "glob"', () => {
      const result = normalizeTrigger(
        'kiro',
        { inclusion: 'fileMatch', fileMatchPattern: '*.ts' },
        '/workspace/.kiro/steering/r.md',
        'directory_rule',
        WS,
      );
      expect(result.trigger).toBe('glob');
      expect(result.globs).toEqual(['*.ts']);
    });

    it('defaults to "always" in steering directory', () => {
      const result = normalizeTrigger(
        'kiro',
        {},
        '/workspace/.kiro/steering/r.md',
        'directory_rule',
        WS,
      );
      expect(result.trigger).toBe('always');
    });

    it('defaults to "manual" in specs directory', () => {
      const result = normalizeTrigger(
        'kiro',
        {},
        '/workspace/.kiro/specs/r.md',
        'directory_rule',
        WS,
      );
      expect(result.trigger).toBe('manual');
    });
  });

  describe('augment format', () => {
    it.each([
      ['always_apply', 'always'],
      ['agent_requested', 'agent_requested'],
      ['manual', 'manual'],
    ] as const)('maps type "%s" to "%s"', (input, expected) => {
      const result = normalizeTrigger(
        'augment',
        { type: input },
        '/workspace/.augment/rules/r.md',
        'directory_rule',
        WS,
      );
      expect(result.trigger).toBe(expected);
    });

    it('defaults to "always" when type is absent', () => {
      const result = normalizeTrigger(
        'augment',
        {},
        '/workspace/.augment/rules/r.md',
        'directory_rule',
        WS,
      );
      expect(result.trigger).toBe('always');
    });
  });

  describe('claude-code format', () => {
    it('returns "glob" when paths are provided', () => {
      const result = normalizeTrigger(
        'claude-code',
        { paths: ['src/**'] },
        '/workspace/.claude/rules/r.md',
        'directory_rule',
        WS,
      );
      expect(result.trigger).toBe('glob');
      expect(result.globs).toEqual(['src/**']);
    });

    it('returns "always" when no paths are provided', () => {
      const result = normalizeTrigger(
        'claude-code',
        {},
        '/workspace/.claude/rules/r.md',
        'directory_rule',
        WS,
      );
      expect(result.trigger).toBe('always');
    });
  });

  describe('glob normalization', () => {
    it('wraps a single string glob into an array', () => {
      const result = normalizeTrigger(
        'cursor',
        { globs: '*.ts' },
        '/workspace/.cursor/rules/r.mdc',
        'directory_rule',
        WS,
      );
      expect(result.globs).toEqual(['*.ts']);
    });

    it('filters non-string values from glob arrays', () => {
      const result = normalizeTrigger(
        'cursor',
        { globs: ['*.ts', 42, null, '*.js'] },
        '/workspace/.cursor/rules/r.mdc',
        'directory_rule',
        WS,
      );
      expect(result.globs).toEqual(['*.ts', '*.js']);
    });
  });
});
