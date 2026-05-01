import { FileLintCheck } from '../lintCheck';

export const globMissingPatterns: FileLintCheck = {
  id: 'glob-missing-patterns',
  name: 'glob-missing-patterns',
  category: 'lint',
  applicableFormats: '*',

  run(file) {
    if (file.trigger !== 'glob') {
      return [];
    }
    if (!file.globs || file.globs.length === 0) {
      return [
        {
          id: 'glob-missing-patterns',
          severity: 'error',
          message:
            'Rule is set to glob trigger but has no patterns — it will be treated as always-on',
        },
      ];
    }
    return [];
  },
};
