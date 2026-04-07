import { FormatDefinition } from './formatDefinition';
import { RuleTrigger } from '../types';
import { deriveGlobFromHierarchicalPath } from '../utils/scopeTranslator';

// ── Glob normalization ────────────────────────────────────────────────

function normalizeGlobs(value: unknown): string[] | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  return undefined;
}

// ── Trigger mapping ───────────────────────────────────────────────────

/**
 * Derive the normalized trigger, globs, and description for a classified file.
 *
 * Priority chain:
 *   1. Hierarchical files: scope derived from directory position
 *   2. Standalone files (validPaths=['.'], specific name): always-on
 *   3. Frontmatter trigger fields with valueMap
 *   4. Globs present without explicit trigger → glob
 *   5. descriptionImpliesAgentRequested convention (Cursor)
 *   6. Format default trigger
 */
export function mapTrigger(
  def: FormatDefinition,
  fields: Record<string, unknown>,
  filePath: string,
  workspaceRoot: string,
): { trigger: RuleTrigger; globs: string[] | undefined; description: string | undefined } {
  const descField = def.frontmatterFields.find((f) => f.mapsTo === 'description');
  const description =
    descField && typeof fields[descField.name] === 'string'
      ? (fields[descField.name] as string)
      : undefined;

  // Hierarchical files: scope derived from directory position
  if (def.isHierarchical) {
    const implicitGlob = deriveGlobFromHierarchicalPath(filePath, workspaceRoot);
    if (implicitGlob) {
      return { trigger: 'glob', globs: [implicitGlob], description };
    }
    return { trigger: 'always', globs: undefined, description };
  }

  // Standalone files (validPaths=['.'], specific name): always-on
  if (def.validPaths.includes('.') && def.validNames[0] !== '*') {
    return { trigger: 'always', globs: undefined, description };
  }

  // Try each frontmatter field that maps to 'trigger'
  for (const fieldDef of def.frontmatterFields) {
    if (fieldDef.mapsTo !== 'trigger' || !fieldDef.valueMap) {
      continue;
    }

    const rawValue = fields[fieldDef.name];
    if (rawValue === undefined) {
      continue;
    }

    // Boolean fields (e.g. alwaysApply: true)
    if (fieldDef.type === 'boolean' && typeof rawValue === 'boolean') {
      const mapped = fieldDef.valueMap[String(rawValue)];
      if (mapped) {
        return { trigger: mapped, globs: undefined, description };
      }
    }

    // String fields (e.g. trigger: 'always_on')
    if (fieldDef.type === 'string' && typeof rawValue === 'string') {
      const mapped = fieldDef.valueMap[rawValue];
      if (mapped) {
        // If trigger maps to 'glob', extract globs from the glob field
        if (mapped === 'glob') {
          const globField = def.frontmatterFields.find((f) => f.mapsTo === 'globs');
          const globs = globField ? normalizeGlobs(fields[globField.name]) : undefined;
          return { trigger: 'glob', globs, description };
        }
        return { trigger: mapped, globs: undefined, description };
      }
    }
  }

  // Check if globs are present without an explicit trigger
  const globField = def.frontmatterFields.find((f) => f.mapsTo === 'globs');
  if (globField) {
    const globs = normalizeGlobs(fields[globField.name]);
    if (globs && globs.length > 0) {
      return { trigger: 'glob', globs, description };
    }
  }

  // descriptionImpliesAgentRequested (Cursor convention)
  if (def.defaults.descriptionImpliesAgentRequested && description) {
    return { trigger: 'agent_requested', globs: undefined, description };
  }

  return { trigger: def.defaults.trigger, globs: undefined, description };
}
