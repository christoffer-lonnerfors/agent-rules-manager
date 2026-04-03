import * as path from 'path';
import { FormatScanConfig, RuleFormat } from './scannerTypes';

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
    standaloneFiles: [],
    // AGENTS.md is supported by Cursor but it's not the "main" format for it
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
    directories: ['.agent/rules'],
    extensions: ['.md'],
    standaloneFiles: [],
    hierarchicalFiles: [],
  },
  {
    format: 'augment',
    directories: ['.augment/rules'],
    extensions: ['.md'],
    // AGENTS.md is Augment's "main" hierarchical format
    standaloneFiles: ['.augment-guidelines'],
    hierarchicalFiles: ['AGENTS.md', 'CLAUDE.md'],
  },
  {
    format: 'claude-code',
    directories: ['.claude/rules'],
    extensions: ['.md'],
    // CLAUDE.md is Claude Code's "main" hierarchical format
    standaloneFiles: ['CLAUDE.local.md'],
    hierarchicalFiles: ['CLAUDE.md'],
  },
];

/**
 * Determines the RuleFormat for a file based on its path relative to workspace root.
 * Returns undefined if the file doesn't match any known format.
 */
export function detectFormat(
  filePath: string,
  workspaceRoot: string
): { format: RuleFormat; sourceType: 'directory_rule' | 'standalone_file' | 'hierarchical_md' } | undefined {
  const relativePath = path.relative(workspaceRoot, filePath);
  const normalizedRelative = relativePath.split(path.sep).join('/');
  const fileName = path.basename(filePath);

  // Check directory rules first (most specific)
  for (const config of FORMAT_CONFIGS) {
    for (const dir of config.directories) {
      if (normalizedRelative.startsWith(dir + '/')) {
        const ext = path.extname(filePath).toLowerCase();
        if (config.extensions.includes(ext)) {
          return { format: config.format, sourceType: 'directory_rule' };
        }
      }
    }
  }

  // Check standalone files at root
  for (const config of FORMAT_CONFIGS) {
    for (const standaloneFile of config.standaloneFiles) {
      if (normalizedRelative === standaloneFile) {
        return { format: config.format, sourceType: 'standalone_file' };
      }
    }
  }

  // Check hierarchical MD files (case-insensitive) — last config to declare a file "wins"
  // Claude Code is listed after Augment, so it wins for CLAUDE.md (correct: it's the main format)
  const fileNameLower = fileName.toLowerCase();
  let hierarchicalMatch: { format: RuleFormat; sourceType: 'hierarchical_md' } | undefined;
  for (const config of FORMAT_CONFIGS) {
    if (config.hierarchicalFiles.some(hf => hf.toLowerCase() === fileNameLower)) {
      hierarchicalMatch = { format: config.format, sourceType: 'hierarchical_md' };
    }
  }

  return hierarchicalMatch;
}

