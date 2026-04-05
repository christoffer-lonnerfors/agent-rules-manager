import { LogicalRule } from '../types';
import { AgentId } from '../agents/agentConfig';
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
 * A single lint check that validates one concern.
 *
 * Each check:
 *   - Declares its category ('structural' runs always, 'lint' is gated)
 *   - Receives a LogicalRule + config
 *   - Returns zero or more RuleIssues (no mutation of shared state)
 */
export interface LintCheck {
  /** Human-readable name for the check (used for debugging / logging) */
  name: string;

  /**
   * 'structural' checks always run (divergence, missing primary, extension mismatch).
   * 'lint' checks only run when config.lintEnabled is true.
   */
  category: 'structural' | 'lint';

  /**
   * Run the check against a logical rule.
   * Returns an array of issues found (empty array = all good).
   */
  run(lr: LogicalRule, config: LintConfig): RuleIssue[] | Promise<RuleIssue[]>;
}
