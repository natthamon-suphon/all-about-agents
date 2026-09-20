# What's New

All notable changes to all-about-agents. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The version is the
`version` field of `package.json`; both rendered plugin manifests read it from there.

## [Unreleased]

### Added

- `antigravity` is a supported surface again, alongside `claude` and `codex`.
  `--surface antigravity` renders a plugin the `agy` CLI reads directly:
  `plugin.json` at the package root, `skills/{skill}/SKILL.md`,
  `agents/{role}.md`, and `GEMINI.md`. `register --apply` runs
  `agy plugin validate`, `agy plugin install`, and `agy plugin list`.
  This reverses decision D6 of the 2026-09-18 simplification, which cut the
  surface on effort grounds rather than a technical limit. See
  `docs/plans/2026-09-19-restore-antigravity.md` and
  `docs/compatibility/antigravity.md`.

  Three consequences for an existing machine:

  - `--surface all` now means three surfaces. A rerun renders one more package
    and, with a single explicit root, adds `<root>/antigravity` beside the two
    existing namespaces. Sibling packages are untouched.
  - `GEMINI.md` is deployed with a no-clobber guard, unlike `CLAUDE.md`. The
    Claude render is a superset of the live file, so overwriting is safe there;
    the Antigravity render is not, because the Gemini home may hold always-on
    sections this package does not own. A differing destination reports
    `manual-required` and nothing is written.
  - Antigravity documents no environment variable for its home, so a dry-run
    would resolve to the operator's live `~/.gemini`. The installer therefore
    defines `AAA_ANTIGRAVITY_ROOT` for qualification runs. It is this
    repository's variable, not the product's.

  The package renders no hooks and no status line. Antigravity has no
  `SessionStart` event, so the `using-all-about-agents` routing contract is
  inlined into `GEMINI.md` instead of injected; it is the first surface where
  that is necessary. The removed adapters' status line pointed at a plugin path
  the product never creates.

  The old two-surface design (`agy` plus `antigravity-2`) is not restored. One
  neutral payload replaces both, which removes the shared-plugin-root collision
  that design caused. `tests/static/surface-scope.test.mjs` still forbids the
  old adapter paths, and still forbids the commands, workflows, and quarantine
  that D6 also cut.

- `GEMINI.md` at the repository root is the Antigravity contributor entry point,
  beside `AGENTS.md` and `CLAUDE.md`. `tests/static/contributor-entrypoints.test.mjs`
  now holds all three to the same minimum protocol instead of spot-checking one.
- `docs/evaluations/research-antigravity.md` records the primary-source product
  observations for `agy 1.2.7`: the command contract, the plugin package shape,
  the missing `SessionStart` event, the model list, and what was not run. The
  adapter capability records and the manifest cite it, matching how the other
  two surfaces carry their evidence.
- `core/schemas/capability.schema.json` accepts `antigravity` as a surface. It
  did not, and `tests/static/capabilities.test.mjs` enumerated two surfaces, so
  `adapters/antigravity/capabilities.json` was never schema-validated. The test
  now covers every supported surface.
- The operator-facing guides name the third surface where it changes what to do:
  global instructions and their destinations, native registration and
  verification, sync and update, cross-tool quality, known limitations, the
  evaluation method, both platform setup pages, and companion tooling. The
  Caveman section of `docs/setup/companion-tooling.md` gained the Antigravity
  route, which previously could not be written down here.

- `npm run setup` refuses a surface subset inside a package root this repository
  already manages as a whole (`surface-subset-in-managed-root`). `--surface all`
  keeps one managed state at the root, while a subset writes a second one inside
  `<root>/<surface>`; registration prefers the nested state, so the two drift
  apart on the next render and the surface fails with a hash mismatch. Manage a
  root with `--surface all` or with subsets, never both.
- A registration step that exits 0 while refusing a guarded file is no longer
  summarized as a plain success. `register --apply` reports `manual-required`
  for a no-clobber destination that already differs, and `setup` now names those
  steps in its report, so a refused `GEMINI.md` or `config.toml` deploy is
  visible instead of hidden behind the exit code.

- The supported surface list now has a single source,
  `adapters/shared/surfaces.mjs`. It had been duplicated across eleven modules,
  so adding a surface by hand would almost certainly have missed one.
  `installers/lib/audit-log.mjs` keeps its own copy on purpose: that file is
  embedded verbatim into every rendered package as `hooks/audit-log.mjs`, where
  no repository path resolves. Its list stays `claude` and `codex` because only
  those surfaces render the hooks that write audit events.

- `docs/setup/companion-tooling.md` now covers Caveman: what it does not ship (no
  lifecycle hook of its own), where the skills live, how to wire a `SessionStart`
  activation hook for Claude Code and Codex, and how to verify it with a live
  answer rather than a written file. The Ponytail section gains the
  platform-specific config path and the `.ponytail-active` flag file, and the RTK
  section records that `rtk gain --history` returned no history on `0.47.0`.
  Two Codex behaviors observed on `v0.152.1` are written down because each cost a
  debugging cycle: a `SessionStart` hook in `$CODEX_HOME/hooks.json` is parsed but
  never executed while plugin-delivered hooks run normally, and `codex plugin add`
  clones the source with `git`, so a local plugin directory must be a git
  repository with a commit.

- `npm run setup` (`scripts/setup.mjs`): one guarded pipeline for installing this
  repository into the local products. `--mode fresh` clears every previous render
  from the package root first; `--mode update` keeps the root and syncs it with the
  current checkout. Both then remove the installed plugin, render, commit the Codex
  plugin source when it changed, register each surface, and list what each product
  reports. Planning is the default and `--apply` is required to mutate. The run
  refuses a home directory, a live product root, this repository, or any directory
  without a rendered package marker, and it never deletes inside the product roots.
  See `docs/maintenance/sync-and-update.md`.

### Fixed

- `npm run test:model` scored the announcement by a literal `Using skill **<skill>`
  string, with a fallback that accepted the skill name plus the word "skill"
  anywhere in the answer. Nothing rendered into the package carries that literal
  string, so compliant announcements were recorded as `FAIL`, and a non-trigger
  answer that named the skill to explain why it stayed unused was recorded as an
  announcement. A case now counts as announced when one line carries the canonical
  skill name together with its emoji from `core/presentation/emoji-registry.json`,
  which is what `core/instructions/global-operating-rules.md` asks for.
- A case that outruns its budget is `NOT_RUN_UNAVAILABLE`, not `FAIL`: a slow
  session is an environment fact, not a routing verdict. The budget moved from a
  fixed 180000 ms to 300000 ms and reads `AAA_CASE_TIMEOUT_MS` when it is set.

## [2.1.1] - 2026-09-19

### Fixed

- `install` no longer treats a package root as unmanaged when its managed state
  exists but cannot be read (for example a 1.x root that names a removed surface).
  `--dry-run` reports `invalid-previous-state`; `--apply` refuses before any
  mutation with `managed state merge rejected before mutation`. Before, such a root
  was rendered over silently and its stale files were never pruned. Remedy: empty the
  root and render again (see `docs/maintenance/sync-and-update.md`).

## [2.1.0] - 2026-09-19

Phases 3 and 4 of the simplification spec. Install this version, not 2.0.0: the
merged `main` already contains both phases.

Phase 3: skill content pulled from superpowers v6.3.0.

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

Phase 4: truthful test vocabulary and a manual model-run suite.

### Changed

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
