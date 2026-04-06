import { FORMAT_LABELS } from '../../types';
import { FORMAT_DEFINITIONS } from '../../scanner/formatRegistry';
import { FileLintCheck } from '../lintCheck';
import { FileDiagnostic } from '../../scanner/classifiedFile';

/**
 * Checks whether a file has the correct extension for its format.
 * Uses FormatDefinition.validExtensions as the source of truth.
 */
export const extensionMismatch: FileLintCheck = {
  id: 'extension-mismatch',
  name: 'extension-mismatch',
  category: 'structural',
  applicableFormats: '*',

  run(file) {
    const diagnostics: FileDiagnostic[] = [];
    const def = FORMAT_DEFINITIONS.find((d) => d.id === file.format);
    if (!def || def.validExtensions.length === 0) {
      return diagnostics;
    }

    if (!def.validExtensions.includes(file.fileExtension)) {
      const expected = def.validExtensions.join(' / ');
      diagnostics.push({
        id: 'extension-mismatch',
        severity: 'error',
        message: `Wrong file extension — ${FORMAT_LABELS[file.format]} expects ${expected}`,
      });
    }
    return diagnostics;
  },
};
