import { describe, it, expect } from 'vitest';
import { matchFormat, classify } from './formatClassifier';

const WS = '/workspace';
const NOW = new Date('2025-01-01T00:00:00Z');

// ── matchFormat ──────────────────────────────────────────────────────

describe('matchFormat', () => {
  it('matches .cursor/rules/*.mdc as cursor-rules', () => {
    expect(matchFormat('.cursor/rules/my-rule.mdc', 'my-rule.mdc', '.mdc')?.id).toBe(
      'cursor-rules',
    );
  });
  it('matches .cursor/rules/*.md as cursor-rules', () => {
    expect(matchFormat('.cursor/rules/rule.md', 'rule.md', '.md')?.id).toBe('cursor-rules');
  });
  it('matches .cursorrules as cursorrules', () => {
    expect(matchFormat('.cursorrules', '.cursorrules', '')?.id).toBe('cursorrules');
  });
  it('matches .windsurf/rules/*.md as windsurf-rules', () => {
    expect(matchFormat('.windsurf/rules/r.md', 'r.md', '.md')?.id).toBe('windsurf-rules');
  });
  it('matches .windsurfrules as windsurfrules', () => {
    expect(matchFormat('.windsurfrules', '.windsurfrules', '')?.id).toBe('windsurfrules');
  });
  it('matches .kiro/steering/*.md as kiro', () => {
    expect(matchFormat('.kiro/steering/rule.md', 'rule.md', '.md')?.id).toBe('kiro');
  });
  it('matches .kiro/specs/*.md as kiro', () => {
    expect(matchFormat('.kiro/specs/spec.md', 'spec.md', '.md')?.id).toBe('kiro');
  });
  it('matches .agents/rules/*.md as antigravity', () => {
    expect(matchFormat('.agents/rules/r.md', 'r.md', '.md')?.id).toBe('antigravity');
  });
  it('matches .agent/rules/*.md as antigravity', () => {
    expect(matchFormat('.agent/rules/r.md', 'r.md', '.md')?.id).toBe('antigravity');
  });
  it('matches .augment/rules/*.md as augment-rules', () => {
    expect(matchFormat('.augment/rules/r.md', 'r.md', '.md')?.id).toBe('augment-rules');
  });
  it('matches .augment-guidelines as augment-guidelines', () => {
    expect(matchFormat('.augment-guidelines', '.augment-guidelines', '')?.id).toBe(
      'augment-guidelines',
    );
  });
  it('matches .claude/rules/*.md as claude-rules', () => {
    expect(matchFormat('.claude/rules/r.md', 'r.md', '.md')?.id).toBe('claude-rules');
  });
  it('matches CLAUDE.local.md as claude-local', () => {
    expect(matchFormat('CLAUDE.local.md', 'CLAUDE.local.md', '.md')?.id).toBe('claude-local');
  });
  it('matches root CLAUDE.md as claude-md', () => {
    expect(matchFormat('CLAUDE.md', 'CLAUDE.md', '.md')?.id).toBe('claude-md');
  });
  it('matches nested CLAUDE.md as claude-md', () => {
    expect(matchFormat('src/components/CLAUDE.md', 'CLAUDE.md', '.md')?.id).toBe('claude-md');
  });
  it('matches root AGENTS.md as agents-md', () => {
    expect(matchFormat('AGENTS.md', 'AGENTS.md', '.md')?.id).toBe('agents-md');
  });
  it('matches nested AGENTS.md as agents-md', () => {
    expect(matchFormat('src/AGENTS.md', 'AGENTS.md', '.md')?.id).toBe('agents-md');
  });
  it('returns undefined for unknown files', () => {
    expect(matchFormat('README.md', 'README.md', '.md')).toBeUndefined();
  });
  it('returns undefined for wrong extension', () => {
    expect(matchFormat('.cursor/rules/rule.txt', 'rule.txt', '.txt')).toBeUndefined();
  });
});

