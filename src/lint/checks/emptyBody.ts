import { FileLintCheck } from '../lintCheck';
import { FileDiagnostic } from '../../scanner/classifiedFile';

/**
 * Checks for rules with empty or near-empty body content.
 */
export const emptyBody: FileLintCheck = {
  id: 'empty-body',
  name: 'empty-body',
  category: 'lint',
  applicableFormats: '*',

  run(file) {
    const diagnostics: FileDiagnostic[] = [];
    if (file.bodyLength < 10) {
      diagnostics.push({
        id: 'empty-body',
        severity: 'warning',
        message: `Rule body is empty or near-empty (${file.bodyLength} chars)`,
      });
    }
    return diagnostics;
  },
};
