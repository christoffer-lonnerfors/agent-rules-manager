import { FileLintCheck } from '../lintCheck';

const BROAD_PATTERNS = new Set(['**', '**/*', '**/**']);

export const globTooBroad: FileLintCheck = {
  id: 'glob-too-broad',
  name: 'glob-too-broad',
  category: 'lint',
  applicableFormats: '*',

  run(file) {
    if (file.trigger !== 'glob' || !file.globs || file.globs.length === 0) {
      return [];
    }
    if (file.globs.some((g) => BROAD_PATTERNS.has(g))) {
      return [
        {
          id: 'glob-too-broad',
          severity: 'warning',
          message:
            'Glob pattern matches all files — use a more specific pattern or switch to always-on trigger',
        },
      ];
    }
    return [];
  },
};
