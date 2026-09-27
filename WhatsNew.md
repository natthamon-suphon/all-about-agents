# What's New

All notable changes to all-about-agents. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The version is the
`version` field of `package.json`; both rendered plugin manifests read it from there.

## [Unreleased]

### Added

- A claude.ai skill pack in `claude-ai/`: six skills for one flow of work in
  claude.ai chat and Cowork. `aaa-interview` interviews and keeps a live
  record; `aaa-brief` writes a formal brief; `aaa-tasks` breaks work into
  checked tasks; `aaa-run` works through them and stops only for risk;
  `aaa-review` reviews every output and document; and `aaa-research` writes
  a sourced report, primary sources first. The skills hand off through
  documents, because claude.ai skills cannot call each other.
  `npm run export:claude-ai` validates the claude.ai limits and writes one
  deterministic ZIP per skill to the gitignored `.aaa/claude-ai/`. The pack is
  not rendered for Claude Code, Codex, or Antigravity. See
  `docs/setup/claude-ai.md` and `docs/plans/2026-09-26-claude-ai-skill-pack.md`.

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

  The package renders no hooks and no status line. No session-start event can be
  named with current evidence: the recorded event list is inherited from the
  2026-08-31 evaluation of `agy 1.1.22` and was not re-verified on 1.2.7. So the
  `using-all-about-agents` routing contract is inlined into `GEMINI.md` instead
  of injected; it is the first surface where that is necessary. The removed adapters' status line pointed at a plugin path
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

### Changed

- A second full review of the 27 core skills was fixed in one pass. The
  owner chose three defaults:
  - Skill records now default to `.aaa/<topic>/`, because Codex and
    Antigravity use them too. `handoff.md`, brainstorming's `design.md`, and
    wayfinder's `MAP.md` and `tickets/` move there from
    `.claude/all-about-agents/<topic>/`; session-compaction's `snapshot.md`
    and loop-me's `workflow-spec.md` get it as their first default path; and
    brainstorming screens made with `--project-dir` go to `.aaa/brainstorm/`.
    Older folders are not moved.
  - `writing-skills` now caps a `SKILL.md` body at 1,500 words, and the
    router at 500. `systematic-debugging` moved its red flags to
    `red-flags.md`, and `subagent-driven-development` moved its conflict scan
    to `conflict-scan.md`, to fit.
  - The orphan `systematic-debugging/condition-based-waiting-example.ts` is
    deleted.
- The Claude package now renders `adapter-capability-guidance.md` for the
  router, like Codex and Antigravity, so the router's surface-specific steps
  no longer stop on Claude. The Codex guidance links the Codex-only tool
  notes.
- The `subagent-driven-development` scripts are now `.cjs` and the
  `writing-skills` renderer is `render-graphs.mjs`, so they run from the
  source tree under `"type": "module"`.
- Boundaries that two skills both claimed are now stated on both sides:
  debugging versus performance work, plan-task execution versus parallel
  dispatch (with a routing case in each eval), handoff versus compaction
  state (one shared record shape), and verification versus branch finishing.
- `dispatching-parallel-agents` needs recorded plan approval only for workers
  that write; read-only workers need a bounded brief and a named owner.
- `receiving-code-review` now reproduces a confirmed defect with a failing
  test before the fix. `writing-plans` runs no tests while planning.
  `subagent-driven-development` makes TDD required for behavior changes, and
  the coordinator runs each task's verification command itself.
- `register --apply` reports `manual-required` (exit 1) when Claude's plugin
  cache for the installed version differs from the package (a missing or
  changed file, a symlinked folder, or any extra file except Claude's
  `.in_use/` markers and the hook logs under `hooks/audit/` and
  `hooks/checkpoints/`), or when the Codex plugin's package root has
  uncommitted changes or is not its own Git repository. The cache must sit
  below `<product root>/plugins/cache`. The report prints the exact reinstall
  commands, with control characters escaped; for a package root that holds
  `'` it prints none. See `docs/maintenance/native-registration.md`.
- Several descriptions were narrowed so their triggers no longer overlap:
  brainstorming, performance-profiling-and-benchmarking (goal and proof work;
  an unknown-cause regression goes to systematic-debugging),
  threat-modeling-and-security (trust-boundary changes), zero-downtime-migrations
  (not when a maintenance window is accepted), handoff, session-compaction-resilience,
  and executing-plans. `resolving-merge-conflicts` gained a stash-conflict
  section, and the code reviewer template no longer creates a worktree.
- claude.ai pack: the interview record keeps the topic, the opening message
  (Q0), facts given outside a question, and attached files, and a document
  keeps its language unless the user asks for another. The brief keeps both
  values when the source contradicts itself. A task is parallel-safe when it
  changes nothing another task changes; a dependency counts as done when its
  status starts with `done`; and `aaa-run` never gives a task that needs
  approval to a subagent. `aaa-research` counts a browser as a web tool and
  checks an attached answer when the user asks. `aaa-review` counts a success
  criterion that can only be measured later as "not checked", does not report
  an open question that no output answers, rates a missing extra that no
  requirement names as minor, and asks for any fact only the user has.

- The claude.ai skill pack was revised after a pre-upload review. The shared
  conventions now define one meaning per ID type (including `REQ#` and `F#`),
  keep IDs across documents, and treat updates to the project's own documents
  and outputs as part of the work, so `aaa-run` and `aaa-review` no longer stop
  before every save. `aaa-interview` continues an existing record and keeps
  every fact of an answer; `aaa-brief` never traces an idea only Claude
  suggested and never fixes a vague word with an invented number; `aaa-tasks`
  adds no inferred criteria; `aaa-run` defines the failed-check path and gives
  the whole task file at every stop. The interview, review, and research
  descriptions are narrower, and `docs/setup/claude-ai.md` now says to delete the old
  `aaa-interview` before the upload. Evidence is in `claude-ai/evals/results.md`.

