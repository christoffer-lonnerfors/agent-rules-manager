import * as vscode from 'vscode';
import * as path from 'path';
import { FileLintCheck } from '../lintCheck';
import { FileDiagnostic } from '../../scanner/classifiedFile';

/**
 * Checks that file references don't escape the workspace boundary.
 * References pointing outside the workspace won't work for other
 * users who clone the repository.
 */
export const outsideWorkspace: FileLintCheck = {
  id: 'outside-workspace',
  name: 'outside-workspace',
  category: 'lint',
  applicableFormats: '*',

  run(file) {
    const diagnostics: FileDiagnostic[] = [];
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
      return diagnostics;
    }

    if (file.links.length === 0) {
      return diagnostics;
    }

    const fileDir = path.dirname(file.filePath);

    for (const link of file.links) {
      if (link.patternId === 'backtick-path') {
        continue;
      }
      const resolved = path.resolve(fileDir, link.target);
      if (!resolved.startsWith(workspaceRoot + path.sep)) {
        diagnostics.push({
          id: 'outside-workspace',
          severity: 'warning',
          message: `Reference points outside workspace: ${link.target}`,
        });
      }
    }

    return diagnostics;
  },
};
