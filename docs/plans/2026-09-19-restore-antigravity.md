# Restore Antigravity as a supported surface

Status: phases 0-3 complete; runtime verified on agy 1.2.7, Windows
Supersedes: decision D6 of `docs/plans/2026-09-18-simplify-to-claude-codex.md`

## 1. Why this reverses D6

D6 cut Antigravity 2 Desktop and `agy` on 2026-09-18 for one reason recorded in
that spec: they were "not weekly tools for the owner, yet own ~6,070 lines and
appear in 30 of 82 test files". The cost was the argument, not a technical
limit.

On 2026-09-19 the owner reversed owner decision 2: Antigravity is wanted again,
on the same footing as Claude Code and Codex, so that other machines can be set
up from this repository instead of by hand.

Between the cut and the reversal, a hand-built install proved the product side
works and costs far less than 6,070 lines. Observed on agy 1.2.7, Windows,
2026-09-19:

- A plugin folder holding only a root `plugin.json`, `skills/<id>/SKILL.md`, and
  flat `agents/<id>.md` passes `agy plugin validate` with `28 processed` skills
  and `7 processed` agents.
- `agy plugin install <dir>` accepts a plain local directory. It needs no git
  repository, unlike `codex plugin add`.
- `agy agents` lists all seven roles, and `agy -p` names real skills, when run
  from a directory with no `.agents/` folder. The global install is therefore
  active on its own, not shadowed by a workspace copy.

So the restored surface does not need the two old adapters. It needs one small
one.

## 2. Decisions

| ID | Decision | Evidence |
| --- | --- | --- |
| A1 | One surface named `antigravity`, not the old pair `agy` + `antigravity-2`. | The pair is what caused the shared-slot collision recorded in memory `agy-plugin-root-collision`: two adapters rendered different surface-tagged payloads into the single registry `~/.gemini/config/plugins/`. One neutral payload removes the conflict by construction. |
| A2 | Runtime differences ride on a `targetRuntime` input (`cli`, `desktop`), not on separate surfaces. | Codex already does exactly this; `tests/lint/release-gates.test.mjs:53-54` renders `codex` twice with `targetRuntime: "cli"` and `"desktop"`. Reuse the pattern rather than invent one. |
| A3 | The adapter is written fresh, modelled on `adapters/codex/adapter.mjs`. The old adapters are read for native facts only. | `adapters/agy/adapter.mjs` was 994 lines and `adapters/antigravity-2/adapter.mjs` 559 at `8cbfd3b^`. Both predate 2.0: they render the deleted commands and workflows, hardcode plugin version `1.0.0`, and build a status line from `installedPluginRoot = ~/.gemini/antigravity-cli/plugins/`, a path the product never creates. |
| A4 | No hooks are rendered. | **INFERRED.** No session-start event can be named with current evidence. The recorded list (`PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`, no `SessionStart`) is inherited from the removed `agy` adapter's 2026-08-31 record for 1.1.22 and was not re-verified on 1.2.7, which publishes no hook documentation through its CLI. Inventing an event name is forbidden by the portable-routing rule, so none is rendered. The old adapters shipped hook files with every event array empty and `"enabled": false`; that is dead weight, not a feature. `core/hooks/bootstrap.mjs:29` `SESSION_START_SURFACES` therefore stays `["claude", "codex"]`. See `docs/evaluations/research-antigravity.md`. |
| A5 | No status line is rendered. | The old agy status line pointed at a path the product never creates, and the dead `statusLine` key had to be removed from `~/.gemini/antigravity-cli/settings.json` by hand on 2026-09-19. Shipping it again would re-create a known-broken artifact. |
| A6 | `GEMINI.md` is deployed with `guard: "no-clobber"`. | `installers/lib/native-registration.mjs:227` deploys `CLAUDE.md` **without** the guard, which is safe only because `renderClaudeGlobalInstructions` makes the render a superset of the live file. A live `~/.gemini/GEMINI.md` can hold sections this package does not own, such as the caveman block on the owner's machine. Without the guard, `register --apply` would silently delete them. With it, the run reports `manual-required` and writes nothing. |
| A7 | The rendered `GEMINI.md` inlines the `using-all-about-agents` body. | Claude and Codex receive the routing contract through the `SessionStart` bootstrap hook. Antigravity has no such event (A4), so the only always-loaded carrier is the global instruction file. Antigravity is the first surface where the contract must be inlined; `package/codex/AGENTS.md` only names the skill in its presentation catalog (line 242). |

