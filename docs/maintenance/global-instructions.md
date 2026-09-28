# Global instructions and presentation

This repository has one canonical source for global behavior:
`core/instructions/global-operating-rules.md`. Adapters render that source for
Antigravity, Claude Code, and Codex. The source is reviewed in Git. The
generated files are not edited by hand.

## Two instruction layers

The global layer gives stable behavior for every repository. It covers
correctness, safety, scope, research, verification, and honest status reports.

The project and plugin layer is the more specific second layer. It gives repository commands,
local architecture, selected skills, project rules, hooks, and task details.
The nine core rules are not part of it: they belong to the global layer (see
below).
The more specific layer adds detail but must not weaken global safety rules.
Keep these files in the project or plugin layer:

- project `CLAUDE.md` and `AGENTS.md`;
- project rules, plugin skills, and agents;
- repository paths, test commands, and project-specific policy.

This is a two-layer model: global behavior first, then project or plugin
behavior. A project file does not replace the shared source.

## Surface-specific appendices

The shared source reaches every surface. Each surface may add an appendix at
render time, so a rendered global file is not always byte-identical to the
source:

| Section | Surfaces | Defined in |
| --- | --- | --- |
| `## RTK house rules (rust-token-killer)` | Antigravity, Claude Code, and Codex | `core/instructions/global-operating-rules.md` |
| `## egroup house rules (coding-guidelines)` | Claude Code only | `adapters/shared/global-instructions.mjs` |
| `# All About Agents for Codex` | Codex only | `adapters/shared/global-instructions.mjs` |
| `# All About Agents for Antigravity` | Antigravity only | `adapters/shared/global-instructions.mjs` |

