import { FormatScanConfig } from './scannerTypes';

/**
 * All format scanning configurations.
 * Order matters for shared file disambiguation — formats listed first
 * are considered less specific for shared files.
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
    hierarchicalFiles: ['CLAUDE.md'],
  },
  {
    format: 'claude-code',
    directories: ['.claude/rules'],
    extensions: ['.md'],
    // CLAUDE.md is Claude Code's "main" hierarchical format
    standaloneFiles: ['CLAUDE.local.md'],
    hierarchicalFiles: ['CLAUDE.md'],
  },
  {
    format: 'agents-md',
    directories: [],
    extensions: ['.md'],
    standaloneFiles: [],
    // AGENTS.md is the cross-agent hierarchical format
    hierarchicalFiles: ['AGENTS.md'],
  },
];