## 3. Open question

**Does Antigravity Desktop read `~/.gemini/config/plugins/`, or only a
per-workspace `<workspace>/.agents/plugins/` slot?**

ASSUMPTION MADE: Desktop reads the per-workspace slot. The source is a
2026-09-03 memory note, not an observation on the current Desktop build, and
Desktop has no headless mode, so it cannot be checked from a session.

The assumption affects **registration only**. Render, validation, the adapter
contract, and CLI registration are unaffected, so phase 1 proceeds. If Desktop
turns out to read the global plugin root, the `desktop` runtime needs no
separate destination and the manual registration record for it can be dropped.

Manual check, two minutes: open Antigravity Desktop on a workspace that has no
`.agents/` folder and ask it to name a skill whose name starts with `using-`.

## 4. Phases

| Phase | Content | Gate |
| --- | --- | --- |
| 0 | Centralize the surface list. It is currently duplicated in 13 modules, so adding a third entry by hand would almost certainly miss one. Pure refactor, no behavior change. | Full suite green before and after. |
| 1 | `adapters/antigravity/` (adapter, capabilities, templates), `installers/manifests/antigravity.json`, renderer and installer wiring, `scripts/setup.mjs`. | New contract and integration tests, written RED first. |
| 2 | Guard and suite updates: narrow `CUT_PATTERN` in `tests/static/surface-scope.test.mjs`, extend `release-gates`, `all-surfaces`, `setup`. Add an update test that takes a package root whose `state.json` names only `claude` and `codex` and proves `--mode update --surface all` adds `antigravity/` cleanly. | `npm run quality:full`. |
| 3 | Docs and release: `docs/compatibility/antigravity.md`, README surface list, `docs/maintenance/native-registration.md`, both setup pages, `WhatsNew.md`. | `npm run quality:full`. |

The version stays `2.1.1`. This repository bumps at release, and `WhatsNew.md`
already carried unreleased entries at that version, so the surface is recorded
under `[Unreleased]` instead.

Two pre-existing defects in `scripts/setup.mjs` had to be fixed before the
surface could be installed, and both would have hit any single-surface run:

- A subset of surfaces rendered to the package root itself while registration
  read `<root>/<surface>`, so the two steps disagreed. A subset now renders into
  the same per-surface namespace that `--surface all` uses.
- The verify step ran the surface name as the executable. The Antigravity binary
  is `agy`, so the name and the binary are now separate values.

The guard keeps `adapters/agy`, `adapters/antigravity-2`, their manifests, and
their snapshots in `REMOVED_PATHS`. The old two-surface design stays dead; only
the new single surface is allowed.

## 5. Non-goals

- No change to the installer safety model: root containment, atomic write, no
  backup, dry-run default, explicit authority for apply and register.
- No commands, workflows, or quarantine paths return. Those parts of D6 stand.
- No change to `core/instructions/global-operating-rules.md`.
- No macOS evidence. Windows only, as for the other two surfaces.

## 6. Consequences to record when phase 3 lands

- `--surface all` changes meaning on every existing machine: it becomes three
  surfaces, not two.
- The hand-built `~/.all-about-agents/agy-plugin/` and its install at
  `~/.gemini/config/plugins/all-about-agents/` become unmanaged leftovers.
  Uninstall the hand-built plugin before the first `register --apply` for this
  surface, or the product holds two plugins with the same name.
- `~/.caveman/README.md` and `~/.all-about-agents/agy-plugin/README.md` describe
  Antigravity steps that were kept out of the repository only because the guard
  forbade the words. That content may move into `docs/setup/companion-tooling.md`
  once phase 2 lands.
