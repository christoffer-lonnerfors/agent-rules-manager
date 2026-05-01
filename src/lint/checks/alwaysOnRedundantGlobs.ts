import { FileLintCheck } from '../lintCheck';

export const alwaysOnRedundantGlobs: FileLintCheck = {
  id: 'always-on-redundant-globs',
  name: 'always-on-redundant-globs',
  category: 'lint',
  applicableFormats: '*',

  run(file) {
    if (file.trigger !== 'always') {
      return [];
    }
    if (file.globs && file.globs.length > 0) {
      return [
        {
          id: 'always-on-redundant-globs',
          severity: 'warning',
          message:
            'Rule is always-on but has glob patterns — the patterns are ignored by the agent',
        },
      ];
    }
    return [];
  },
};