// ── classify: trigger mapping ────────────────────────────────────────

describe('classify — trigger mapping', () => {
  it('cursor-rules: alwaysApply true → always', () => {
    const r = classify(
      `${WS}/.cursor/rules/r.mdc`,
      '---\nalwaysApply: true\n---\nUse TypeScript strict mode for all project files',
      100,
      NOW,
      WS,
    );
    expect(r?.format).toBe('cursor-rules');
    expect(r?.trigger).toBe('always');
  });

  it('cursor-rules: globs → glob', () => {
    const r = classify(
      `${WS}/.cursor/rules/r.mdc`,
      '---\nglobs:\n  - "*.ts"\n---\nUse TypeScript strict mode for all project files',
      100,
      NOW,
      WS,
    );
    expect(r?.trigger).toBe('glob');
    expect(r?.globs).toEqual(['*.ts']);
  });

  it('cursor-rules: description only → agent_requested', () => {
    const r = classify(
      `${WS}/.cursor/rules/r.mdc`,
      '---\ndescription: Help with tests\n---\nUse TypeScript strict mode for all project files',
      100,
      NOW,
      WS,
    );
    expect(r?.trigger).toBe('agent_requested');
    expect(r?.description).toBe('Help with tests');
  });

  it('cursor-rules: no frontmatter → manual', () => {
    const r = classify(
      `${WS}/.cursor/rules/r.mdc`,
      'Use TypeScript strict mode for all project files in the repo',
      100,
      NOW,
      WS,
    );
    expect(r?.trigger).toBe('manual');
  });

  it('cursorrules: standalone → always', () => {
    const r = classify(
      `${WS}/.cursorrules`,
      'Use TypeScript strict mode for all project files in the repo',
      100,
      NOW,
      WS,
    );
    expect(r?.format).toBe('cursorrules');
    expect(r?.trigger).toBe('always');
  });

  it('windsurf-rules: trigger always_on → always', () => {
    const r = classify(
      `${WS}/.windsurf/rules/r.md`,
      '---\ntrigger: always_on\n---\nUse TypeScript strict mode for all project files',
      100,
      NOW,
      WS,
    );
    expect(r?.trigger).toBe('always');
  });

  it('windsurf-rules: trigger glob + globs → glob', () => {
    const r = classify(
      `${WS}/.windsurf/rules/r.md`,
      '---\ntrigger: glob\nglobs:\n  - "*.ts"\n---\nUse TypeScript strict mode for all files',
      100,
      NOW,
      WS,
    );
    expect(r?.trigger).toBe('glob');
    expect(r?.globs).toEqual(['*.ts']);
  });

  it('windsurf-rules: no frontmatter → always', () => {
    const r = classify(
      `${WS}/.windsurf/rules/r.md`,
      'Use TypeScript strict mode for all project files in the repo',
      100,
      NOW,
      WS,
    );
    expect(r?.trigger).toBe('always');
  });

  it('augment-rules: type always_apply → always', () => {
    const r = classify(
      `${WS}/.augment/rules/r.md`,
      '---\ntype: always_apply\n---\nUse TypeScript strict mode for all project files',
      100,
      NOW,
      WS,
    );
    expect(r?.trigger).toBe('always');
  });

  it('augment-rules: type agent_requested', () => {
    const r = classify(
      `${WS}/.augment/rules/r.md`,
      '---\ntype: agent_requested\n---\nUse TypeScript strict mode for all project files',
      100,
      NOW,
      WS,
    );
    expect(r?.trigger).toBe('agent_requested');
  });

  it('claude-rules: paths → glob', () => {
    const r = classify(
      `${WS}/.claude/rules/r.md`,
      '---\npaths:\n  - "src/**"\n---\nUse TypeScript strict mode for all project files',
      100,
      NOW,
      WS,
    );
    expect(r?.trigger).toBe('glob');
    expect(r?.globs).toEqual(['src/**']);
  });

  it('claude-rules: no frontmatter → always', () => {
    const r = classify(
      `${WS}/.claude/rules/r.md`,
      'Use TypeScript strict mode for all project files in the repo',
      100,
      NOW,
      WS,
    );
    expect(r?.trigger).toBe('always');
  });

  it('kiro: inclusion always → always', () => {
    const r = classify(
      `${WS}/.kiro/steering/r.md`,
      '---\ninclusion: always\n---\nUse TypeScript strict mode for all project files',
      100,
      NOW,
      WS,
    );
    expect(r?.trigger).toBe('always');
  });

  it('kiro: inclusion fileMatch → glob', () => {
    const r = classify(
      `${WS}/.kiro/steering/r.md`,
      '---\ninclusion: fileMatch\nfileMatchPattern:\n  - "*.ts"\n---\nUse TypeScript strict mode',
      100,
      NOW,
      WS,
    );
    expect(r?.trigger).toBe('glob');
    expect(r?.globs).toEqual(['*.ts']);
  });

  it('claude-md at root → always', () => {
    const r = classify(
      `${WS}/CLAUDE.md`,
      '# Rules\n\nUse TypeScript strict mode for all project files in the repo',
      100,
      NOW,
      WS,
    );
    expect(r?.format).toBe('claude-md');
    expect(r?.trigger).toBe('always');
    expect(r?.isHierarchical).toBe(true);
  });

  it('claude-md in subdirectory → glob', () => {
    const r = classify(
      `${WS}/src/components/CLAUDE.md`,
      'Component rules for TypeScript strict mode for all files in project',
      100,
      NOW,
      WS,
    );
    expect(r?.format).toBe('claude-md');
    expect(r?.trigger).toBe('glob');
    expect(r?.globs).toEqual(['src/components/**/*']);
  });
});

