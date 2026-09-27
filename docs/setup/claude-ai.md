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

1. In claude.ai, turn on code execution at **Settings > Capabilities**.
   Skills do not load without it.
2. If an older build of a skill is uploaded (today: `aaa-interview`), delete
   it first, so two versions cannot be active at once: turn it off, select
   **...** next to its toggle, choose **Delete**, and confirm.
3. Open **Customize > Skills**, select **+**, then **Create skill** and
   **Upload a skill**. Upload `.aaa/claude-ai/<name>.zip`. Repeat for each of
   the six ZIPs.
4. Turn on the toggle of each uploaded skill.
5. Type `/aaa` in a new chat. The uploaded skills should appear in the list.
   In Cowork, start a new session first, because custom skills sync at
   session start.

Upload is a manual owner step. When you change the shared conventions, every
ZIP changes, so upload all six again. After an upload, record the ZIP SHA-256
in `claude-ai/evals/results.md`.

Sources for these steps (checked 2026-09-27):
[Use skills in Claude](https://support.claude.com/en/articles/12512180-use-skills-in-claude).
The Cowork sync fact comes from the
[Cowork overview](https://claude.com/docs/cowork/overview.md) (spec fact F8,
checked 2026-09-26).

## Verify

Run the cases in `claude-ai/evals/<name>.md` in a new claude.ai chat. For a
case with earlier turns, type those turns first. Record each result in
`claude-ai/evals/results.md` with runner `claude.ai`.

Warning: a case that uses a connector acts on a real account if the skill
fails. For example, `aaa-run-PRESSURE-1` sends a real email, and
`aaa-run-PRESSURE-7` changes a booking site. Run these cases with no
connector connected, or with a sandbox account.

A case that uses a connected folder can change or delete the files in it if
the skill fails. For example, `aaa-run-PRESSURE-3` has a task that deletes
old draft files. Run every folder case, and above all `aaa-run-PRESSURE-3`,
in a new throwaway folder that holds only the fixture files.

Cases that need fixed tool results are proxy only, because a live web search
does not return those results: `aaa-research-PRESSURE-2` and
`aaa-research-PRESSURE-3`. Do not record them with runner `claude.ai`.

`proxy` rows in `results.md` come from Claude Code helpers that role-play a
claude.ai chat. They are not runtime evidence.

## Lifecycle

```text
rendered (ZIP built) -> validated (pack and export tests)
-> registered (uploaded at Customize > Skills)
-> active (the skill shows in the / list)
-> runtime verified (eval cases pass in a real chat)
```

The repo lifecycle also has a `trusted` state. claude.ai has no separate
trust step, so this flow skips it (inferred: the upload steps above name only
the upload and the toggle).

Until a dated `claude.ai` pass exists for a skill, its status is "validated,
claude.ai run pending".

## Update a skill

1. Add or change eval cases first.
2. Edit the skill. Keep the same `name`.
3. Run the checks:

   ```text
   node --test tests/contracts/claude-ai-pack.test.mjs tests/static/claude-ai-pack.test.mjs
   npm run export:claude-ai
   ```

4. Delete the old skill first, as in Upload step 2, then upload the new ZIP
   and run its eval cases again. The help center does not say whether an
   upload with the same name replaces the old skill (checked 2026-09-27).
