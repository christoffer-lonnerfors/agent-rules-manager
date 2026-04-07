import { LogicalRule } from '../logical/logicalRule';
import { RuleFormat } from '../formats/formatRegistry';
import { AgentId } from '../agents/agentConfig';
import { ClassifiedFile } from '../scanner/classifiedFile';
import { FileDiagnostic } from '../scanner/classifiedFile';
import { RuleIssue } from './ruleIssues';

/**
 * Configuration passed to every lint check.
 * Kept pure (no vscode.workspace dependency) so checks are testable.
 */
export interface LintConfig {
  /** User's chosen agent, or '' if none */
  agent: AgentId | '';
  /** Whether divergence detection is enabled */
  detectDivergence: boolean;
  /** Whether lint-category checks are enabled */
  lintEnabled: boolean;
  /** Token threshold for the rule-too-large check */
  maxRuleTokens: number;
}

/**
 * A file-level lint check that operates on a single ClassifiedFile.
 *
 * Runs during or immediately after classification.
 * Produces FileDiagnostic entries attached to the classified file.
 */
export interface FileLintCheck {
  /** Machine-readable check ID, e.g. 'empty-body' */
  id: string;

  /** Human-readable name for the check */
  name: string;

  /**
   * 'structural' checks always run.
   * 'lint' checks only run when config.lintEnabled is true.
   */
  category: 'structural' | 'lint';

  /**
   * Which formats this check applies to.
   * Use '*' to apply to all formats.
   */
  applicableFormats: RuleFormat[] | '*';

  /**
   * Run the check against a single classified file.
   */
  run(file: ClassifiedFile, config: LintConfig): FileDiagnostic[] | Promise<FileDiagnostic[]>;
}

/**
 * A cross-file lint check that operates on a LogicalRule (group of related files).
 *
 * Runs after all files are classified and grouped into logical rules.
 * Produces RuleIssue entries.
 */
export interface CrossFileLintCheck {
  /** Human-readable name for the check */
  name: string;

  /**
   * 'structural' checks always run (divergence, missing primary).
   * 'lint' checks only run when config.lintEnabled is true.
   */
  category: 'structural' | 'lint';

  /**
   * Which formats this check applies to.
   * The check runs if the logical rule has at least one file in a matching format.
   * Use '*' to apply to all logical rules.
   */
  applicableFormats: RuleFormat[] | '*';

  /**
   * Run the check against a logical rule.
   * Returns an array of issues found (empty array = all good).
   */
  run(lr: LogicalRule, config: LintConfig): RuleIssue[] | Promise<RuleIssue[]>;
}

/**
 * Legacy alias — existing checks that haven't been migrated yet.
 * @deprecated Use FileLintCheck or CrossFileLintCheck instead.
 */
export interface LintCheck {
  name: string;
  category: 'structural' | 'lint';
  run(lr: LogicalRule, config: LintConfig): RuleIssue[] | Promise<RuleIssue[]>;
}
