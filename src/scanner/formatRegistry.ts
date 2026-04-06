import { FormatDefinition, LinkPattern } from './formatDefinition';

// ── Shared link patterns ─────────────────────────────────────────────

/** Markdown links: [text](./path/to/file.md) */
const MARKDOWN_LINK: LinkPattern = {
  id: 'markdown-link',
  regex: /\[[^\]]*\]\(([^)]+)\)/g,
};

/** Backtick-quoted paths: `some/path.ext` */
const BACKTICK_PATH: LinkPattern = {
  id: 'backtick-path',
  regex: /`([^`\n]+)`/g,
};

/** Claude Code @-import: @AGENTS.md or @./path/to/file.md */
const AT_IMPORT: LinkPattern = {
  id: 'at-import',
  regex: /(?:^|\n)\s*@([^\s@]+\.[a-zA-Z0-9]+)\s*(?:\n|$)/g,
};

const STANDARD_LINKS: LinkPattern[] = [MARKDOWN_LINK, BACKTICK_PATH];

// ── Format definitions ───────────────────────────────────────────────

export const FORMAT_DEFINITIONS: FormatDefinition[] = [
  // ── Cursor ──
  {
    id: 'cursor-rules',
    label: 'Cursor Rules',
    icon: 'cursor',
    validPaths: ['.cursor/rules'],
    validNames: ['*'],
    validExtensions: ['.mdc', '.md'],
    isHierarchical: false,
    frontmatterFields: [
      { name: 'description', type: 'string', mapsTo: 'description' },
      { name: 'globs', type: 'string[]', mapsTo: 'globs' },
      { name: 'alwaysApply', type: 'boolean', mapsTo: 'trigger', valueMap: { true: 'always' } },
    ],
    defaults: { trigger: 'manual', descriptionImpliesAgentRequested: true },
    linkPatterns: STANDARD_LINKS,
  },
  {
    id: 'cursorrules',
    label: '.cursorrules',
    icon: 'cursor',
    validPaths: ['.'],
    validNames: ['.cursorrules'],
    validExtensions: [],
    isHierarchical: false,
    frontmatterFields: [],
    defaults: { trigger: 'always' },
    linkPatterns: STANDARD_LINKS,
  },
  // ── Windsurf ──
  {
    id: 'windsurf-rules',
    label: 'Windsurf Rules',
    icon: 'windsurf',
    validPaths: ['.windsurf/rules'],
    validNames: ['*'],
    validExtensions: ['.md'],
    isHierarchical: false,
    frontmatterFields: [
      { name: 'description', type: 'string', mapsTo: 'description' },
      { name: 'globs', type: 'string[]', mapsTo: 'globs' },
      { name: 'trigger', type: 'string', mapsTo: 'trigger', valueMap: { always_on: 'always', glob: 'glob', model_decision: 'agent_requested', manual: 'manual' } },
    ],
    defaults: { trigger: 'always' },
    linkPatterns: STANDARD_LINKS,
  },
  {
    id: 'windsurfrules',
    label: '.windsurfrules',
    icon: 'windsurf',
    validPaths: ['.'],
    validNames: ['.windsurfrules'],
    validExtensions: [],
    isHierarchical: false,
    frontmatterFields: [],
    defaults: { trigger: 'always' },
    linkPatterns: STANDARD_LINKS,
  },
  // ── Kiro ──
  {
    id: 'kiro',
    label: 'Kiro',
    icon: 'kiro',
    validPaths: ['.kiro/steering', '.kiro/specs'],
    validNames: ['*'],
    validExtensions: ['.md'],
    isHierarchical: false,
    frontmatterFields: [
      { name: 'description', type: 'string', mapsTo: 'description' },
      { name: 'fileMatchPattern', type: 'string[]', mapsTo: 'globs' },
      { name: 'inclusion', type: 'string', mapsTo: 'trigger', valueMap: { always: 'always', fileMatch: 'glob', auto: 'agent_requested', manual: 'manual' } },
    ],
    defaults: { trigger: 'always' }, // overridden per-directory in classifier
    linkPatterns: STANDARD_LINKS,
  },
  // ── Antigravity ──
  {
    id: 'antigravity',
    label: 'Antigravity',
    icon: 'antigravity',
    validPaths: ['.agents/rules', '.agent/rules'],
    validNames: ['*'],
    validExtensions: ['.md'],
    isHierarchical: false,
    frontmatterFields: [
      { name: 'description', type: 'string', mapsTo: 'description' },
      { name: 'globs', type: 'string[]', mapsTo: 'globs' },
      { name: 'trigger', type: 'string', mapsTo: 'trigger', valueMap: { always_on: 'always', glob: 'glob', model_decision: 'agent_requested', manual: 'manual' } },
    ],
    defaults: { trigger: 'always' },
    linkPatterns: STANDARD_LINKS,
  },
  // ── Augment ──
  {
    id: 'augment-rules',
    label: 'Augment Rules',
    icon: 'augment',
    validPaths: ['.augment/rules'],
    validNames: ['*'],
    validExtensions: ['.md'],
    isHierarchical: false,
    frontmatterFields: [
      { name: 'description', type: 'string', mapsTo: 'description' },
      { name: 'type', type: 'string', mapsTo: 'trigger', valueMap: { always_apply: 'always', agent_requested: 'agent_requested', manual: 'manual' } },
    ],
    defaults: { trigger: 'always' },
    linkPatterns: STANDARD_LINKS,
  },
  {
    id: 'augment-guidelines',
    label: '.augment-guidelines',
    icon: 'augment',
    validPaths: ['.'],
    validNames: ['.augment-guidelines'],
    validExtensions: [],
    isHierarchical: false,
    frontmatterFields: [],
    defaults: { trigger: 'always' },
    linkPatterns: STANDARD_LINKS,
  },
  // ── Claude Code ──
  {
    id: 'claude-rules',
    label: 'Claude Code Rules',
    icon: 'claude-code',
    validPaths: ['.claude/rules'],
    validNames: ['*'],
    validExtensions: ['.md'],
    isHierarchical: false,
    frontmatterFields: [
      { name: 'paths', type: 'string[]', mapsTo: 'globs' },
    ],
    defaults: { trigger: 'always' },
    linkPatterns: STANDARD_LINKS,
  },
  {
    id: 'claude-local',
    label: 'CLAUDE.local.md',
    icon: 'claude-code',
    validPaths: ['.'],
    validNames: ['CLAUDE.local.md'],
    validExtensions: ['.md'],
    isHierarchical: false,
    frontmatterFields: [],
    defaults: { trigger: 'always' },
    linkPatterns: STANDARD_LINKS,
  },
  // ── CLAUDE.md (cross-agent hierarchical) ──
  {
    id: 'claude-md',
    label: 'CLAUDE.md',
    icon: 'claude-code',
    validPaths: ['**'],
    validNames: ['CLAUDE.md'],
    validExtensions: ['.md'],
    isHierarchical: true,
    frontmatterFields: [],
    defaults: { trigger: 'always' },
    linkPatterns: [...STANDARD_LINKS, AT_IMPORT],
  },
  // ── AGENTS.md (cross-agent hierarchical) ──
  {
    id: 'agents-md',
    label: 'AGENTS.md',
    icon: 'agents-md',
    validPaths: ['**'],
    validNames: ['AGENTS.md'],
    validExtensions: ['.md'],
    isHierarchical: true,
    frontmatterFields: [],
    defaults: { trigger: 'always' },
    linkPatterns: STANDARD_LINKS,
  },
];

/**
 * Look up a format definition by ID.
 * Throws if the format is not registered.
 */
export function getFormatDefinition(id: string): FormatDefinition {
  const def = FORMAT_DEFINITIONS.find((d) => d.id === id);
  if (!def) {
    throw new Error(`Unknown format: ${id}`);
  }
  return def;
}