// ── classify: frontmatter parsing ────────────────────────────────────

describe('classify — frontmatter', () => {
  it('preserves all raw frontmatter fields including unknown ones', () => {
    const r = classify(
      `${WS}/.cursor/rules/r.mdc`,
      '---\nalwaysApply: true\ncustomField: hello\n---\nUse TypeScript strict mode for all files',
      100,
      NOW,
      WS,
    );
    expect(r?.frontmatterFields).toEqual({ alwaysApply: true, customField: 'hello' });
    expect(r?.rawFrontmatter).toContain('alwaysApply: true');
  });

  it('handles no frontmatter', () => {
    const r = classify(
      `${WS}/.cursor/rules/r.mdc`,
      'Just body content no frontmatter use TypeScript strict mode for all files',
      100,
      NOW,
      WS,
    );
    expect(r?.frontmatterFields).toEqual({});
    expect(r?.rawFrontmatter).toBeUndefined();
  });

  it('handles malformed YAML gracefully', () => {
    const r = classify(
      `${WS}/.cursor/rules/r.mdc`,
      '---\n: invalid: yaml: here\n---\nUse TypeScript strict mode for all project files',
      100,
      NOW,
      WS,
    );
    expect(r).toBeDefined();
    expect(r?.body).toBe('Use TypeScript strict mode for all project files');
  });
});

// ── classify: description extraction ─────────────────────────────────

describe('classify — description', () => {
  it('extracts description from frontmatter', () => {
    const r = classify(
      `${WS}/.windsurf/rules/r.md`,
      '---\ndescription: My cool rule\ntrigger: always_on\n---\nUse TypeScript strict mode',
      100,
      NOW,
      WS,
    );
    expect(r?.description).toBe('My cool rule');
  });

  it('falls back to first heading when no frontmatter description', () => {
    const r = classify(
      `${WS}/CLAUDE.md`,
      '# Project Rules\n\nUse TypeScript strict mode for all project files in repo',
      100,
      NOW,
      WS,
    );
    expect(r?.description).toBe('Project Rules');
  });

  it('returns undefined when no description or heading', () => {
    const r = classify(
      `${WS}/CLAUDE.md`,
      'Just plain text without heading use TypeScript strict mode for all files',
      100,
      NOW,
      WS,
    );
    expect(r?.description).toBeUndefined();
  });
});

