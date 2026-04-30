import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseFrontmatter } from '../scanner/frontmatterParser';
import { buildFrontmatter } from './ruleWriter';
import { AGENT_DEFINITIONS, AgentId, getEffectiveWriteFormat } from '../agents/agentRegistry';
import { FORMAT_DEFINITIONS } from '../formats/formatRegistry';
import { LogicalRule } from '../logical/logicalRule';

const META_RULE_DESCRIPTION = 'How to create, review, and optimize AI agent rule files';

/**
 * Install the bundled meta-rule into the user's agent rule folder(s).
 * If preselectedAgentId is provided, installs directly for that agent without showing a picker.
 * Otherwise presents a multi-select quick pick.
 * Returns the absolute paths of all files written (empty if cancelled or nothing written).
 */
export async function installMetaRule(
  extensionPath: string,
  preselectedAgentId?: AgentId,
  options?: { skipExisting?: boolean },
): Promise<string[]> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showWarningMessage('Agent Rules: Open a workspace folder first.');
    return [];
  }
  const workspaceRoot = workspaceFolders[0].uri.fsPath;

  // Read bundled meta-rule asset
  const assetPath = path.join(
    extensionPath,
    'resources',
    'meta-rule',
    'agent-rules-manager-meta-rule.mdc',
  );
  let assetContent: string;
  try {
    assetContent = fs.readFileSync(assetPath, 'utf-8');
  } catch {
    vscode.window.showErrorMessage('Agent Rules: Could not read bundled meta-rule asset.');
    return [];
  }
  const { body, fields } = parseFrontmatter(assetContent);

  // Derive rule shape from asset frontmatter so the asset is the single source of truth
  const assetDescription =
    typeof fields.description === 'string' ? fields.description : META_RULE_DESCRIPTION;
  const assetGlobs = Array.isArray(fields.globs) ? (fields.globs as string[]) : [];
  const assetAlwaysApply = fields.alwaysApply === true;

  // Build candidate list: one per agent, filtered to slug-based writable formats
  const candidates: Array<{ agentId: AgentId; label: string; description: string }> = [];
  for (const agent of AGENT_DEFINITIONS) {
    const formatId = getEffectiveWriteFormat(agent.id as AgentId, '');
    const formatDef = FORMAT_DEFINITIONS.find((d) => d.id === formatId);
    // Only include agents whose primary write format uses slug-based naming (validNames[0] === '*')
    if (!formatDef || formatDef.validNames[0] !== '*') continue;
    candidates.push({
      agentId: agent.id as AgentId,
      label: agent.label,
      description: formatDef.label,
    });
  }

  if (candidates.length === 0) {
    vscode.window.showWarningMessage('Agent Rules: No writable agent formats found.');
    return [];
  }

  // When called with a known agent, skip the picker
  let picked: Array<{ agentId: AgentId; label: string }>;
  if (preselectedAgentId) {
    const match = candidates.find((c) => c.agentId === preselectedAgentId);
    if (!match) return [];
    picked = [match];
  } else {
    const selection = await vscode.window.showQuickPick(
      candidates.map((c) => ({ ...c, label: c.label })),
      {
        canPickMany: true,
        placeHolder: 'Install rule-writing guidelines for…',
        title: 'Install Meta-Rule',
      },
    );
    if (!selection || selection.length === 0) return [];
    picked = selection;
  }

  const written: string[] = [];

  for (const item of picked) {
    const formatId = getEffectiveWriteFormat(item.agentId, '');
    const formatDef = FORMAT_DEFINITIONS.find((d) => d.id === formatId)!;

    // Use the first valid path as the target directory (e.g. '.kiro/steering' for kiro)
    const targetDir = path.join(workspaceRoot, formatDef.validPaths[0]);

    const trigger: LogicalRule['trigger'] = assetAlwaysApply
      ? 'always'
      : assetGlobs.length > 0
        ? 'glob'
        : 'agent_requested';

    // Build LogicalRule from asset frontmatter so buildFrontmatter produces correct output
    const syntheticRule: LogicalRule = {
      id: 'meta-rule',
      description: assetDescription,
      trigger,
      globs: trigger === 'glob' ? assetGlobs : [],
      formats: [formatId],
      rules: [],
      isDiverged: false,
      similarity: 1,
    };

    const frontmatter = buildFrontmatter(formatId, syntheticRule);
    const ext = formatDef.validExtensions[0] ?? '.md';
    const targetPath = path.join(targetDir, `agent-rules-manager-meta-rule${ext}`);

    if (fs.existsSync(targetPath)) {
      if (options?.skipExisting) continue;
      const answer = await vscode.window.showWarningMessage(
        `agent-rules-manager-meta-rule${ext} already exists for ${item.label}. Overwrite?`,
        { modal: true },
        'Overwrite',
      );
      if (answer !== 'Overwrite') continue;
    }

    try {
      fs.mkdirSync(targetDir, { recursive: true });
      const fileContent = frontmatter ? `---\n${frontmatter}---\n\n${body}\n` : `${body}\n`;
      fs.writeFileSync(targetPath, fileContent, 'utf-8');
      written.push(targetPath);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Agent Rules: Failed to write meta-rule for ${item.label}: ${String(err)}`,
      );
    }
  }

  if (written.length > 0) {
    const names = written.map((p) => path.relative(workspaceRoot, p)).join(', ');
    vscode.window.showInformationMessage(`Agent Rules: Installed meta-rule to: ${names}`);
  }

  return written;
}
