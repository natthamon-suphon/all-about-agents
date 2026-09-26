# claude.ai skill pack

## What it is

`claude-ai/` holds six skills for claude.ai chat and Cowork. They cover one
flow of work, and each skill hands off to the next through a document:

| Skill | Writes |
| --- | --- |
| `aaa-interview` | `01-interview-record.md` |
| `aaa-brief` | `02-brief.md` |
| `aaa-tasks` | `03-tasks.md` |
| `aaa-run` | task outputs and updates to `03-tasks.md` |
| `aaa-review` | `04-review.md` |
| `aaa-research` | `research-<topic>.md` |

The pack is separate from `core/`. It is not rendered for Claude Code, Codex,
or Antigravity. The design is in
[the spec](../plans/2026-09-26-claude-ai-skill-pack.md).

Source layout:

- `claude-ai/shared/conventions.md`: the shared rules. Export copies this file
  into every ZIP as `references/conventions.md`.
- `claude-ai/skills/<name>/`: one folder per skill.
- `claude-ai/evals/`: eval cases per skill, and `results.md` for dated
  results.

## Build

```text
npm run export:claude-ai
```

The command validates every skill against the claude.ai limits, then writes
one ZIP per skill to `.aaa/claude-ai/`. That folder is gitignored. The command
prints the SHA-256 of each ZIP. The same source always gives the same bytes on
the same Node version. If any skill fails validation, no ZIP is written and
each error is printed.

## Upload

1. In claude.ai, turn on code execution. Skills do not load without it.
2. Open **Customize > Skills** and upload `.aaa/claude-ai/<name>.zip`.
3. Type `/aaa` in a new chat. The uploaded skills should appear in the list.

Upload is a manual owner step. When you change the shared conventions, every
ZIP changes, so upload all six again.

## Verify

Run the cases in `claude-ai/evals/<name>.md` in a new claude.ai chat. For a
case with earlier turns, type those turns first. Record each result in
`claude-ai/evals/results.md` with runner `claude.ai`.

`proxy` rows in `results.md` come from Claude Code helpers that role-play a
claude.ai chat. They are not runtime evidence.

## Lifecycle

```text
rendered (ZIP built) -> validated (pack and export tests)
-> registered (uploaded at Customize > Skills)
-> active (the skill shows in the / list)
-> runtime verified (eval cases pass in a real chat)
```

Until a dated `claude.ai` pass exists for a skill, its status is "validated,
claude.ai run pending".

## Update a skill

1. Add or change eval cases first.
2. Edit the skill. Keep the same `name`, so the upload replaces the old
   version.
3. Run the checks:

   ```text
   node --test tests/contracts/claude-ai-pack.test.mjs tests/static/claude-ai-pack.test.mjs
   npm run export:claude-ai
   ```

4. Upload the new ZIP and run its eval cases again.
