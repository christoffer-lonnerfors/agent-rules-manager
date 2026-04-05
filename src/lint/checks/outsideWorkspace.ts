import * as vscode from 'vscode';
import * as path from 'path';
import { RuleIssue } from '../ruleIssues';
import { LintCheck } from '../lintCheck';

/**
 * Checks that file references don't escape the workspace boundary.
 * References pointing outside the workspace won't work for other
 * users who clone the repository.
 */
export const outsideWorkspace: LintCheck = {
  name: 'outside-workspace',
  category: 'lint',

  run(lr) {
    const issues: RuleIssue[] = [];
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) { return []; }

    for (const rule of lr.rules) {
      if (rule.references.length === 0) { continue; }
      const ruleDir = path.dirname(rule.filePath);

      for (const ref of rule.references) {
        const resolved = path.resolve(ruleDir, ref);
        if (!resolved.startsWith(workspaceRoot + path.sep)) {
          issues.push({
            id: 'outside-workspace',
            severity: 'warning',
            message: `Reference points outside workspace: ${ref}`,
            ruleId: rule.id,
          });
        }
      }
    }

    return issues;
  },
};