The Codex and Antigravity appendices also carry the nine core rules and the
presentation catalog. Claude gets the same content as files instead:
`register --surface claude --apply` copies them to
`<CLAUDE_CONFIG_DIR>/rules/all-about-agents/`, and Claude Code loads every
`.md` file under its rules folder, subfolders included
([memory docs](https://code.claude.com/docs/en/memory.md), checked 2026-09-27).

`renderSharedGlobalInstructions` returns the shared body alone. The Codex and
Antigravity renderers build on that function, never on the Claude renderer, so
the Claude-only appendix cannot reach `AGENTS.md` or `GEMINI.md`. A contract
test in `tests/contracts/claude-adapter.test.mjs` holds that boundary.

The Antigravity appendix carries one thing the others do not: the body of the
`using-all-about-agents` skill. Claude and Codex receive that routing contract
from the `SessionStart` bootstrap hook, and Antigravity has no such event, so
the always-loaded instruction file is its only carrier. See
`docs/plans/2026-09-19-restore-antigravity.md` decision A7.

The egroup appendix uses Claude's `@` import syntax and one operator-specific
path. Other surfaces do not resolve `@` imports, and the path is absent on a
machine without that checkout, so keep operator content out of the shared body.

## Native global destinations

The adapters use the following exact destinations:

| Tool | Global file | Normal root |
| --- | --- | --- |
| Claude Code | `<CLAUDE_CONFIG_DIR>/CLAUDE.md` | `~/.claude/CLAUDE.md` |
| Codex | `<CODEX_HOME>/AGENTS.md` | `~/.codex/AGENTS.md` |
| Antigravity | `~/.gemini/GEMINI.md` | `~/.gemini/GEMINI.md` |

Antigravity publishes no environment variable for its home, so the table has no
variable column entry for it. This repository defines `AAA_ANTIGRAVITY_ROOT`
to move that destination, for example to a disposable root. It is not a
product variable: the `agy` commands still act on the live product.

`CLAUDE.local.md` is a private project file, not a global destination. Do not
use it for installation.

Global files are shared: this package owns only its managed part of each. An
explicitly authorized native apply creates no backup, and it does not change
project-specific files or unknown neighboring files.

`CLAUDE.md` and `AGENTS.md` are rendered as one marked block. The first line of
the block begins `<!-- all-about-agents:begin`, and the last line is
`<!-- all-about-agents:end -->`. An authorized native apply writes the whole
file when it is missing. Otherwise it replaces only the lines from the begin
line to the end line, and every byte of your own text above or below the block
stays. When the live file has no intact block (no markers, two begin lines, a
begin line with no end line, or an end line first), registration writes
nothing, reports `manual-required`, and ends with exit code 1
(`manual-step-required`). The reason names the fix: every line that is not in
the package file is your own text, so keep it above or below the markers, put
the package file in place of the rest, and register again. A file written
before the markers existed needs this step once.

`GEMINI.md` is never overwritten. Its deploy carries `guard: "no-clobber"`.
It is complete when it already contains the managed body as one contiguous
block; your own sections before or after it stay. When the body is missing or
one of its lines was edited, registration writes nothing, reports
`manual-required`, and ends with exit code 1 (`manual-step-required`). A live
`GEMINI.md` may hold operator sections this package does not own, or a body
condensed to fit the Antigravity rule size limit, so merge the managed body by
hand.

## Install and registration boundaries

The repository CLI renders a package into an explicit destination. It does not
open a native product. Package apply and native registration are two separate
actions:

1. `install --dry-run` renders and plans the package.
2. `install --apply` writes the selected package root after review.
3. `register --dry-run` plans product registration.
4. `register --apply` performs the explicitly authorized native action.

## Visible names and reasons

Machine IDs stay stable. Presentation labels add an emoji after the name:

```text
Using skill **brainstorming 🧠** — Explore the requirement before implementation.
Invoking agent **researcher 🔎** — Find and check primary sources.
Invoking subagent **reviewer 👀** — Inspect the change independently.
Using skill **writing-plans 📝** — Turn the approved design into a plan.
Invoking agent **verifier ✅** — Check the release evidence.
```

The name comes first and the emoji second. The reason is one short sentence.
IDs, filenames, frontmatter names, and JSON states never contain the emoji. Use
the registry in `core/presentation/emoji-registry.json` for all known names. An
unknown dynamic agent uses `🤖` after its real name.

## Checklists and state changes

Before a visible invocation, show a checklist with 2 to 7 material steps.
Keep one item in progress in sequential work. Update it only when a state
changes. Every final item must be terminal, with a reason for blocked, failed,
skipped, or not-run work.

```text
Using skill **brainstorming 🧠** — Design the requested behavior.

Checklist
- 🔄 Understand the requirement
- ⬜ Compare possible designs
- ⬜ Present the recommended design
```

Later, show only the changed state:

```text
**brainstorming 🧠 — Checklist update**

- ✅ Understand the requirement
- 🔄 Compare possible designs
- ⬜ Present the recommended design
```

A skill that starts a multi-step flow uses one checklist. Do not create a
duplicate checklist for each step. Parallel owners may each have one
in-progress item in a shared task checklist. Long work persists its checklist
in durable state so a new session can resume it.

Prompt guidance is not a UI guarantee. It improves model behavior, but a
product may render the message differently. Record observed
behavior separately from rendered guidance.

## Receiving-machine flow

Use this exact order on Windows and macOS:

```text
pull -> validate -> render -> dry-run -> apply package -> dry-run registration -> explicit registration apply -> restart -> verify loaded instructions
```

Git is the source of truth. A pull updates the repository only. It does not
install files, overwrite live global instructions, register a plugin, or start
a native session. Follow [sync and update](sync-and-update.md) for commands,
and [native verification](native-verification.md) for evidence.

Before a live action, use a disposable root when possible. Review every
dry-run. Keep `rendered`, `validated`, `registered`, `trusted`, `active`, and
`runtime verified` as separate states. A missing product or host is
`NOT_RUN_UNAVAILABLE`, not a pass.
