import { FormatDefinition, AT_IMPORT, STANDARD_LINKS } from './formatDefinition';
export type { RuleTrigger } from './formatDefinition';

// ── Format definitions ───────────────────────────────────────────────

const _definitions = [
  // ── Cursor ──
  {
    id: 'cursor-rules' as const,
    label: 'Cursor Rules',
    icon: 'cursor',
    docsUrl: 'https://cursor.com/docs/rules',
    validPaths: ['.cursor/rules'],
    validNames: ['*'],
    validExtensions: ['.mdc', '.md'],
    isHierarchical: false,
    frontmatterFields: [
      {
        name: 'alwaysApply',
        type: 'boolean',
        mapsTo: 'trigger',
        valueMap: { true: 'always' },
        writeValueMap: { always: 'true', glob: 'false' },
      },
      { name: 'globs', type: 'string[]', mapsTo: 'globs', emitWhen: ['glob'] },
      { name: 'description', type: 'string', mapsTo: 'description' },
    ],
    defaults: { trigger: 'manual', descriptionImpliesAgentRequested: true },
    linkPatterns: STANDARD_LINKS,
  },
  {
    id: 'cursorrules' as const,
    label: '.cursorrules',
    icon: 'cursor',
    docsUrl: 'https://cursor.com/docs/rules',
    // Legacy standalone file — superseded by .cursor/rules/
    writable: false,
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
    id: 'windsurf-rules' as const,
    label: 'Windsurf Rules',
    icon: 'windsurf',
    docsUrl: 'https://docs.windsurf.com/windsurf/cascade/memories',
    validPaths: ['.windsurf/rules'],
    validNames: ['*'],
    validExtensions: ['.md'],
    isHierarchical: false,
    frontmatterFields: [
      {
        name: 'trigger',
        type: 'string',
        mapsTo: 'trigger',
        valueMap: {
          always_on: 'always',
          glob: 'glob',
          model_decision: 'agent_requested',
          manual: 'manual',
        },
        writeValueMap: {
          always: 'always_on',
          glob: 'glob',
          agent_requested: 'model_decision',
          manual: 'manual',
        },
      },
      { name: 'globs', type: 'string[]', mapsTo: 'globs', emitWhen: ['glob'] },
      { name: 'description', type: 'string', mapsTo: 'description', emitWhen: ['agent_requested'] },
    ],
    defaults: { trigger: 'always' },
    linkPatterns: STANDARD_LINKS,
  },
  {
    id: 'windsurfrules' as const,
    label: '.windsurfrules',
    icon: 'windsurf',
    docsUrl: 'https://docs.windsurf.com/windsurf/cascade/memories',
    // Legacy standalone file — superseded by .windsurf/rules/
    writable: false,
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
    id: 'kiro' as const,
    label: 'Kiro',
    icon: 'kiro',
    docsUrl: 'https://kiro.dev/docs/steering/',
    validPaths: ['.kiro/steering', '.kiro/specs'],
    validNames: ['*'],
    validExtensions: ['.md'],
    isHierarchical: false,
    frontmatterFields: [
      {
        name: 'inclusion',
        type: 'string',
        mapsTo: 'trigger',
        valueMap: {
          always: 'always',
          fileMatch: 'glob',
          auto: 'agent_requested',
          manual: 'manual',
        },
        writeValueMap: {
          always: 'always',
          glob: 'fileMatch',
          agent_requested: 'auto',
          manual: 'manual',
        },
      },
      { name: 'fileMatchPattern', type: 'string[]', mapsTo: 'globs', emitWhen: ['glob'] },
      { name: 'name', type: 'string', mapsTo: 'description', emitWhen: ['agent_requested'] },
      { name: 'description', type: 'string', mapsTo: 'description', emitWhen: ['agent_requested'] },
    ],
    defaults: { trigger: 'always' }, // overridden per-directory in classifier
    linkPatterns: STANDARD_LINKS,
  },
  // ── Antigravity ──
  {
    id: 'antigravity' as const,
    label: 'Antigravity',
    icon: 'antigravity',
    docsUrl: 'https://antigravity.google/docs/rules-workflows',
    validPaths: ['.agents/rules', '.agent/rules'],
    validNames: ['*'],
    validExtensions: ['.md'],
    isHierarchical: false,
    frontmatterFields: [
      {
        name: 'trigger',
        type: 'string',
        mapsTo: 'trigger',
        valueMap: {
          always_on: 'always',
          glob: 'glob',
          model_decision: 'agent_requested',
          manual: 'manual',
        },
        writeValueMap: {
          always: 'always_on',
          glob: 'glob',
          agent_requested: 'model_decision',
          manual: 'manual',
        },
      },
      { name: 'globs', type: 'string[]', mapsTo: 'globs', emitWhen: ['glob'] },
      { name: 'description', type: 'string', mapsTo: 'description', emitWhen: ['agent_requested'] },
    ],
    defaults: { trigger: 'always' },
    linkPatterns: STANDARD_LINKS,
  },
  // ── Augment ──
  {
    id: 'augment-rules' as const,
    label: 'Augment Rules',
    icon: 'augment',
    docsUrl: 'https://docs.augmentcode.com/setup-augment/guidelines',
    validPaths: ['.augment/rules'],
    validNames: ['*'],
    validExtensions: ['.md'],
    isHierarchical: false,
    frontmatterFields: [
      {
        name: 'type',
        type: 'string',
        mapsTo: 'trigger',
        valueMap: { always_apply: 'always', agent_requested: 'agent_requested', manual: 'manual' },
        writeValueMap: {
          always: 'always_apply',
          agent_requested: 'agent_requested',
          glob: 'manual',
          manual: 'manual',
        },
      },
      { name: 'description', type: 'string', mapsTo: 'description', emitWhen: ['agent_requested'] },
    ],
    defaults: { trigger: 'always' },
    linkPatterns: STANDARD_LINKS,
  },
  {
    id: 'augment-guidelines' as const,
    label: '.augment-guidelines',
    icon: 'augment',
    docsUrl: 'https://docs.augmentcode.com/setup-augment/guidelines',
    // Legacy standalone file — superseded by .augment/rules/
    writable: false,
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
    id: 'claude-rules' as const,
    label: 'Claude Code Rules',
    icon: 'claude-code',
    docsUrl: 'https://code.claude.com/docs/en/memory',
    validPaths: ['.claude/rules'],
    validNames: ['*'],
    validExtensions: ['.md'],
    isHierarchical: false,
    frontmatterFields: [{ name: 'paths', type: 'string[]', mapsTo: 'globs', emitWhen: ['glob'] }],
    defaults: { trigger: 'always' },
    linkPatterns: STANDARD_LINKS,
  },
  {
    id: 'claude-local' as const,
    label: 'CLAUDE.local.md',
    icon: 'claude-code',
    docsUrl: 'https://code.claude.com/docs/en/memory',
    // Personal gitignored override file — not a conversion target
    writable: false,
    validPaths: ['.'],
    validNames: ['CLAUDE.local.md'],
    validExtensions: ['.md'],
    isHierarchical: false,
    appendOnConflict: true,
    frontmatterFields: [],
    defaults: { trigger: 'always' },
    linkPatterns: STANDARD_LINKS,
  },
  // ── CLAUDE.md (cross-agent hierarchical) ──
  {
    id: 'claude-md' as const,
    label: 'CLAUDE.md',
    icon: 'claude-code',
    docsUrl: 'https://code.claude.com/docs/en/memory',
    validPaths: ['**'],
    validNames: ['CLAUDE.md'],
    validExtensions: ['.md'],
    isHierarchical: true,
    appendOnConflict: true,
    frontmatterFields: [],
    defaults: { trigger: 'always' },
    linkPatterns: [...STANDARD_LINKS, AT_IMPORT],
  },
  // ── AGENTS.md (cross-agent hierarchical) ──
  {
    id: 'agents-md' as const,
    label: 'AGENTS.md',
    icon: 'agents-md',
    docsUrl: 'https://agents.md',
    validPaths: ['**'],
    validNames: ['AGENTS.md'],
    validExtensions: ['.md'],
    isHierarchical: true,
    appendOnConflict: true,
    frontmatterFields: [],
    defaults: { trigger: 'always' },
    linkPatterns: STANDARD_LINKS,
  },
  // ── Document (promoted via reference, never discovered) ──
  {
    id: 'document' as const,
    label: 'Document',
    icon: 'document',
    discoverable: false,
    validPaths: [],
    validNames: [],
    validExtensions: ['.md'],
    isHierarchical: false,
    frontmatterFields: [],
    defaults: { trigger: 'always' },
    linkPatterns: STANDARD_LINKS,
  },
] satisfies FormatDefinition[];

/** Union of all registered format IDs — derived from the registry, single source of truth */
export type RuleFormat = (typeof _definitions)[number]['id'];

/** All format definitions, typed as FormatDefinition[] for general use */
export const FORMAT_DEFINITIONS: FormatDefinition[] = _definitions;

/** Human-readable labels for each format */
export const FORMAT_LABELS = Object.fromEntries(
  FORMAT_DEFINITIONS.map((d) => [d.id, d.label]),
) as Record<RuleFormat, string>;

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
