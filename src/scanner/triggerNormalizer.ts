import * as path from 'path';
import { RuleFormat, RuleTrigger, RuleSourceType } from './scannerTypes';
import { deriveGlobFromHierarchicalPath } from '../utils/scopeTranslator';

/**
 * Normalizes format-specific trigger/activation fields into the common RuleTrigger enum.
 *
 * @param format - The detected rule format
 * @param fields - Parsed frontmatter fields
 * @param filePath - Absolute file path (needed for Kiro directory-based defaults)
 * @param sourceType - How the file was discovered
 * @param workspaceRoot - Workspace root path
 */
export function normalizeTrigger(
  format: RuleFormat,
  fields: Record<string, unknown>,
  filePath: string,
  sourceType: RuleSourceType,
  workspaceRoot: string
): { trigger: RuleTrigger; globs: string[] | undefined; description: string | undefined } {
  // Standalone files are always-on by nature
  if (sourceType === 'standalone_file') {
    return {
      trigger: 'always',
      globs: undefined,
      description: typeof fields.description === 'string' ? fields.description : undefined,
    };
  }

  // Hierarchical MDs: root-level = always-on, subdirectory = implicitly scoped
  if (sourceType === 'hierarchical_md') {
    const description = typeof fields.description === 'string' ? fields.description : undefined;
    const implicitGlob = deriveGlobFromHierarchicalPath(filePath, workspaceRoot);
    if (implicitGlob) {
      return { trigger: 'glob', globs: [implicitGlob], description };
    }
    return { trigger: 'always', globs: undefined, description };
  }

  switch (format) {
    case 'cursor':
      return normalizeCursor(fields);
    case 'windsurf':
    case 'antigravity':
      return normalizeWindsurfAntigravity(fields);
    case 'kiro':
      return normalizeKiro(fields, filePath, workspaceRoot);
    case 'augment':
      return normalizeAugment(fields);
    case 'claude-code':
      return normalizeClaudeCode(fields);
    default:
      return { trigger: 'always', globs: undefined, description: undefined };
  }
}

function normalizeCursor(fields: Record<string, unknown>): ReturnType<typeof normalizeTrigger> {
  const description = typeof fields.description === 'string' ? fields.description : undefined;
  const globs = normalizeGlobsField(fields.globs);

  if (fields.alwaysApply === true) {
    return { trigger: 'always', globs: undefined, description };
  }
  if (globs && globs.length > 0) {
    return { trigger: 'glob', globs, description };
  }
  if (description) {
    return { trigger: 'agent_requested', globs: undefined, description };
  }
  return { trigger: 'manual', globs: undefined, description };
}

function normalizeWindsurfAntigravity(fields: Record<string, unknown>): ReturnType<typeof normalizeTrigger> {
  const description = typeof fields.description === 'string' ? fields.description : undefined;
  const globs = normalizeGlobsField(fields.globs);

  switch (fields.trigger) {
    case 'always_on':
      return { trigger: 'always', globs: undefined, description };
    case 'glob':
      return { trigger: 'glob', globs, description };
    case 'model_decision':
      return { trigger: 'agent_requested', globs: undefined, description };
    case 'manual':
      return { trigger: 'manual', globs: undefined, description };
    default:
      return { trigger: 'always', globs: undefined, description };
  }
}

function normalizeKiro(
  fields: Record<string, unknown>,
  filePath: string,
  workspaceRoot: string
): ReturnType<typeof normalizeTrigger> {
  const description = typeof fields.description === 'string' ? fields.description : undefined;
  const relativePath = path.relative(workspaceRoot, filePath).split(path.sep).join('/');

  // Kiro uses directory structure to encode defaults
  const isSteeringDir = relativePath.startsWith('.kiro/steering/');

  const inclusion = fields.inclusion as string | undefined;
  const fileMatchPattern = fields.fileMatchPattern;
  const globs = normalizeGlobsField(fileMatchPattern);

  switch (inclusion) {
    case 'always':
      return { trigger: 'always', globs: undefined, description };
    case 'fileMatch':
      return { trigger: 'glob', globs, description };
    case 'auto':
      return { trigger: 'agent_requested', globs: undefined, description };
    case 'manual':
      return { trigger: 'manual', globs: undefined, description };
    default:
      // Default based on directory
      return {
        trigger: isSteeringDir ? 'always' : 'manual',
        globs: undefined,
        description,
      };
  }
}

function normalizeAugment(fields: Record<string, unknown>): ReturnType<typeof normalizeTrigger> {
  const description = typeof fields.description === 'string' ? fields.description : undefined;

  switch (fields.type) {
    case 'always_apply':
      return { trigger: 'always', globs: undefined, description };
    case 'agent_requested':
      return { trigger: 'agent_requested', globs: undefined, description };
    case 'manual':
      return { trigger: 'manual', globs: undefined, description };
    default:
      // Augment defaults to always_apply if absent
      return { trigger: 'always', globs: undefined, description };
  }
}

function normalizeClaudeCode(fields: Record<string, unknown>): ReturnType<typeof normalizeTrigger> {
  const globs = normalizeGlobsField(fields.paths);

  if (globs && globs.length > 0) {
    return { trigger: 'glob', globs, description: undefined };
  }
  // No paths = unconditional
  return { trigger: 'always', globs: undefined, description: undefined };
}

/** Normalize a glob field to string[] regardless of input shape */
function normalizeGlobsField(value: unknown): string[] | undefined {
  if (!value) { return undefined; }
  if (typeof value === 'string') { return [value]; }
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  return undefined;
}

