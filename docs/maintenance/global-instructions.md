# Global instructions and presentation

This repository has one canonical source for global behavior:
`core/instructions/global-operating-rules.md`. Adapters render that source for
Claude Code, Codex, Antigravity Desktop, and `agy`. The source is reviewed in
Git. The generated files are not edited by hand.

## Two instruction layers

The global layer gives stable behavior for every repository. It covers
correctness, safety, scope, research, verification, and honest status reports.

The project and plugin layer is the more specific second layer. It gives repository commands,
local architecture, selected skills, workflows, rules, hooks, and task details.
The more specific layer adds detail but must not weaken global safety rules.
Keep these files in the project or plugin layer:

- project `CLAUDE.md`, `AGENTS.md`, and `.agents/rules/`;
- plugin rules, skills, agents, commands, and workflow records;
- repository paths, test commands, and project-specific policy.

This is a two-layer model: global behavior first, then project or plugin
behavior. A project file does not replace the shared source.

## Native global destinations

The adapters use the following exact destinations:

| Tool | Global file | Normal root |
| --- | --- | --- |
| Claude Code | `<CLAUDE_CONFIG_DIR>/CLAUDE.md` | `~/.claude/CLAUDE.md` |
| Codex | `<CODEX_HOME>/AGENTS.md` | `~/.codex/AGENTS.md` |
| Antigravity Desktop | `~/.gemini/GEMINI.md` | `~/.gemini/GEMINI.md` |
| `agy` | `~/.gemini/GEMINI.md` | `~/.gemini/GEMINI.md` |

`CLAUDE.local.md` is a private project file, not a global destination.
`GEMINI.local.md` is not a supported global destination. Do not use either
name for installation. The old file under `quarantine/` is migration history,
not a runtime input.

Global files are managed files. An explicitly authorized native apply may
overwrite the approved global file without a backup. It does not change
project-specific files or unknown neighboring files.

## Install and registration boundaries

The repository CLI renders a package into an explicit destination. It does not
open a native product. Package apply and native registration are two separate
actions:

1. `install --dry-run` renders and plans the package.
2. `install --apply` writes the selected package root after review.
3. `register --dry-run` plans product registration.
4. `register --apply` performs the explicitly authorized native action.

`agy` owns the automatic explicit registration action for the shared
`GEMINI.md`. Antigravity Desktop has no supported automatic registration in
this repository. Desktop-only users copy the one rendered `GEMINI.md` file to
`~/.gemini/GEMINI.md` manually, then restart Desktop. Do not guess a Desktop
settings schema.

## Visible names and reasons

Machine IDs stay stable. Presentation labels add an emoji after the name:

```text
Using skill **brainstorming 🧠** — Explore the requirement before implementation.
Invoking agent **researcher 🔎** — Find and check primary sources.
Invoking subagent **reviewer 👀** — Inspect the change independently.
Running command **aaa:verify ✅** — Check the release evidence.
Starting workflow **implement-change 🛠️** — Implement the approved plan.
```

Reason: each visible invocation has one short sentence. The reason is one short sentence.

The name comes first, the emoji comes second, and the reason is one short
sentence. IDs, filenames, frontmatter names, and JSON states never contain the
emoji. Use the registry in `core/presentation/emoji-registry.json` for all
known names. An unknown dynamic agent uses `🤖` after its real name.

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

For a command that starts a workflow, use the workflow checklist once. Do not
create a duplicate command checklist. Parallel owners may each have one
in-progress item in a shared task checklist. Long work persists its checklist
in durable workflow state so a new session can resume it.

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
