# What's New

All notable changes to all-about-agents. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The version is the
`version` field of `package.json`. The Claude and Codex plugin manifests read it
from there, and the Antigravity manifest names it in its description.

## [Unreleased]

### Added

- `antigravity` is a supported surface again, beside `claude` and `codex`; this
  reverses decision D6 (see `docs/plans/2026-09-19-restore-antigravity.md`).
  The package is `plugin.json` at its root, `skills/`, `agents/`, a marked
  `GEMINI.md` block that inlines the routing contract (agy has no session-start
  event), and the always-on rule file `config/rules/all-about-agents.md`. No
  hooks or status line are rendered. `register --apply` runs
  `agy plugin validate`, `agy plugin install`, and `agy plugin list`.
  `--surface all` now renders three packages, and `AAA_ANTIGRAVITY_ROOT` (this
  repository's variable, not the product's) redirects the Gemini home for
  qualification runs. The old two-surface design is not restored.
- A root `GEMINI.md` contributor entry point, held to the same protocol as
  `AGENTS.md` and `CLAUDE.md`, and `docs/evaluations/research-antigravity.md`
  with the agy product evidence. The capability schema and its test cover every
  surface.
- `npm run setup` (`scripts/setup.mjs`), one guarded install pipeline.
  `--mode fresh` clears the previous render of the selected surfaces;
  `--mode update` syncs in place. Both render, commit the Codex plugin source,
  then preview, remove, and register one surface at a time, and list what each
  product reports. It plans by default, needs `--apply` to mutate, refuses a
  home, product, repository, or foreign package root, and never deletes inside
  a product root. See `docs/maintenance/sync-and-update.md`, including "Setup
  run by an agent".
- A claude.ai skill pack in `claude-ai/`: `aaa-interview`, `aaa-brief`,
  `aaa-tasks`, `aaa-run`, `aaa-review`, and `aaa-research`, one flow of work
  that hands off through documents. `npm run export:claude-ai` validates the
  claude.ai limits and writes one ZIP per skill to `.aaa/claude-ai/`. It is not
  rendered for any coding tool. See `docs/setup/claude-ai.md`.
- One source for the surface list, `adapters/shared/surfaces.mjs`.
  `installers/lib/audit-log.mjs` keeps its own copy because it ships inside the
  packages.
- `docs/setup/companion-tooling.md` covers Caveman, the Ponytail config path,
  and RTK history.

### Changed

- Where the nine core rules and the presentation catalog live: Claude gets them
  as files in `<CLAUDE_CONFIG_DIR>/rules/all-about-agents/` (extra entries are
  reported as `claude-rules-extra-files`, never deleted), Codex inside
  `AGENTS.md`, and Antigravity as `~/.gemini/config/rules/all-about-agents.md`.
- Codex `AGENTS.md` inlines the `using-all-about-agents` routing contract,
  because Codex 0.152.1 on Windows fails every plugin command hook
  (`hook: SessionStart Failed`). Where the hook does run, the contract arrives
  twice.
- `npm run setup` registers one surface at a time: a failed preview or
  registration stops the run before the next product loses its plugin, a
  missing product CLI is `not-run-unavailable`, and a manual step ends the run
  `manual-required` (exit 1) with its whole reason. It refuses mixed
  whole-root and per-surface state (`surface-subset-in-managed-root`,
  `whole-root-in-surface-managed-root`), strips `GIT_*` for the Codex commit,
  and removes the Claude plugin with `--keep-data`.
- `register --apply` reports `manual-required` when Claude's plugin cache or the
  Codex plugin source still differs from the package, and prints the reinstall
  commands.
- Antigravity Desktop and IDE use the documented global plugin slot
  `~/.gemini/config/plugins/all-about-agents/`, which `agy plugin install`
  fills. The Antigravity records are refreshed for `agy 1.2.12`.