// ── classify: link extraction ────────────────────────────────────────

describe('classify — links', () => {
  it('extracts markdown links', () => {
    const r = classify(
      `${WS}/CLAUDE.md`,
      'See [reference](./docs/rules.md) for more details about the project rules',
      100,
      NOW,
      WS,
    );
    expect(r?.links).toContainEqual({ patternId: 'markdown-link', target: './docs/rules.md' });
  });

  it('extracts backtick paths', () => {
    const r = classify(
      `${WS}/CLAUDE.md`,
      'Check the config in `config/settings.json` for project settings and rules',
      100,
      NOW,
      WS,
    );
    expect(r?.links).toContainEqual({ patternId: 'backtick-path', target: 'config/settings.json' });
  });

  it('extracts @-import links from claude-md', () => {
    const r = classify(`${WS}/CLAUDE.md`, '@AGENTS.md', 100, NOW, WS);
    expect(r?.links).toContainEqual({ patternId: 'at-import', target: 'AGENTS.md' });
  });

  it('does not extract @-import links from agents-md', () => {
    const r = classify(`${WS}/AGENTS.md`, '@CLAUDE.md', 100, NOW, WS);
    const atImports = r?.links.filter((l) => l.patternId === 'at-import') ?? [];
    expect(atImports).toHaveLength(0);
  });

  it('skips URLs', () => {
    const r = classify(
      `${WS}/CLAUDE.md`,
      'Visit [docs](https://example.com/docs) for more project info and rules',
      100,
      NOW,
      WS,
    );
    expect(r?.links).toHaveLength(0);
  });

  it('skips anchors', () => {
    const r = classify(
      `${WS}/CLAUDE.md`,
      'See [section](#overview) for more info about the project rules overview',
      100,
      NOW,
      WS,
    );
    expect(r?.links).toHaveLength(0);
  });
});

// ── classify: no match ───────────────────────────────────────────────

describe('classify — no match', () => {
  it('returns undefined for non-.md unrecognized files', () => {
    expect(classify(`${WS}/config.json`, '{}', 10, NOW, WS)).toBeUndefined();
  });

  it('classifies unrecognized .md files as document format', () => {
    const result = classify(`${WS}/README.md`, '# Readme content here', 100, NOW, WS);
    expect(result).toBeDefined();
    expect(result!.format).toBe('document');
    expect(result!.trigger).toBe('always');
  });
});

// ── classify: hashing ────────────────────────────────────────────────

describe('classify — hashing', () => {
  it('computes bodyHash and contentHash', () => {
    const r = classify(
      `${WS}/CLAUDE.md`,
      'Use TypeScript strict mode for all project files in the repo',
      100,
      NOW,
      WS,
    );
    expect(r?.bodyHash).toBeTruthy();
    expect(r?.contentHash).toBeDefined();
    expect(r?.contentHash.length).toBeGreaterThan(0);
  });

  it('same content produces same bodyHash', () => {
    const content = 'Use TypeScript strict mode for all project files in the repository';
    const r1 = classify(`${WS}/CLAUDE.md`, content, 100, NOW, WS);
    const r2 = classify(`${WS}/src/CLAUDE.md`, content, 100, NOW, WS);
    expect(r1?.bodyHash).toBe(r2?.bodyHash);
  });

  it('computes bodyLength from trimmed body', () => {
    const r = classify(`${WS}/CLAUDE.md`, '  Use TypeScript strict mode  ', 100, NOW, WS);
    expect(r?.bodyLength).toBe('Use TypeScript strict mode'.length);
  });
});
