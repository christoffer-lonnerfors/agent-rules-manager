import { RuleFormat } from '../formats/formatRegistry';

// ── Agent concept ──────────────────────────────────────────────────────

/** Definition for a single AI agent */
export interface AgentDefinition {
  /** Agent identifier */
  id: string;
  /** Human-readable label (used in UI) */
  label: string;
  /** Agent-specific format(s) where new rules are written by default */
  primaryFormats: RuleFormat[];
  /** Cross-agent formats this agent also reads at runtime */
  supportedFormats: RuleFormat[];
}
