# Changelog

## 0.2.0

### New features

- Sidebar agent indicator and config panel for quick agent switching
- Actions panel with bulk operations and rules section
- Auto-register MCP server when switching to Cursor or Windsurf
- Welcome/onboarding panel replaces modal setup prompts
- Bundled rule-writing guidelines with one-click installer
- Coverage: `@import` token cost display, worst-case toggle, and disclaimer

### Fixes

- Rule index now persisted to disk instead of workspaceState (survives reloads)
- Content-Security-Policy meta tag added to all webviews
- Improved logical-rule grouping across formats

## 0.1.0

Initial release.

- Unified rules view across Cursor, Windsurf, Kiro, Antigravity, Augment, and Claude Code
- Cross-format support for AGENTS.md and CLAUDE.md
- Divergence detection with diff view and one-click align
- Sync, align, and batch-add missing rules across formats
- Rule creation with format-aware scaffolding
- Coverage analysis with token cost visualization and hotspot detection
- Rule linting (empty body, missing description, oversized rules, broken references, extension mismatches)
- Agent auto-detection from workspace rule files
