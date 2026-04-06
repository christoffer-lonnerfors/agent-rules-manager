/**
 * Atomic rule file formats — each represents exactly one file convention.
 *
 * Agents reference these via their primaryFormats / supportedFormats lists.
 * 'document' is a synthetic format for referenced files promoted during scanning.
 */
export type RuleFormat =
  // Cursor
  | 'cursor-rules' // .cursor/rules/*.mdc (rich frontmatter)
  | 'cursorrules' // .cursorrules (legacy standalone, always-on)
  // Windsurf
  | 'windsurf-rules' // .windsurf/rules/*.md (frontmatter with trigger)
  | 'windsurfrules' // .windsurfrules (legacy standalone)
  // Kiro
  | 'kiro' // .kiro/steering/*.md, .kiro/specs/*.md
  // Antigravity
  | 'antigravity' // .agents/rules/*.md, .agent/rules/*.md
  // Augment
  | 'augment-rules' // .augment/rules/*.md (frontmatter with type)
  | 'augment-guidelines' // .augment-guidelines (legacy standalone)
  // Claude Code
  | 'claude-rules' // .claude/rules/*.md (frontmatter with paths)
  | 'claude-local' // CLAUDE.local.md (standalone)
  // Cross-agent hierarchical
  | 'claude-md' // CLAUDE.md (any directory)
  | 'agents-md' // AGENTS.md (any directory)
  // Synthetic
  | 'document'; // Referenced files promoted during scanning

/** Human-readable labels for each format (used in UI and lint messages) */
export const FORMAT_LABELS: Record<RuleFormat, string> = {
  'cursor-rules': 'Cursor Rules',
  cursorrules: '.cursorrules',
  'windsurf-rules': 'Windsurf Rules',
  windsurfrules: '.windsurfrules',
  kiro: 'Kiro',
  antigravity: 'Antigravity',
  'augment-rules': 'Augment Rules',
  'augment-guidelines': '.augment-guidelines',
  'claude-rules': 'Claude Code Rules',
  'claude-local': 'CLAUDE.local.md',
  'claude-md': 'CLAUDE.md',
  'agents-md': 'AGENTS.md',
  document: 'Document',
};

/** Normalized activation trigger */
export type RuleTrigger = 'always' | 'glob' | 'agent_requested' | 'manual';
