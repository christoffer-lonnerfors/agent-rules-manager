# AI Agent Rule Format Specifications

Reference specification for parsing, writing, and converting between agent rule formats.

---

## 1. Cursor

> **Source:** [Rules | Cursor Docs](https://cursor.com/docs/rules)

### Storage
| Property | Value |
|---|---|
| **Directory** | `.cursor/rules/` |
| **File extensions** | `.mdc` (primary), `.md` (also supported) |
| **Scanning** | Recursive — all `.mdc` and `.md` files under `.cursor/rules/` are discovered |

### Frontmatter
YAML frontmatter delimited by `---`. All fields are optional.

| Field | Type | Description |
|---|---|---|
| `alwaysApply` | `boolean` | If `true`, rule is always injected into context |
| `globs` | `string[]` | File glob patterns that scope when this rule is applied |
| `description` | `string` | Human-readable description; used as context hint for the model |

```yaml
---
alwaysApply: false
globs:
  - "**/*.ts"
  - "**/*.tsx"
description: "TypeScript coding standards"
---
```

### `AGENTS.md` Support
Cursor also discovers `AGENTS.md` files as a rule source (plain Markdown, no frontmatter).

| Property | Value |
|---|---|
| **Filename** | `AGENTS.md` |
| **Locations** | Project root and any subdirectory (nested) |
| **Frontmatter** | None — plain Markdown content only |
| **Behaviour** | Instructions from nested `AGENTS.md` files are combined with parent directories; more-specific files take precedence |

> **Note:** `AGENTS.md` is a read/discovery source only. When converting *to* Cursor, rules are always written to `.cursor/rules/` with `.mdc` frontmatter — not as `AGENTS.md` files.

### Behaviour Notes
- When `alwaysApply: true`, `globs` and `description` are typically omitted.
- When `alwaysApply: false` and `globs` is populated, the rule applies only to matching files.
- When neither is set, the rule is applied on `manual` invocation (via `@rule-name` in chat).
- The `.mdc` extension is Cursor-specific; `.md` is also valid and treated identically.
- Subdirectory structure under `.cursor/rules/` is preserved in the rule name (e.g. `subfolder/my-rule`).

---

## 2. Windsurf

> **Source:** [Cascade Memories — Rules | Windsurf Docs](https://docs.windsurf.com/windsurf/cascade/memories)

### Storage
| Property | Value |
|---|---|
| **Directory (modular rules)** | `.windsurf/rules/` |
| **File extension** | `.md` |
| **Global rule file** | `.windsurfrules` (single flat file at workspace root) |
| **Scanning** | Recursive under `.windsurf/rules/`; plus root-level `.windsurfrules` if present |

### Frontmatter
YAML frontmatter delimited by `---`. The `trigger` field is the primary control mechanism.

| Field | Type | Values / Description |
|---|---|---|
| `trigger` | `string` (enum) | `always_on` · `glob` · `model_decision` · `manual` |
| `globs` | `string[]` | Required when `trigger: glob`; defines file scope |
| `description` | `string` | Required when `trigger: model_decision`; guides model on when to apply |

```yaml
---
trigger: glob
globs:
  - "**/*.ts"
---
```

```yaml
---
trigger: always_on
---
```

### Behaviour Notes
- `trigger` is the single field that controls activation mode — there is no boolean flag like Cursor's `alwaysApply`.
- The `.windsurfrules` root file is a global rule with no frontmatter convention (treated as always-on, plain content).
- Windsurf and Antigravity share an **identical frontmatter schema**; they differ only in directory path.

---

## 3. Kiro

> **Source:** [Steering | Kiro Docs](https://kiro.dev/docs/steering/)

### Storage
| Property | Value |
|---|---|
| **Steering directory** | `.kiro/steering/` |
| **Specs directory** | `.kiro/specs/` |
| **File extension** | `.md` |
| **Scanning** | Recursive under both `.kiro/steering/` and `.kiro/specs/` |

### Frontmatter
YAML frontmatter delimited by `---`. Kiro uses `inclusion` as its primary control field.

| Field | Type | Values / Description |
|---|---|---|
| `inclusion` | `string` (enum) | `always` · `fileMatch` · `manual` |
| `fileMatchPattern` | `string` or `string[]` | Used when `inclusion: fileMatch`; single string if one pattern, array if multiple |
| `description` | `string` | Optional; used alongside `fileMatch` inclusion |

```yaml
---
inclusion: always
---
```

```yaml
---
inclusion: fileMatch
fileMatchPattern: "**/*.ts"
description: "TypeScript rules"
---
```

```yaml
---
inclusion: manual
---
```

### Behaviour Notes
- **Kiro is the only format that uses directory structure to encode rule type:**
  - `.kiro/steering/` → always-on rules; default `inclusion: always`
  - `.kiro/specs/` → manual/structured specification files; default `inclusion: manual`
- When scanning, the extension injects a default `inclusion` value based on which subdirectory the file was found in, even if no frontmatter is present.
- When **writing** (converting to Kiro):
  - `alwaysApply: true` or `inclusion: always` → written to `.kiro/steering/` with `inclusion: always`
  - `globs` present → written to `.kiro/steering/` with `inclusion: fileMatch` and `fileMatchPattern`
  - No trigger → written to `.kiro/specs/` with `inclusion: manual`
- `fileMatchPattern` may be a single string (one glob) or an array (multiple globs).

---

## 4. Antigravity

> **Source:** [Rules / Workflows | Google Antigravity Docs](https://antigravity.google/docs/rules-workflows)

### Storage
| Property | Value |
|---|---|
| **Directory** | `.agent/rules/` |
| **File extension** | `.md` |
| **Scanning** | Recursive under `.agent/rules/` |

### Frontmatter
Identical schema to Windsurf. YAML frontmatter delimited by `---`.

| Field | Type | Values / Description |
|---|---|---|
| `trigger` | `string` (enum) | `always_on` · `glob` · `model_decision` · `manual` |
| `globs` | `string[]` | Required when `trigger: glob` |
| `description` | `string` | Required when `trigger: model_decision` |

```yaml
---
trigger: always_on
---
```

### Behaviour Notes
- Functionally identical to Windsurf in terms of frontmatter and trigger logic.
- The converter handles Windsurf and Antigravity in the same code branch, branching only on the output directory.

---

## 5. Augment

> **Source:** [Rules & Guidelines | Augment Code Docs](https://docs.augmentcode.com/setup-augment/guidelines)

### Storage
| Property | Value |
|---|---|
| **Rules directory** | `.augment/rules/` |
| **File extension** | `.md` |
| **User-level rules** | `~/.augment/rules/` |
| **Legacy guideline file** | `.augment-guidelines` (single file at workspace root, legacy) |
| **Scanning** | Recursive under `.augment/rules/`; plus `AGENTS.md` / `CLAUDE.md` hierarchically |

### Frontmatter
YAML frontmatter delimited by `---`. Optional — defaults to `always_apply` if absent.

| Field | Type | Values / Description |
|---|---|---|
| `type` | `string` (enum) | `always_apply` · `agent_requested` · `manual` |
| `description` | `string` | Required when `type: agent_requested`; guides model on when to apply |

```yaml
---
type: always_apply
---
```

```yaml
---
type: agent_requested
description: "React component development patterns and best practices"
---
```

### `CLAUDE.md` Hierarchical Support
Augment discovers `CLAUDE.md` files placed in subdirectories as hierarchical rules.

| Property | Value |
|---|---|
| **Filenames** | `CLAUDE.md` |
| **Locations** | Workspace root and any subdirectory (nested) |
| **Frontmatter** | None — plain Markdown content only |
| **Behaviour** | Walks up directory tree from the file being edited; all discovered files are included in context |

> **Note:** `AGENTS.md` is treated as a separate cross-agent format (see section 7). Augment reads it at runtime but it is indexed under the `agents-md` format.

### Behaviour Notes
- **`always_apply`** (default): Rule contents are automatically included in every prompt.
- **`agent_requested`** (also called "Auto" in IDE): Agent automatically detects and attaches the rule based on the `description` field when relevant.
- **`manual`**: Rule must be explicitly attached via `@` mention in chat. **IDE-only** — not supported in the CLI; CLI treats all workspace rules as `always_apply`.
- **No glob/path-based scoping** — Augment does not support file-pattern triggers. Rules are either always-on, model-decided, or manual.
- User rules (`~/.augment/rules/`) are always treated as `always_apply` regardless of frontmatter.
- `.augment-guidelines` is a legacy format; Augment auto-imports it as rules.
- Augment also auto-imports rules from other agents (`.md`, `.mdx` files detected in workspace).

---

## 6. Claude Code

> **Source:** [Memory — CLAUDE.md | Anthropic Docs](https://docs.anthropic.com/en/docs/claude-code/memory)

### Storage
| Property | Value |
|---|---|
| **Primary instruction file** | `CLAUDE.md` |
| **Rules directory** | `.claude/rules/` |
| **File extension** | `.md` |
| **User-level instruction file** | `~/.claude/CLAUDE.md` |
| **User-level rules** | `~/.claude/rules/` |
| **Private instruction file** | `CLAUDE.local.md` (gitignored, at project root) |
| **Scanning** | Recursive under `.claude/rules/`; `CLAUDE.md` discovered by walking up the directory tree from CWD |

### Instruction Files (`CLAUDE.md`)
`CLAUDE.md` is the primary project instruction file. It is plain Markdown with no frontmatter.

| Property | Value |
|---|---|
| **Filename** | `CLAUDE.md` |
| **Locations** | Project root, `.claude/CLAUDE.md`, any subdirectory, `~/.claude/CLAUDE.md` (user-level) |
| **Frontmatter** | None — plain Markdown content only |
| **Loading** | Walks up directory tree from CWD; ancestor files loaded at launch, subdirectory files loaded lazily when Claude reads files there |

Additional variants:
- `CLAUDE.local.md` — private, gitignored, loaded alongside `CLAUDE.md`
- Managed policy `CLAUDE.md` — deployed at system level (e.g. `/etc/claude-code/CLAUDE.md` on Linux), cannot be excluded

> **Note:** `CLAUDE.md` is a read/discovery source. When converting *to* Claude Code, rules are written to `.claude/rules/` as `.md` files — not as `CLAUDE.md`.

### Rules Frontmatter (`.claude/rules/`)
YAML frontmatter delimited by `---`. Optional — files without frontmatter are treated as unconditionally loaded.

| Field | Type | Description |
|---|---|---|
| `paths` | `string[]` | Glob patterns scoping when this rule is applied; if absent, rule loads unconditionally |

```yaml
---
paths:
  - "src/api/**/*.ts"
---
```

Rules without a `paths` field are loaded at launch with the same priority as `.claude/CLAUDE.md`.
Path-scoped rules trigger when Claude reads files matching the pattern.

### Behaviour Notes
- Claude Code has no `trigger` enum or `alwaysApply` boolean — rules are either unconditional (no `paths`) or path-scoped (`paths` present).
- There is no "model decides" mode or "manual" invocation mode for rules (those concepts map to Skills, which are out of scope).
- `CLAUDE.md` files in subdirectories are scoped to that directory's contents (similar to Cursor's `AGENTS.md` hierarchy).
- User-level rules (`~/.claude/rules/`) load before project rules; project rules have higher priority.
- HTML comments (`<!-- ... -->`) in `CLAUDE.md` are stripped before injection into context.
- Supports symlinks in `.claude/rules/`; circular symlinks are detected and handled gracefully.
- Supports `@path` imports within `CLAUDE.md` to reference additional files.

---

## 7. AGENTS.md (Cross-Agent)

> **Source:** [AGENTS.md](https://agents.md) — shared convention supported by [Cursor](https://cursor.com/docs/rules), [Augment](https://docs.augmentcode.com/setup-augment/guidelines), and others.

### Storage
| Property | Value |
|---|---|
| **Filenames** | `AGENTS.md` |
| **Locations** | Workspace root and any subdirectory (nested/hierarchical) |
| **File extensions** | `.md` |
| **Directories** | None — files are placed directly in directories to scope them |

### Frontmatter
None — plain Markdown content only. No YAML frontmatter is expected or supported.

### Behaviour Notes
- `AGENTS.md` is a cross-agent convention for providing instructions to AI agents.
- Files are scoped by their directory placement: an `AGENTS.md` in `src/` applies to files in `src/` and its subdirectories.
- Multiple agents read `AGENTS.md` at runtime (Cursor, Augment, and potentially others).
- This is the most portable rule format — write once, works across multiple agents.
- No structured trigger types — rules are always included based on directory hierarchy.

---

## Cross-Format Mapping

The converter normalises all formats through a shared intermediate representation before writing to a target format.

### Intermediate (normalised) fields

| Field | Type | Description |
|---|---|---|
| `alwaysApply` | `boolean` | True if the rule should always be injected |
| `globs` | `string[]` | File patterns scoping the rule |
| `description` | `string` | Human-readable hint |

### Trigger equivalence table

| Concept | Cursor | Windsurf / Antigravity | Kiro | Augment | Claude Code | AGENTS.md |
|---|---|---|---|---|---|---|
| Always active | `alwaysApply: true` | `trigger: always_on` | `inclusion: always` (in `steering/`) | `type: always_apply` | No `paths` field (unconditional) | *(default — scoped by directory)* |
| File-scoped | `globs: [...]` | `trigger: glob` + `globs: [...]` | `inclusion: fileMatch` + `fileMatchPattern` | — (not supported) | `paths: [...]` | *(directory placement)* |
| Model decides | `description: "..."` | `trigger: model_decision` + `description` | — (no direct equivalent) | `type: agent_requested` + `description` | — (no direct equivalent) | — (not supported) |
| Manual only | *(no flags set)* | `trigger: manual` | `inclusion: manual` (in `specs/`) | `type: manual` (IDE only) | — (uses Skills, out of scope) | — (not supported) |

### Glob field name mapping

| Format | Glob field name | Type |
|---|---|---|
| Cursor | `globs` | `string[]` |
| Windsurf | `globs` | `string[]` |
| Antigravity | `globs` | `string[]` |
| Kiro | `fileMatchPattern` | `string` or `string[]` |
| Augment | — | *(no glob support)* |
| Claude Code | `paths` | `string[]` |
| AGENTS.md | — | *(directory placement, no globs)* |

---

## Frontmatter Parsing Notes

- All formats use YAML between `---` delimiters (both CRLF and LF line endings supported).
- Glob patterns containing `*`, `?`, or `[...]` must be quoted in YAML to avoid parse errors (e.g. `"**/*.ts"` not `**/*.ts`).
- If frontmatter is absent or malformed, the file is still ingested with an empty metadata object and full raw content as body.
- Content body is everything after the closing `---`, trimmed of leading/trailing whitespace.

