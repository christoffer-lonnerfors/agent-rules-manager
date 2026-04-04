import { FormatScanConfig } from './scannerTypes';

/**
 * All format scanning configurations.
 *
 * Each entry represents a distinct file convention — not an agent.
 * Cross-agent formats (AGENTS.md, CLAUDE.md) have their own entries;
 * the Agent concept (see scannerTypes.ts) maps agents to the formats they read.
 */
export const FORMAT_CONFIGS: FormatScanConfig[] = [
  {
    format: 'cursor',
    directories: ['.cursor/rules'],
    extensions: ['.mdc', '.md'],
    standaloneFiles: ['.cursorrules'],
    hierarchicalFiles: [],
  },
  {
    format: 'windsurf',
    directories: ['.windsurf/rules'],
    extensions: ['.md'],
    standaloneFiles: ['.windsurfrules'],
    hierarchicalFiles: [],
  },
  {
    format: 'kiro',
    directories: ['.kiro/steering', '.kiro/specs'],
    extensions: ['.md'],
    standaloneFiles: [],
    hierarchicalFiles: [],
  },
  {
    format: 'antigravity',
    directories: ['.agents/rules', '.agent/rules'],
    extensions: ['.md'],
    standaloneFiles: [],
    hierarchicalFiles: [],
  },
  {
    format: 'augment',
    directories: ['.augment/rules'],
    extensions: ['.md'],
    standaloneFiles: ['.augment-guidelines'],
    hierarchicalFiles: [],
  },
  {
    format: 'claude-code',
    directories: ['.claude/rules'],
    extensions: ['.md'],
    standaloneFiles: ['CLAUDE.local.md'],
    hierarchicalFiles: [],
  },
  {
    format: 'claude-md',
    directories: [],
    extensions: ['.md'],
    standaloneFiles: [],
    // CLAUDE.md is a cross-agent hierarchical format (read by Claude Code, Augment)
    hierarchicalFiles: ['CLAUDE.md'],
  },
  {
    format: 'agents-md',
    directories: [],
    extensions: ['.md'],
    standaloneFiles: [],
    // AGENTS.md is a cross-agent hierarchical format (read by Cursor, Augment, Claude Code)
    hierarchicalFiles: ['AGENTS.md'],
  },
];
