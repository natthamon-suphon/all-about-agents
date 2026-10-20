# What's New

All notable changes to all-about-agents. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The version is the
`version` field of `package.json`. The Claude and Codex plugin manifests read it
from there, and the Antigravity manifest names it in its description.

## [Unreleased]

### Changed

- Shared global instructions apply Karpathy's coding discipline while keeping
  the external skill optional. Cleanup stays within the task and preserves
  existing comments outside it.
- Replies follow the session language automatically, use English CEFR A1-A2
  only when no language is clear, and keep answers short without losing key
  facts or clarity. Code comments are limited to necessary short explanations,
  constraints, and required notices.

### Fixed

- Antigravity registration requests JSON before parsing plugin discovery.
- Antigravity stages global instructions in `config/GEMINI.md`, avoiding the
  native strict warning for an unloaded plugin-root file while retaining
  marked-block deployment to the global `GEMINI.md`.
- Full-access template roles inherit parent permissions; Antigravity declares
  its documented eager command policy instead of relying on an omitted default.
- Claude/Codex audit and checkpoint history uses native plugin data directories.
  Path guards reject symlinks and hardlinks; legacy imports are bounded,
  repeatable, dry-run by default and preserve source files.
- Legacy history imports compare exact BigInt handle identities when older
  Windows path stats omit device IDs, including on the minimum Node version.
- Windows native execution resolves supported npm CLI entry points without
  evaluating command-shell wrappers.
- Registration groups parent checks within synchronous scans and rechecks
  parents before returning. Each action starts fresh; file and hash checks stay.
- SDD output helpers reject a linked parent before creating a temporary file,
  retaining their second parent check before rename on Windows and macOS.

### Added

- Managed CLI model selection discovers eligible premium releases before each
  launch, prefers xhigh, and reports the highest available effort otherwise.
  Catalog failures stop launch; unsupported GUI automation is explicit.
- Current companion guidance covers all seven requested integrations, distinct
  activation ownership and RTK 0.50.0 Codex hook support. The clean-profile CI
  list includes Antigravity on both Windows and macOS.

## [2.4.0] - 2026-10-20

### Added

- Four portable skills: `domain-modeling`, `pr`, `retro`, and
  `diagnosing-agent-workflows`. All three surfaces now carry 31 canonical
  skills and their owned companions.
- Reviewed provenance for Superpowers v7.0.0 and Matt Pocock's skills at
  pinned commits, with one explained disposition for every canonical skill.
  Core loading rejects missing, duplicate, malformed, or unsafe provenance.
- Each managed plugin package carries the unchanged root LICENSE, including
  the upstream copyright and permission notices.

### Changed

- Design and interviews start from intent and use a process sized to the work.
  Plans capture exact decisions, constraints, assertions, and review focus.
- Approved execution continues through local task helpers, bounded rulings,
  guarded review evidence, and independent review without routine pauses.
- Design and architecture surveys use existing domain language and relevant
  ADR evidence. Compaction preserves original reasoning and disk recovery;
  wayfinding retires mis-scoped tickets without treating them as route decisions.
- PR-body drafting uses `pr` only when authorized. Reviews and tests use public
  seams, realistic inputs, and separate source, model, and native evidence.
- Native role prompts and metadata now distinguish behavior tests from
  no-behavior artifact checks. Reviewers return separate Standards and Spec
  judgments, missing-Spec results, and every declined judgment.
- Worker templates respect required model/context inheritance. Parallel writers
  require separate verified worktrees; explicit resume reuses snapshot recovery,
  and nontrigger routing returns to the applicable workflow.

### Fixed

- Optional Claude statusline I/O validates regular files and checked handles
  before append, rotation or read. Linked targets preserve their neighbors;
  an unavailable log root leaves the main status fields visible.
- The visual companion starts and stops through Node on Windows without Bash.
  Authenticated loopback control verifies the exact instance, closes live
  connections, preserves project screens and refuses uncertain cleanup. Partial
  deletion errors report retained proof and whether a safe retry is available.
- Shared semantic guidance distinguishes portable restrictions from full-access
  inheritance. Snapshot and model-test instructions use actual candidate output.
- Native registration no longer walks unused render metadata or accepts it as
  planner input. Fixed command builders and source-hash checks remain in charge.

These are repository and rendered-package changes. They do not install or
register a plugin, change model/access/emergency-deny policy, or prove native
runtime behavior. See [reviewed upstream updates](docs/maintenance/upstream-updates.md).

## [2.3.0] - 2026-10-10

### Changed

- The Codex template profile selects `gpt-6.1-sol` with `xhigh` reasoning. The
  ChatGPT desktop app writes that pair into `config.toml` on launch, so the
  rendered file and the app no longer disagree. The `terra-max` alternate is
  unchanged.
- The Claude package renders its global instruction file at `config/CLAUDE.md`
  instead of the package root. Registration still deploys it to
  `<CLAUDE_CONFIG_DIR>/CLAUDE.md`. Claude Code 2.1.295 warns that a plugin-root
  `CLAUDE.md` is never loaded as project context, which made
  `claude plugin validate --strict` fail.

### Removed

- The Claude-only `## egroup house rules (coding-guidelines)` appendix and its
  `@~/Workspaces/coding-guidelines/Rules/RULES.md` import. Keep an import that
  exists on one machine only in your own text outside the marked block.

### Fixed

- `register --surface codex` no longer fails at `codex-plugin-list` with
  `native-process-output-too-large`. `codex plugin list --available --json`
  lists the remote catalog (2.5 MB on Codex 0.162.0), so that one action now
  runs with a 16 MiB output budget. Observed end to end on macOS on
  2026-10-09. The `verify-codex` step of `npm run setup` uses the same
  budget, because plain `codex plugin list` already prints 1 MB there.

## [2.2.0] - 2026-09-28

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
