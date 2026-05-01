import * as vscode from 'vscode';
import { FileLintCheck } from '../lintCheck';
import { FileDiagnostic } from '../../scanner/classifiedFile';

export const globNoWorkspaceMatch: FileLintCheck = {
  id: 'glob-no-workspace-match',
  name: 'glob-no-workspace-match',
  category: 'lint',
  applicableFormats: '*',

  async run(file): Promise<FileDiagnostic[]> {
    if (file.trigger !== 'glob') {
      return [];
    }
    if (!file.globs || file.globs.length === 0) {
      // globMissingPatterns handles the empty case
      return [];
    }

    for (const glob of file.globs) {
      try {
        const matches = await vscode.workspace.findFiles(glob, null, 1);
        if (matches.length > 0) {
          return [];
        }
      } catch {
        // Malformed pattern — skip and continue checking remaining patterns
      }
    }

    const patternList = file.globs.map((g) => `"${g}"`).join(', ');
    const plural = file.globs.length > 1 ? 's' : '';
    return [
      {
        id: 'glob-no-workspace-match',
        severity: 'warning',
        message: `Glob pattern${plural} ${patternList} match no files in this workspace — rule will never load`,
      },
    ];
  },
};
