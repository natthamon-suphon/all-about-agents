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

## Default replies and code comments

All surfaces share these defaults:

- Prefer no code comments. Add short comments only for non-obvious intent,
  necessary constraints, or required notices. Preserve existing comments
  outside the task.
- Follow the session language and the user's latest language request without
  requiring a separate language command. Quoted text, code, logs, and technical
  terms do not choose the reply language. Use simple English at CEFR A1-A2
  only when the session language is unclear.
- Give the outcome first and keep replies as short as clarity allows. Retain
  key facts, required checks, risks, and next actions. Give more detail when
  requested or needed for correctness or safety. Keep exact technical text.

## Karpathy coding discipline

The shared source integrates the four principles from
[karpathy-guidelines](https://github.com/multica-ai/andrej-karpathy-skills/blob/2c606141936f1eeef17fa3043a72095b4765b9c2/skills/karpathy-guidelines/SKILL.md),
reviewed on 2026-10-20:

- Think before coding: state assumptions, resolve material ambiguity, and
  explain a simpler option when it fits.
- Simplicity first: reuse suitable code and tools; add only what the task needs.
- Surgical changes: preserve unrelated code, comments, and formatting. Remove
  only code made unused by the current change; report other dead code.
- Goal-driven execution: define observable success criteria, give each material
  step a check, and verify bugs and refactors at the relevant boundary.

These constraints apply through the shared source to Claude Code's `CLAUDE.md`,
Codex's `AGENTS.md`, and Antigravity's `GEMINI.md`. Antigravity CLI, Desktop 2.0,
and IDE use the same global instruction source; this is a rendering contract,
not proof that each native product loaded the file.

When the external `karpathy-guidelines` skill is installed and discoverable,
use it for the full coding guidance. It remains optional and external: this
repository does not bundle it, install it, or add a second bootstrap hook.
The global rules remain usable without it. See
[companion tooling](../setup/companion-tooling.md#karpathy-guidelines).

Keep required validation, safety, accessibility, and data-loss protection.
This alignment does not change the selected model policy, access mode,
emergency denies, or operator-owned sections outside the managed block.
The shared source must stay below its existing 160-line and 8,000-character
limits. Rendered files also retain their product-specific size checks.
Static contracts check the text and package delivery; native behavior still
needs a fresh session after an explicitly authorized installation.

## Web instruction text

Claude web, ChatGPT web, and Gemini web have separate plain-text summaries in
`docs/instructions/`. They are manually maintained, not adapter output. Use
[the web instruction guide](../setup/web-instructions.md) to copy the matching
text into the account's instruction field. Review all three summaries when
shared behavior changes. They do not import Markdown, install companion
skills, change model or access settings, or prove native behavior.

## Surface-specific appendices

The shared source reaches every surface. Each surface may add an appendix at
render time, so a rendered global file is not always byte-identical to the
source:

| Section | Surfaces | Defined in |
| --- | --- | --- |
| `## RTK house rules (rust-token-killer)` | Antigravity, Claude Code, and Codex | `core/instructions/global-operating-rules.md` |
| `# All About Agents for Codex` | Codex only | `adapters/shared/global-instructions.mjs` |
| `# All About Agents for Antigravity` | Antigravity only | `adapters/shared/global-instructions.mjs` |

The Codex appendix also carries the nine core rules and the presentation
catalog. Antigravity gets them as the always-on rule file
`~/.gemini/config/rules/all-about-agents.md` (see below). Claude gets the same
content as files instead:
`register --surface claude --apply` copies them to
`<CLAUDE_CONFIG_DIR>/rules/all-about-agents/`, and Claude Code loads every
`.md` file under its rules folder, subfolders included
([memory docs](https://code.claude.com/docs/en/memory.md), checked 2026-09-27).

`renderSharedGlobalInstructions` returns the shared body alone. The Claude
renderer wraps that body in the marked block and adds nothing. The Codex and
Antigravity renderers build on the same function and add only their own
sections below it. A contract test in
`tests/contracts/claude-adapter.test.mjs` holds that every surface carries the
RTK house rules and that no surface carries an operator-specific import.

The Codex and Antigravity appendices carry one thing the Claude file does not:
the body of the `using-all-about-agents` skill. Claude receives that routing
contract from the `SessionStart` bootstrap hook. Antigravity keeps the global
instruction file as its single carrier even though Google now documents
`SessionStart`. Windows Codex 0.152.1 failed plugin command hooks; the inlined
contract preserves routing there. Check newer versions separately.

Antigravity stages its global file as `config/GEMINI.md` inside the package.
Registration deploys it to `~/.gemini/GEMINI.md`. A plugin-root copy is never
loaded as a rule and causes a strict validation warning on `agy 1.4.2`.

No surface renders an operator-specific appendix. Claude resolves `@` imports,
but a path that exists on one machine only does not belong in the shared
source. Keep such an import in your own text above or below the marked block,
as `rtk init -g` does with `@RTK.md`.

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

`CLAUDE.md`, `AGENTS.md`, and `GEMINI.md` are rendered as one marked block. The
first line of
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

Antigravity truncates one rule file at 24,000 bytes, so its canonical rules and
presentation catalog are not in `GEMINI.md`. Registration copies them to
`~/.gemini/config/rules/all-about-agents.md`, an always-on global rule file
this package owns whole. See [Antigravity](../compatibility/antigravity.md).

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
