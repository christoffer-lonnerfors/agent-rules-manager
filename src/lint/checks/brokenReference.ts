import * as vscode from 'vscode';
import * as path from 'path';
import { FileLintCheck } from '../lintCheck';
import { FileDiagnostic } from '../../scanner/classifiedFile';

/**
 * Checks that file references in rule bodies point to existing files.
 * Only checks references that resolve within the workspace (the
 * outsideWorkspace check handles the boundary check separately).
 */
export const brokenReference: FileLintCheck = {
  id: 'broken-reference',
  name: 'broken-reference',
  category: 'lint',
  applicableFormats: '*',

  async run(file) {
    const diagnostics: FileDiagnostic[] = [];
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (file.links.length === 0) {
      return diagnostics;
    }

    const fileDir = path.dirname(file.filePath);

    for (const link of file.links) {
      const resolved = path.resolve(fileDir, link.target);

      // Skip references outside the workspace — handled by outsideWorkspace check
      if (workspaceRoot && !resolved.startsWith(workspaceRoot + path.sep)) {
        continue;
      }

      const exists = await fileExists(vscode.Uri.file(resolved));
      if (!exists) {
        diagnostics.push({
          id: 'broken-reference',
          severity: 'warning',
          message: `Referenced file not found: ${link.target}`,
        });
      }
    }

    return diagnostics;
  },
};

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}
