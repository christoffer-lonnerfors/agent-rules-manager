import { RuleFormat } from '../formats/formatRegistry';

// ── Agent concept ──────────────────────────────────────────────────────

/** Definition for a single AI agent */
export interface AgentDefinition {
  /** Agent identifier */
  id: string;
  /** Human-readable label (used in UI) */
  label: string;
  /** The agent's native format — the default write target */
  primaryFormat: RuleFormat;
  /** Additional formats this agent reads: legacy backward-compat and cross-agent */
  supportedFormats: RuleFormat[];
  /** Whether this agent supports MCP tool registration */
  supportsMcp?: boolean;
  /** Two-character initials for the avatar badge in the UI (e.g. 'CU' for Cursor) */
  iconInitials: string;
}