- `npm run test:model` scores a `skill: <name>` trailer instead of the
  announcement banner. A router passes on a route to any skill of this package,
  each run writes its own `.aaa/eval-runs/` folder, a timeout (300000 ms,
  `AAA_CASE_TIMEOUT_MS`) is `NOT_RUN_UNAVAILABLE`, and a plugin cache that does
  not match this checkout marks every case `NOT_RUN_UNAVAILABLE`.
- Two full skill reviews: skill records default to `.aaa/<topic>/`;
  `writing-skills` caps a `SKILL.md` body at 1,500 words (the router at 500);
  overlapping triggers and shared boundaries are stated on both sides;
  `receiving-code-review` reproduces a defect with a failing test first;
  `subagent-driven-development` requires TDD, runs each task's verification
  itself, and its scripts are `.cjs`; routing evals no longer name the skill
  they test.
- The claude.ai pack was revised after two reviews; evidence is in
  `claude-ai/evals/results.md`.
- `docs/compatibility/claude.md` is now `claude-code.md`: on a
  case-insensitive volume Claude Code loaded the old name as a nested
  `CLAUDE.md`. Every doc was checked line by line against the code, and
  `aaa --help` lists every option.

### Removed

- The `nano-image-generator` skill and everything that only it used; the
  portfolio is 27 skills.
- The tracked `.idea/` files, `.pre-commit-config.yaml`, dead
  `.gitattributes` and `DEFAULT_ROLES` entries, two `writing-skills` companion
  files merged into `SKILL.md`, and 92 test cases that could not fail, with
  their orphan fixtures and unused exports.

### Fixed

- `register --apply` overwrote `CLAUDE.md` and `AGENTS.md` whole and left
  `GEMINI.md` for a hand merge, which deleted operator sections such as the
  Codex always-on caveman and ponytail text. All three now render as one block
  from a `<!-- all-about-agents:begin` line to a `<!-- all-about-agents:end -->`
  line, and registration replaces only that block. A file with no intact block
  is left unchanged and reported `manual-required` with the one-time fix.
- The template Claude `model` is `opus[1m]`, the alias for the latest Opus; the
  pinned `claude-opus-5` had gone stale and replaced a newer operator choice.
- `setup` cut each manual step's reason at 120 characters, so an agent could
  not read the fix; it now keeps up to 1,000.
- `setup --mode fresh` could delete a parent folder such as `..`; it now clears
  only the package layout it writes. `setup` also removed every plugin before
  it registered any.
- Claude registration dropped the user's own `permissions.allow` and
  `permissions.deny` entries; both are merged now, and an invalid user list is
  `settings-permission-list-invalid`. Codex `config.toml` is never overwritten:
  it is complete when it holds the managed tables, and `manual-required`
  otherwise.
- Registration steps that left rules or settings undeployed still reported
  complete; they now end `manual-required` with exit 1.
- The Claude statusline could not import its key function, and scripts, hooks,
  and the statusline did nothing when started through a symlinked path.
- An empty `--destination-root` fell back to the current directory, a file with
  the right bytes but the wrong mode was not repaired, and the prune step left
  empty folders behind.
- `brainstorming`'s visual companion always reported port 0 and left keyed
  servers running; `find-polluter.sh`, `render-graphs`, `presentation-trace`,
  and `writing-good-tests.md` had one bug each.
- `subagent-driven-development` reviewed an empty diff when nothing was
  committed; `review-package.cjs` now packages `WORKTREE`, refuses an empty
  package, and refuses unsafe output paths and common secret file names.
- `wait-what` kept the session language when the human asked for another one.
- Tests no longer read the operator's own config or home, and skip with a
  reason when symlinks or PowerShell are unavailable.

## [2.1.1] - 2026-09-19

### Fixed

