import * as vscode from 'vscode';
import * as path from 'path';
import { RuleIssue } from '../ruleIssues';
import { LintCheck } from '../lintCheck';

/**
 * Checks that file references in rule bodies point to existing files.
 * Only checks references that resolve within the workspace (the
 * outsideWorkspace check handles the boundary check separately).
 */
export const brokenReference: LintCheck = {
  name: 'broken-reference',
  category: 'lint',

  async run(lr) {
    const issues: RuleIssue[] = [];
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    for (const rule of lr.rules) {
      if (rule.references.length === 0) {
        continue;
      }
      const ruleDir = path.dirname(rule.filePath);

      for (const ref of rule.references) {
        const resolved = path.resolve(ruleDir, ref);

        // Skip references outside the workspace — handled by outsideWorkspace check
        if (workspaceRoot && !resolved.startsWith(workspaceRoot + path.sep)) {
          continue;
        }

        const exists = await fileExists(vscode.Uri.file(resolved));
        if (!exists) {
          issues.push({
            id: 'broken-reference',
            severity: 'warning',
            message: `Referenced file not found: ${ref}`,
            ruleId: rule.id,
          });
        }
      }
    }

    return issues;
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
