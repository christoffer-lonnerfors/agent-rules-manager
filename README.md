# Agent Rules Manager

Manage AI agent rules across Cursor, Windsurf, Kiro, Antigravity, Augment, and Claude Code — all from one place.

Every AI coding agent has its own rule format, stored in different directories with different frontmatter schemas. If you use more than one agent, or want to keep rules consistent across a team using several agents, you end up maintaining duplicate files that quietly drift apart. This extension consolidates all of them into a single view, detects divergence, and helps you keep everything in sync.

## Supported Agents & Formats

| Agent | Rule Format | Directory |
|---|---|---|
| Cursor | `.mdc` / `.md` + YAML frontmatter | `.cursor/rules/` |
| Windsurf | `.md` + YAML frontmatter | `.windsurf/rules/` |
| Kiro | `.md` + YAML frontmatter | `.kiro/steering/`, `.kiro/specs/` |
| Antigravity | `.md` + YAML frontmatter | `.agents/rules/` |
| Augment | `.md` + YAML frontmatter | `.augment/rules/` |
| Claude Code | `.md` + YAML frontmatter | `.claude/rules/` |
| CLAUDE.md | Plain Markdown (cross-agent) | Any directory |
| AGENTS.md | Plain Markdown (cross-agent) | Any directory |

## Features

### Unified Rules View

All rules from every format appear in one sidebar panel, grouped by logical rule. A rule that exists in both Cursor and Claude Code formats shows as a single entry with format badges.

<!-- TODO: screenshot of sidebar rules tree -->

### Divergence Detection

When the same rule exists in multiple formats, the extension compares content using MinHash similarity. Diverged rules are flagged with a warning badge. You can compare them side-by-side in a diff view and align content with one click.

<!-- TODO: screenshot of divergence indicator + diff view -->

### Sync & Align

Translate rules between formats automatically. The extension normalizes trigger types across the different schemas (Cursor's `alwaysApply`, Windsurf's `trigger`, Kiro's `inclusion`, etc.) and writes the correct frontmatter for each target format.

- **Compare Formats** — Opens a diff view between two versions of the same rule
- **Align Formats** — Updates the target format to match the source
- **Sync All Diverged** — Batch-aligns all diverged rules
- **Add Missing Rule** — Creates a rule in a format where it doesn't exist yet
- **Add All Missing** — Batch-creates all missing format variants

<!-- TODO: screenshot of align/sync action -->

### Rule Creation

Create new rules from the sidebar. Select your agent and preferred format, and the extension scaffolds the file with the correct frontmatter, directory, and file extension.

<!-- TODO: screenshot of create rule form -->

### Coverage Analysis

Visualize the token cost of your rules across your codebase. The coverage panel shows your project file tree color-coded by an estimated token cost when an agent works on each file.

- **Baseline cost** — Total tokens from always-on rules, present on every query
- **Glob-matched cost** — Additional tokens from rules scoped to specific file patterns
- **Hotspot detection** — Directories and files where many rules overlap, consuming context window budget
- **Severity thresholds** — Color-coded by percentage of context window used (configurable, default 128k)

<!-- TODO: screenshot of coverage analysis panel -->

### Linting

Basic rule quality checks, reported as diagnostics:

- Empty rule body
- Missing description (for agent-requested rules)
- Oversized rules (configurable token threshold)
- Broken file references
- Diverged content across formats
- Extension mismatches (e.g., `.mdc` file in a non-Cursor directory)
- Rules outside the workspace
- Missing primary format

### Agent Auto-Detection

The extension detects which agent(s) you're using based on existing rule files and directories in your workspace.

## Getting Started

1. Install the extension from the VS Code Marketplace
2. Open a project that contains AI agent rule files
3. Click the **Agent Rules** icon in the Activity Bar
4. Select your preferred agent in the Actions panel

Rules are discovered automatically. No configuration required to get started.

## Settings

| Setting | Default | Description |
|---|---|---|
| `agentRules.agent` | *(none)* | Your AI agent. Determines which formats are relevant and where new rules are written. |
| `agentRules.writeFormat` | *(agent default)* | Override the format used when creating new rules. |
| `agentRules.detectDivergence` | `true` | Show warning badges on rules that have diverged across formats. |
| `agentRules.lint.enabled` | `true` | Enable rule quality checks. |
| `agentRules.lint.maxRuleTokens` | `2000` | Warn when a single rule exceeds this estimated token count. |
| `agentRules.coverage.contextWindowTokens` | `128000` | Context window size used for coverage severity thresholds. |

## Known Limitations

- **Augment has no glob-based scoping** — Augment rules are either always-on, agent-requested, or manual. Coverage analysis for Augment users reflects this simpler model.
- **Coverage is a point-in-time snapshot** — The analysis does not live-update when rules change. Close and reopen the coverage panel to refresh.
- **Token estimates are approximate** — Token counts use a character-based heuristic (chars ÷ 3.5), not a model-specific tokenizer.

## License

[MIT](LICENSE)