- `install` no longer treats a package root as unmanaged when its managed state
  exists but cannot be read (for example a 1.x root that names a removed surface).
  `--dry-run` reports `invalid-previous-state`; `--apply` refuses before any
  mutation with `managed state merge rejected before mutation`. Before, such a root
  was rendered over silently and its stale files were never pruned. Remedy: empty the
  root and render again (see `docs/maintenance/sync-and-update.md`).

## [2.1.0] - 2026-09-19

Phases 3 and 4 of the simplification spec: skill content pulled from superpowers
v6.3.0, then truthful test vocabulary and a manual model-run suite. Install this
version, not 2.0.0: the merged `main` already contains both phases.

### Changed

- `using-all-about-agents` (the bootstrap skill) now carries the 1% rule, the
  skill-priority order, a red-flags table, and a SUBAGENT-STOP block, while keeping
  the portable-routing and unavailable-capability rules. 488 words.
- `brainstorming` classifies every request as spike, bounded, or architectural before
  the first question; the artifact scales down, the approval gate never does. Two
  routing cases added.
- `subagent-driven-development` adds the pre-dispatch conflict scan with ledger
  rulings, dispatch hygiene, same-kind batching, and ledger recovery after compaction.
- `writing-skills` adds the form-to-failure table and word budgets.
- `improve-codebase-architecture` may be invoked by the model once the human asks for
  or agrees to a survey; `systematic-debugging` recommends it instead of calling it
  user-only.
- Generic operating rules (untrusted data, preserve unrelated work, no invented paths,
  record not-run) were removed from 19 skills where they only restated the global
  rules; skill-specific forms stay.
- The regex skill tests moved from `tests/behavioral/` to `tests/lint/`; the focused
  gate check is `skill-lint` and the validator error is `missing-lint-test`. Docs no
  longer call a regex check behavioral.

### Added

- `npm run test:model` runs the routing cases of five critical skills through real
  headless `claude -p` sessions and records PASS, FAIL, or NOT_RUN_UNAVAILABLE per case
  under `.aaa/eval-runs/`. It refuses to spawn sessions when the installed plugin
  version differs from `package.json` or the rendered global CLAUDE.md is missing.
  `quality:full` reports the age of the newest result as optional evidence only.

## [2.0.0] - 2026-09-19

Phases 1 and 2 of `docs/plans/2026-09-18-simplify-to-claude-codex.md`.

### Removed

- Antigravity 2.0 Desktop and `agy` surfaces: adapters, manifests, snapshots,
  capability records, compatibility pages, evaluation record, and tests.
- The eight `aaa:*` commands and six workflow state machines, their schemas, the role
  router, and the action-mapping validation in the adapter contract.
- `quarantine/legacy` (recoverable from Git history at `5d185ce` and earlier).
- Superpowers authoring files that were shipped as `systematic-debugging` assets, and
  the Antigravity, Gemini, and Pi tool references of the bootstrap skill.
- The rendered "Using skill / Invoking agent" preamble on every skill and role. The
  announce-and-checklist rule is stated once in the global operating rules.
- The "Announce at start" sentences inside five skills, for the same reason.

### Changed

- The bootstrap hook injects the routing skill on `startup`, `clear`, and `compact`
  SessionStart sources, so the routing contract survives `/clear` and compaction.
- The plugin version comes from `package.json`; `2.0.0` replaces the literal `1.0.0`
  that never changed. Reinstall the Claude plugin after a version change (see
  `docs/maintenance/sync-and-update.md`).
- `quality:full` keeps the last 8,000 characters of a failing check, so the failing
  test names at the end of `node --test` output survive.

### Security

- `install --apply` requires an explicit `--destination-root` and fails closed with
  `destination-root-required`; automatic root discovery serves only `--dry-run`,
  `doctor`, and `diff`. Added after an integration test wrote a render into the live
  `~/.claude` and `~/.codex` roots (incident D9 in the spec).

### Added

- `tests/static/surface-scope.test.mjs` guards invariant I4: no tracked file names a
  removed surface, command, workflow, or quarantine path.