- `npm run test:model` now scores routing instead of the announcement banner.
  Each case prompt carries one appended instruction: end with a final line
  `skill: <canonical skill name, or none>`. A trigger or pressure case passes
  when that line names its own skill, a non-trigger case passes when it names
  anything else, and a missing line is a `FAIL` whose reason says the trailer is
  missing, so an ignored instruction never reads as a routing verdict.

  The previous scorer required the canonical name and the registered emoji on
  one line. Measured on this machine, 11 of 17 cases failed that check while the
  answers routed correctly in prose, and only 1 of 17 stored excerpts contained
  any registered emoji. The banner is a presentation rule from
  `core/instructions/global-operating-rules.md`; these cases run under
  `--permission-mode plan` and ask a meta-question, so no material action occurs
  and the rule that requires a banner before the first material action does not
  apply. The suite now measures the thing it claims to test, and
  `core/presentation/emoji-registry.json` is no longer read by it.

  This supersedes the assertion designed at
  `docs/plans/2026-09-18-simplify-to-claude-codex.md:366`, which specified
  `Using skill **<skill>` as the trigger-case contract.

  Two assertions were wrong in a way the old scorer could not show, and the
  first real run exposed both:

  - A router skill was asserted to name itself. `using-all-about-agents`
    dispatches to another skill, so on a trigger case the correct answer is the
    skill it routes to, and the old assertion could never pass. `suite.json`
    now carries `routers`, and a router's trigger case passes on any route,
    its non-trigger case requires no route at all (which is stricter than
    before, and is what `restartBootstrap: false` in the case file asks for),
    and its pressure case stays strict because the rule under pressure lives in
    the router itself.
  - The trailer question was unscoped, so an answer could name a skill from
    another plugin installed on the machine. `BR-PRESSURE-code-immediately`
    routed to `surgical-patch`, which lives in the operator's `~/.claude/skills`
    and not in this package. The question now names this package, and a route
    outside it is reported as such in the failure reason.

  Trade-offs: the trailer is self-reported, so the suite measures a stated route
  rather than an observed one, and a model that ignores the instruction fails.
  Scoping the question primes the answer toward this package, so the suite
  measures which of its own skills applies, not which skill wins on a machine
  that carries several sets. The `observables` in
  `core/evals/skill-routing/*.json` stay unscored; they are English prose and
  need a judge, which `docs/evaluations/method.md` assigns to blinded human
  scorers.

### Removed

- `writing-skills/anthropic-best-practices.md` and
  `writing-skills/examples/CLAUDE_MD_TESTING.md`: their content moved into
  `SKILL.md` and `testing-skills-with-subagents.md`.
- The `nano-image-generator` skill, its Gemini image script, routing eval,
  lint test, inventory and emoji entries, and its collision set. The
  portfolio is now 27 skills, and the inventory schema pins 27. Its user
  instructions called `python`, which does not exist on macOS, and the owner
  chose to drop the skill rather than fix it.

### Fixed

- `brainstorming`: the visual companion always reported port 0, so its URL
  never opened. Each start now makes a new session key, kept only in a
  private temp folder, never in the project. `stop-server.sh` now cleans up
  on macOS, where `TMPDIR` and `/tmp` resolve through `/private`, and also
  after the server stopped by itself. A start that times out no longer leaves
  a keyed server running. A second stop reports `not_running` as JSON, a path
  outside the temp root is refused untouched, a crash before ready keeps only
  the log, a reused process ID is never force-killed, and a symlinked `.aaa`
  or `.aaa/brainstorm` is refused.
- `systematic-debugging`: `find-polluter.sh` passes `test --` only to package
  managers and skips `node_modules`; its documented example no longer checks a
  path that always exists. The containment example uses `realpath` and
  `path.relative`, and the human-in-the-loop template is run by the user.
- `subagent-driven-development` scripts refuse an output file outside the
  plan's `sdd/` folder, a name that starts with a dot, a symlinked `sdd/`
  folder or output, a task number that is not a whole number, and a folder
  that is not a Git work tree. Diffs over 1 MiB now package, packages ignore
  color and external diff settings, and both the Node scripts and the bash
  fallback write a temporary file and rename it. The bash fallback passes
  only resolved commit IDs to Git, so a ref cannot act as an option. A
  `WORKTREE` package lists the untracked files it includes and refuses
  (exit 2, paths only, nothing written) untracked files with common secret
  names such as `.env`, `*.pem`, or `id_rsa*`. Packages and briefs are
  written with mode 0600, and SIGHUP now cleans up like the other signals.
- `test-driven-development/writing-good-tests.md` has its good and bad labels
  back; an encoding error had replaced them with `// ?`.
- The installer's prune step now removes folders it left empty, up to the
  package root, and never a folder that still holds files.
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
- `subagent-driven-development` built its review package from commits only.
  The skill's default is to not commit, so the package held an empty diff and
  a task could still be reviewed and completed. `review-package.cjs` now takes
  `WORKTREE` as the head to package uncommitted work, and `--snapshot` prints a
  tree id to use as the per-task base. Both write Git objects only, with no
  commit, ref, index, or working-tree change. An empty package is refused with
  exit 3 and no file.
- `wait-what` kept the session language even when the human asked for another
  one. It now switches when the human asks for another language, and a request
  to hurry is still not a language request. The pressure case is now
  `WW-PRESSURE-hurry-keeps-language`, and `WW-TRIGGER-asks-for-another-language`
  is new.

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
