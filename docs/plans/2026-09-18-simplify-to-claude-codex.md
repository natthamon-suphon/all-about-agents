# Simplify all-about-agents to Claude + Codex

Status: approved by the owner on 2026-09-19 ("implement phases 1-4"). All four phases
are implemented on stacked branches `simplify/phase-1` (`8cbfd3b`, `276d6d7`),
`simplify/phase-2` (`e89870e`), `simplify/phase-3` (`0a6e5ea`), and `simplify/phase-4`,
merged fast-forward into `main` on 2026-09-19 and released as `2.1.0`; the pre-install
review pass added D10 and released `2.1.1` (`WhatsNew.md`).
Phase reports are in section 14. Open: macOS evidence and a model-run result with the
current package installed.
Date: 2026-09-18. Author machine: Windows. Companion analysis and decision log:
[2026-09-18-repo-comparison.md](2026-09-18-repo-comparison.md).

## 1. Provenance and problem

all-about-agents (AAA) forked obra/superpowers v1.0.0 on 2025-10-09, tracked upstream
through v6.2.0, was rebranded on 2026-08-08, merged a subset of mattpocock/skills on
2026-08-15, then grew an installer and adapter layer for four surfaces. Today the
repository holds 5.9k lines of skill Markdown against 29k lines of JavaScript (tests
16.5k) plus 11.9k lines of quarantined legacy files.

Verified defects and costs that motivate this change:

| Id | Finding | Evidence |
| --- | --- | --- |
| D1 | "Behavioral" skill tests are regex checks on SKILL.md prose; the real behavior gates are `NOT_RUN_UNAVAILABLE`. | `tests/behavioral/skills/*.test.mjs`, `core/evals/rubric.json` `qualification` |
| D2 | A 10-line presentation preamble is rendered into every skill, agent, and command (43 artifacts). The announce rule already exists once in `core/instructions/global-operating-rules.md`. | `installers/lib/presentation-contract.mjs:183` |
| D3 | The 8 `aaa:*` commands reference 6 workflow state machines that are not part of the Claude package. | `installers/manifests/claude.json` has no `workflows` component or owned path |
| D4 | Plugin version is the literal `"1.0.0"` in both adapters, so `claude plugin update` is a no-op after every change. | `adapters/claude/adapter.mjs:481`, `adapters/codex/adapter.mjs:217`, memory `plugin-cache-staleness` |
| D5 | The bootstrap hook injects the routing skill only when `source === "startup"`. After `/clear` or compaction the routing contract is gone. | `core/hooks/bootstrap.mjs` |
| D6 | Antigravity 2 and agy are not weekly tools for the owner, yet own ~6,070 lines and appear in 30 of 82 test files. | owner decision 2, `find`/`grep` counts |
| D7 | macOS has never produced native evidence for any surface, although the owner uses macOS daily. | `docs/limitations/known-limitations.md` |
| D9 | `install --apply` without `--destination-root` auto-discovers the live `~/.claude` and `~/.codex` roots and writes into them. README claimed the opposite. Found 2026-09-19 00:38 when a pre-existing integration test (which expected antigravity-2 to make `--surface all --apply` fail) ran during phase 1 and installed the phase-1 render into both live roots, replacing `~/.claude/settings.json` with the portable overlay. | `installers/lib/roots.mjs` `resolveDestinationRoot`; incident record in the phase-1 report |
| D8 | `quality:full` keeps only the first 2,000 characters of a failing check's output, so when the 774-test suite fails, the failure lines at the end are cut off and the report cannot say which test failed. Observed 2026-09-18: one `full-test-suite` FAIL whose cause was unrecoverable; two immediate reruns passed 770/774. | `scripts/quality-gate.mjs` `boundedEvidence` (`summary.slice(0, MAX_EVIDENCE_LENGTH - 25)`) |
| D10 | A package root last written by 1.x holds a managed state naming removed surfaces. `readManagedState` returned null for it, so `renderPlans` treated the root as unmanaged: no `invalid-previous-state` diagnostic, no prune actions, stale `claude/commands/*.md` kept after an in-place refresh. Found 2026-09-19 during the pre-install review of `~/.all-about-agents/package` (dry-run: replace 129, unchanged 144, prune 0). Fixed in `847af88`, released as 2.1.1. | `scripts/aaa.mjs` `loadPreviousState`, RED test in `tests/integration/cli.test.mjs` |

## 2. Owner decisions (2026-09-18)

1. Audience: one person, several machines, macOS and Windows. Not a team or public product.
2. Weekly surfaces: Claude Code and Codex. Antigravity 2 and agy are cut.
3. Commands and workflows are unused. Delete them; skills carry the flow.
4. Enforcement: superpowers style. Every skill is model-invoked; strict gates; the
   bootstrap carries the "1% rule" and fires on `startup|clear|compact`.
5. Tests: keep the regex layer, renamed to contract lint, and add a small headless
   `claude -p` trigger suite that runs manually, outside `quality:quick`.

## 3. Goal

One vendor-neutral `core/` rendered for exactly two surfaces, with a lean bootstrap that
survives `/clear` and compaction, a truthful test vocabulary, a version that changes when
content changes, and no dead layers.

## 4. Non-goals

- No new skills from mattpocock/skills in this change (`retro`, `pr` are a later option).
- No change to the installer's safety model (root containment, atomic write, no backup,
  dry-run default, explicit authority for apply and register).
- No removal of roles, rules, profiles, statusline, checkpoint hook, or activity-audit
  hook. ASSUMPTION MADE: both profiles and all 7 roles stay; revisit after phase 1.
- No change to personal rules in `core/instructions/global-operating-rules.md`
  (A2 English, RTK, egroup). They are the owner's own rules; "portable" means one source
  for the owner's machines.
- No Git commit, push, install, or native registration without a separate explicit
  instruction per action.

## 5. Target architecture

```text
core/
  skills/            28 skills (content refreshed from superpowers v6.3.0 in phase 3)
  roles/             7 roles + contract.mjs   (router.mjs removed)
  rules/             9 rules
  instructions/      global-operating-rules.md
  hooks/             bootstrap, checkpoint, activity-audit
  presentation/      emoji-registry.json (skills, roles, subagents, hooks, profiles), progress-contract.json
  schemas/           capability, inventory, presentation, profile, role, rule, skill
  evals/             rubric, runner, skill-routing cases (now consumed by the claude -p suite)
  inventory.json
adapters/
  claude/  codex/  shared/
installers/
  lib/  manifests/{claude,codex}.json  schemas/  install.ps1  install.sh
profiles/            portable, template (modelPolicies for two surfaces)
tests/
  static/  contracts/  lint/ (renamed from behavioral)  integration/  snapshots/{claude,codex}/  model/ (new, manual)
docs/
  compatibility/{claude,codex}.md  evaluations/  limitations/  maintenance/  setup/  plans/
WhatsNew.md
package.json         "version" is the single version source
```

Removed: `adapters/antigravity-2`, `adapters/agy`, `core/commands`, `core/workflows`,
`core/roles/router.mjs`, `core/schemas/command.schema.json`,
`core/schemas/workflow.schema.json`, `quarantine/`, and every rendered preamble.

## 6. Invariants (must hold after every phase)

- I1. `npm run quality:quick` and `npm run quality:full` exit 0 on Windows. Phase 4 adds
  the same requirement on macOS.
- I2. Rendering the Claude and Codex packages twice into two disposable roots yields
  byte-identical output (existing determinism contract).
- I3. `node scripts/aaa.mjs validate --scope all` passes; every skill in
  `core/inventory.json` exists with its listed assets; no inventory path points to a
  deleted file.
- I4. No rendered file, doc, test, or script references `antigravity`, `agy`,
  `aaa:build`, `aaa:fix`, `aaa:review`, `aaa:audit`, `aaa:design`, `aaa:verify`,
  `aaa:resume`, `aaa:improve-skill`, `workflowId`, `.aaa/state/workflows`,
  `implement-change`, or `quarantine/legacy`, except the
  historical entries kept in `WhatsNew.md` and `docs/evaluations/*` records dated
  before this change.
- I5. Installer safety behavior is unchanged: the existing `tests/contracts/roots.test.mjs`
  and `tests/contracts/apply.test.mjs` pass without weakening any assertion.
- I6. The emergency deny rules in both profiles are unchanged.
- I7. Every skill keeps `name`, `description` starting with "Use when" or an explicit
  "You MUST use" trigger, and `evaluationCases` that resolve to a file in
  `core/evals/skill-routing/`.

## 7. Phases

Each phase is one reviewable change. Do not start a phase before the previous one meets
its acceptance checks. Each phase ends with an evidence report (section 12).

### Phase 1: Cut

Scope: deletion and reference cleanup only. No behavior change to what remains, except
the sentences in two skills that name the deleted `implement-change` workflow (listed
under Edit below).

Delete:

- `adapters/antigravity-2/**`, `adapters/agy/**`
- `installers/manifests/antigravity-2.json`, `installers/manifests/agy.json`
- `tests/snapshots/antigravity-2/**`, `tests/snapshots/agy/**`
- `tests/contracts/agy-adapter.test.mjs`, `tests/contracts/agy-statusline.test.mjs`,
  `tests/contracts/antigravity-2-adapter.test.mjs`,
  `tests/integration/agy-install.test.mjs`, `tests/integration/antigravity-2-install.test.mjs`,
  `tests/integration/manual-desktop-checklist.json`
- `docs/compatibility/antigravity-2.md`, `docs/compatibility/agy.md`,
  `docs/evaluations/antigravity-contracts-2026-08-31.md`
- `core/skills/using-all-about-agents/references/antigravity-tools.md`,
  `core/skills/using-all-about-agents/references/gemini-tools.md`,
  `core/skills/using-all-about-agents/references/pi-tools.md` (Pi is a superpowers
  harness, never an AAA surface); keep `codex-tools.md`
- `core/commands/**`, `core/workflows/**`, `core/roles/router.mjs`,
  `core/schemas/command.schema.json`, `core/schemas/workflow.schema.json`
- `tests/behavioral/roles/routing.test.mjs`, `tests/behavioral/roles/routing.json`,
  `tests/contracts/commands.test.mjs`, `tests/contracts/workflows.test.mjs`
- `quarantine/**`
- From `core/skills/systematic-debugging/`: `CREATION-LOG.md`, `test-academic.md`,
  `test-pressure-1.md`, `test-pressure-2.md`, `test-pressure-3.md`, and their entries in
  `core/inventory.json` `assets` and in `tests/static/inventory.test.mjs` lines 166-178,
  which enumerate them. Keep `condition-based-waiting*.*`, `defense-in-depth.md`,
  `feedback-loops.md`, `find-polluter.sh`, `root-cause-tracing.md`, `hitl-loop.template.sh`.

Edit (surface list becomes `["claude", "codex"]`):

- `installers/lib/{apply,args,audit-log,doctor,plan,render,roots,state}.mjs`
- `installers/lib/native-registration.mjs`: remove the import of
  `ANTIGRAVITY_PERMISSION_POLICY` and every `surface === "antigravity-2"` branch
- `adapters/shared/adapter-contract.mjs`, `adapters/shared/native-state.mjs`
- `core/hooks/bootstrap.mjs`: remove `INVOCATION_SURFACES`, the `antigravity-2` output
  shape, and `hasFirstInvocation`
- `core/schemas/capability.schema.json`, `core/schemas/inventory.schema.json`,
  `core/schemas/profile.schema.json` (`modelPolicies` required keys become `claude`, `codex`)
- `profiles/portable/profile.json`, `profiles/template/profile.json`
- `core/presentation/emoji-registry.json`: remove `commands` and `workflows` sections;
  `core/schemas/presentation.schema.json` and `core/evals/presentation-trace*.{mjs,json}`
  and `core/evals/scenarios/presentation-contract.json` follow
- `core/hooks/checkpoint.json` and both adapters' `templates/hooks/checkpoint.json`:
  drop `workflowId` from `recordedFields`; the checkpoint records `taskId`, `state`,
  `status`, `timestamp`
- `installers/lib/presentation-contract.mjs`: remove the `command` and `workflow` kinds
- `installers/manifests/{claude,codex}.json`: remove `actions`, `commands` component,
  `commands/{command}.md` owned path
- `adapters/claude/adapter.mjs`, `adapters/codex/adapter.mjs`: stop rendering
  `commands/`; stop emitting the "Command/workflow rule" line in `rules/presentation.md`
- `scripts/quality-gate.mjs`: remove `native-agy-version`
- `core/inventory.json`: remove command and workflow records if present; keep 28 skills
- `core/skills/session-compaction-resilience/SKILL.md` lines 24-44 and 123: the section
  "Canonical long-task workflow" names the `implement-change` workflow. Replace it with
  the skill sequence that now carries the flow (`brainstorming` -> `writing-plans` ->
  `executing-plans` or `subagent-driven-development` -> `verification-before-completion`)
  and name the durable ledger path the SDD skill already defines. Keep the skill's
  routing cases unchanged; rerun `npm run quality:skill -- session-compaction-resilience`.
- `core/skills/handoff/SKILL.md` line 24: "defined by the active workflow" becomes
  "defined by the active plan or skill"; the fallback path stays
  `.claude/all-about-agents/<topic>/handoff.md`.
- Docs: `README.md` (layout table, surfaces, manifests list), `CONTRIBUTING.md`,
  `docs/maintenance/{cross-tool-quality,global-instructions,native-registration,native-verification,session-prompt,skill-development,sync-and-update}.md`,
  `docs/limitations/known-limitations.md`, `docs/evaluations/method.md`,
  `docs/setup/{windows,macos,companion-tooling}.md`
- Tests that enumerate surfaces or docs: `tests/static/documentation.test.mjs`
  (`requiredOutputs`), `tests/static/repository-layout.test.mjs`,
  `tests/static/capabilities.test.mjs`, `tests/static/inventory.test.mjs`,
  `tests/static/maintenance-docs.test.mjs`, `tests/static/presentation-safety.test.mjs`,
  `tests/behavioral/{presentation-contract,release-gates}.test.mjs`,
  `tests/contracts/{adapter-contract,args,audit-checkpoint,bootstrap-hooks,claude-adapter,codex-adapter,complete-skill-manifest,core-loader,native-registration,presentation-contract,profiles,quality-gate,quality-report,roles,roots,rules}.test.mjs`,
  `tests/integration/{all-surfaces,claude-install,codex-install,cli,native-registration}.test.mjs`
- Regenerate `tests/snapshots/{claude,codex}/*.json` after the render changes.

Safety fix added 2026-09-19 (owner decision, after D9): `install --apply` requires an
explicit `--destination-root` for every surface; without it the CLI fails closed with
`destination-root-required` before any render or write. Automatic root discovery stays
available for `--dry-run`, `doctor`, and `diff`. RED test first in
`tests/integration/all-surfaces.test.mjs` (env-isolated temp roots, asserts non-zero exit
and empty roots for `all`, `claude`, and `codex`) and `tests/contracts/args.test.mjs`;
GREEN in `installers/lib/args.mjs`.

Open check inside phase 1: `.agents/rules/all-about-agents.md` is tracked. Confirm from
`docs/compatibility/codex.md` whether Codex reads it. If only Antigravity read it, delete it
and its mention in `CONTRIBUTING.md`.

Acceptance:

```text
node scripts/aaa.mjs validate --scope all --format json          exit 0
npm run quality:quick                                              exit 0
npm run quality:full                                               exit 0
node scripts/aaa.mjs install --surface all --destination-root <DISPOSABLE> --dry-run   plans exactly two surface namespaces
git grep -i -E "antigravity|(^|[^a-z])agy([^a-z]|$)|aaa:(build|fix|review|audit|design|verify|resume|improve-skill)|workflowId|\.aaa/state/workflows|implement-change|quarantine/legacy" -- . ':!CHANGELOG.md' ':!docs/evaluations/*' ':!docs/plans/*'   no matches
```

Stop conditions: any acceptance command fails; a deletion target is referenced by a file
not listed above (add it to the list, do not guess); `roots.test.mjs` or `apply.test.mjs`
needs an assertion weakened.

### Phase 2: Fix mechanics

Scope: four small, independent changes.

2a. Bootstrap on `startup|clear|compact`.

- `core/hooks/bootstrap.mjs`: `buildBootstrapOutput` returns the context output when
  `normalized.source` is one of `startup`, `clear`, `compact`.
- `adapters/claude/templates/hooks/bootstrap.json` and the rendered `hooks/hooks.json`
  matcher: `"startup|clear|compact"`.
- Codex: confirm from `docs/compatibility/codex.md` and the Codex adapter whether Codex
  emits a `source` field for `SessionStart`. If it does not, Codex keeps its current
  behavior and the limitation is recorded in `docs/compatibility/codex.md`.
- Test: `tests/contracts/bootstrap-hooks.test.mjs` gains cases for `clear` and `compact`
  returning the routing content, and for `resume` returning empty output.

2b. Version from one source.

- `package.json` gains `"version": "2.0.0"` (major bump: removed surfaces and commands).
- Both adapters read the version from `package.json` at render time instead of the
  literal `"1.0.0"`. No bump script: one file, edited by hand per release.
- `WhatsNew.md` created at the repository root in Keep a Changelog format, following the
  Workspaces convention (the `/whats-new` skill maintains this file name). First entry
  `2.0.0` lists phase 1 and phase 2 changes. Every later phase adds an entry under
  `Unreleased` until released.
- `tests/contracts/{claude,codex}-adapter.test.mjs` assert the rendered `plugin.json`
  version equals `package.json` version. Snapshot fixtures embed the version, so they are
  regenerated when the version changes; the snapshot README documents this.
- `docs/maintenance/sync-and-update.md` receiving-machine flow adds: after
  `install --apply`, run `claude plugin uninstall` + `claude plugin install` when the
  version changed, or `claude plugin update` when only the marketplace pointer changed.

2c. Remove the rendered preamble.

- `installers/lib/presentation-contract.mjs`: stop building the "Using skill / Invoking
  agent" block, its placeholder checklist, "Reason rule", and "Checklist rules" for skills
  and roles. Keep the emoji registry and progress contract as data.
- The announce-and-checklist rule stays exactly once, in
  `core/instructions/global-operating-rules.md` ("Invocation announcements and
  material-step checklists") and its rendered `rules/presentation.md`.
- Remove the five in-skill "Announce at start" lines
  (`dispatching-parallel-agents`, `executing-plans`, `research`,
  `subagent-driven-development`, `writing-plans`) because the global rule covers them.
- Tests: `tests/behavioral/presentation-contract.test.mjs`,
  `tests/contracts/presentation-contract.test.mjs`, `tests/static/presentation-safety.test.mjs`
  change from "preamble present" to "preamble absent, rule present once in
  `rules/presentation.md`". Regenerate snapshots.

2d. Keep the tail of failing check output.

- `scripts/quality-gate.mjs` `boundedEvidence`: when output exceeds
  `MAX_EVIDENCE_LENGTH`, keep the last part (where `node --test` prints failure details
  and the summary counts), not the first part. Raise `MAX_EVIDENCE_LENGTH` to 8,000 so
  a failure block fits. `--output PATH` already writes the full JSON report; document
  in `CONTRIBUTING.md` that a FAIL must be rerun with `--output` before it is reported.
- Test: `tests/contracts/quality-gate.test.mjs` gains a case with a fake runner whose
  output ends in a failure line and asserts that line survives truncation.
- A FAIL that does not reproduce on rerun is recorded as `FLAKY` (a release failure
  condition in `core/evals/rubric.json`), with the test name once 2d makes it visible.

Acceptance: same commands as phase 1, plus:

```text
node core/hooks/bootstrap.mjs --surface claude --skill-path core/skills/using-all-about-agents/SKILL.md --config-path core/hooks/bootstrap.json <<< '{"hook_event_name":"SessionStart","source":"compact"}'
   output contains hookSpecificOutput.additionalContext
grep -c "Using skill" <DISPOSABLE>/claude/skills/*/SKILL.md      every count is 0
node -e "const a=require('./package.json').version,b=require('<DISPOSABLE>/claude/.claude-plugin/plugin.json').version;if(a!==b)process.exit(1)"   exit 0
```

### Phase 3: Pull upstream content (superpowers v6.3.0)

Scope: skill text only. Source of truth for each pull is the raw file at
`https://raw.githubusercontent.com/obra/superpowers/v6.3.0/skills/<name>/...` (the tag,
not `main`, so the pull is reproducible on every machine), read in full before editing. Adapt `superpowers:` prefixes to
`all-about-agents:`, "your human partner" stays as written, and AAA's authority and
untrusted-data sentences move out of individual skills into `core/rules/` where a rule
already covers them (`authority-and-scope`, `secrets-and-untrusted-input`,
`evidence-and-truth`).

3a. `using-all-about-agents`: rebuild from upstream `using-superpowers`: the
`<SUBAGENT-STOP>` block, "The Rule" with the 1% sentence, "Skill check comes BEFORE
clarifying questions", Skill Priority, the 12-row Red Flags table, User Instructions
precedence. Keep AAA's two portability paragraphs (adapter capability guidance, no
invented paths). Target under 70 lines.

3b. `brainstorming`: add the three-path router (Spike, Bounded, Architectural) with the
rule "the artifact scales down, the approval gate never does". Keep AAA's trivial
read-only nontrigger and the visual companion just-in-time rule. Update
`core/evals/skill-routing/brainstorming.json` with one case per path.

3c. `subagent-driven-development`: diff AAA's 140-line SKILL.md and its three prompt
files against upstream v6.3.0 (`SKILL.md`, `implementer-prompt.md`,
`task-reviewer-prompt.md`, `re-review-prompt.md`). Restore any of these that are
missing: status codes `DONE / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT`, report
under 15 lines, "Do Not Trust the Report", verdict first, rounds 1-3 resume the same
implementer, rounds 4-5 fresh implementer on a stronger model, five-round breaker with a
`Ruling:` line in the ledger, controller never edits code, conflict scan before Task 1,
batching small same-kind tasks. Record each restored item in the phase report.

3d. `writing-skills`: add the "Match the Form to the Failure" table and the word budgets
as stated upstream. Keep AAA's owned-artifact validation list.

3e. The five explicit-signal skills (`loop-me`, `wait-what`, `handoff`, `wayfinder`,
`improve-codebase-architecture`): rewrite the trigger sections so the model may invoke
them on a clear observable signal (for example `wait-what` on "that did not land";
`handoff` on "hand this off" or "pause here"; `wayfinder` on a multi-session effort with
an unclear route). Remove "only when the human explicitly invokes" wording. Keep each
skill's nontrigger case. Update the three routing cases per skill.

3f. Deduplication pass across all 28 skills: remove sentences that restate a rule in
`core/rules/` or `global-operating-rules.md` word for word or near it (untrusted data,
preserve unrelated work, no invented paths, record `not run`). A skill keeps such a
sentence only where the rule applies in a skill-specific way. Report before and after
word counts per skill.

Acceptance: phases 1-2 commands, plus `npm run quality:skill -- <skill>` for every edited
skill, plus a manual read of each rendered skill in the disposable root to confirm the
`all-about-agents:` prefix and no upstream telemetry text was pulled in (upstream's
visual companion loads a remote logo; AAA's companion must stay loopback-only, enforced
by the existing `brainstorming.test.mjs` CSP assertions).

### Phase 4: Tests that match the vocabulary

4a. Rename `tests/behavioral/` to `tests/lint/`. Rename `quality:skill`'s check id from
`skill-behavior` to `skill-lint`. Update `CONTRIBUTING.md`,
`docs/maintenance/skill-development.md`, `docs/maintenance/cross-tool-quality.md`, and
`core/skills/writing-skills/SKILL.md` so no document calls a regex check "behavioral".

4b. New manual suite `tests/model/`:

- `tests/model/run-trigger-suite.mjs`: first check preconditions, because D4 shows the
  installed cache can be stale: the installed plugin's `.claude-plugin/plugin.json`
  version must equal `package.json` version, and the rendered global `CLAUDE.md` must be
  present in the Claude config directory (the announce format the suite asserts on comes
  from that file, not from the plugin). If either check fails, every case is recorded as
  `NOT_RUN_UNAVAILABLE` with reason "installed package stale" and the run exits 0 without
  spawning `claude`. Then, for each skill listed in `tests/model/suite.json`, read
  `core/evals/skill-routing/<skill>.json`, and for each case spawn `claude -p <prompt> --output-format json` with `spawnSync` and a structured
  argument list, working directory a disposable git repository that contains only a
  README, and the installed plugin present. Assert on the JSON `result` text:
  trigger cases contain `Using skill **<skill>`; nontrigger cases do not; pressure cases
  contain the skill name and do not contain an implementation action word from a small
  list stored in `suite.json`. Timeout per case 180 s. Record `PASS`, `FAIL`, or
  `NOT_RUN_UNAVAILABLE` when `claude` is not on `PATH` or exits with an authentication
  error. Write results to `.aaa/eval-runs/<timestamp>.json` (already git-ignored) using
  the existing `core/evals/runner.mjs` envelope so redaction rules apply.
- Initial `suite.json`: `brainstorming`, `test-driven-development`,
  `systematic-debugging`, `verification-before-completion`, `using-all-about-agents`.
- `package.json`: `"test:model": "node tests/model/run-trigger-suite.mjs"`. Not part of
  `quality:quick` or `quality:full`. `quality:full` gains an informational, non-required
  check that reports the newest `.aaa/eval-runs/` result age.
- `docs/maintenance/skill-development.md`: a skill change is reported as "lint-verified,
  model run pending" until `test:model` has a `PASS` for that skill dated after the
  change.

4c. macOS evidence: run `npm run quality:full`, the install dry-run for both surfaces,
and `npm run test:model` on a macOS machine. Record the result as
`docs/evaluations/native-macos-<date>.md` in the same shape as
`native-windows-2026-08-31.md`, and update the surface table in
`docs/limitations/known-limitations.md`.

Acceptance: phases 1-3 commands, plus `npm run test:model` produces a result file with
five skills and every case has a status; on Windows and macOS.

### Phase 5: Later, optional, out of this spec

- Import `retro` and `pr` from mattpocock/skills as AAA skills.
- Evaluate installing the Claude package directly from the GitHub repository as a
  marketplace so `installers/` shrinks to global `CLAUDE.md`, `settings.json`, and the
  statusline.
- Revisit the two-profile split and the 7 roles against actual use.

## 8. Error handling and rollback

- Every phase is a separate set of commits on a branch named `simplify/phase-<n>`,
  created only after an explicit Git instruction. `main` stays releasable.
- A failed acceptance check stops the phase. Fix inside the phase; do not carry a red
  check into the next phase.
- Deleted content is recoverable from Git history; `quarantine/README.md`'s disposition
  table is preserved in the `WhatsNew.md` 2.0.0 entry as a one-line pointer to the last
  commit that contained `quarantine/`.
- Installed packages on any machine are not touched by this work. Re-installation is a
  separate, explicit action per machine following `docs/maintenance/sync-and-update.md`.

## 9. Testing strategy

| Layer | What it proves | When |
| --- | --- | --- |
| `validate --scope all` | schemas, inventory paths, skill frontmatter | every phase |
| `tests/lint/` (renamed) | required sentences and structure exist in skill text | every phase |
| `tests/contracts/`, `tests/static/`, `tests/integration/` | adapters, installer safety, docs, determinism | every phase |
| snapshots | rendered bytes unchanged except intended edits | every phase |
| `tests/model/` (manual) | a real Claude Code session invokes the skill on trigger, not on nontrigger, resists pressure | phase 4 onward, before any release |
| macOS run | I1 holds on the second OS | phase 4c |

RED first: for each phase, add or change the failing test before the production edit
(for deletions, the failing test is the `git grep` invariant I4 and the updated
enumerations; for 2a it is the `compact` bootstrap case; for 2b the version equality
assertion; for 2c the "preamble absent" assertion; for 3x the updated routing cases and
lint assertions; for 4b the suite runner's own contract test with a fake `claude`
executable).

## 10. Pre-mortem

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| A surface list is hard-coded in a file not on the phase 1 list, and a test still passes because the list was never asserted. | medium | I4 `git grep` is the final gate; run it before declaring phase 1 done. |
| Codex `SessionStart` has no `source` field, so 2a helps Claude only. | medium | Check the Codex compatibility record first; document the gap rather than invent a field. |
| Snapshot churn hides an unintended byte change in phases 2-3. | medium | Regenerate snapshots only after reading the `diff` of the rendered disposable root; record the reviewed diff summary in the phase report. |
| Upstream v6.3.0 text carries assumptions AAA rejected (remote telemetry logo, `.superpowers/` paths, `superpowers:` prefix). | high | Phase 3 acceptance includes a manual read of each rendered skill and the existing CSP test. |
| `claude -p` costs money and time; the suite is skipped forever. | high | Suite is small (5 skills, 15 cases), has a documented "lint-verified, model run pending" status, and `quality:full` reports result age. |
| macOS run never happens. | high | Phase 4 is not complete without `native-macos-<date>.md`. |
| `session-compaction-resilience` still tells the model to "share the canonical `implement-change` workflow" after that workflow is deleted. | high | Phase 1 edits the two skills named in its Edit list; I4 greps for `implement-change` and `.aaa/state/workflows` so a missed mention fails the gate. |
| The owner later wants Antigravity or agy back. | low | Git history holds the adapters at the last pre-phase-1 commit, recorded in `WhatsNew.md`. |

## 11. Assumptions and open items

- ASSUMPTION MADE: `package.json` `version` is an acceptable single version source; no
  separate `VERSION` file.
- ASSUMPTION MADE: keep both profiles and all 7 roles until phase 5 review.
- Open, resolved inside phase 1: whether Codex reads `.agents/rules/all-about-agents.md`.
- Open, resolved inside phase 2a: whether Codex emits `source` on `SessionStart`.
- Open, resolved inside phase 3c: which SDD v6.3 behaviors AAA's compression dropped.

## 12. Evidence report per phase

Each phase report lists: changed and deleted paths; exact commands with exit codes and
pass counts; the rendered disposable-root diff summary; snapshot regeneration reason;
checks not run with `NOT_RUN` or `NOT_RUN_UNAVAILABLE` and reason; Git branch, SHA, and
dirty state; remaining risks. Lifecycle words `registered`, `trusted`, `active`,
`runtime verified` appear only with native evidence.

## 13. Sources

- Local: `git log`, `core/**`, `adapters/**`, `installers/**`, `tests/**`, `docs/**`,
  memory record `plugin-cache-staleness` (2026-09-02).
- obra/superpowers v6.3.0 (fetched 2026-09-18): `README.md`, `RELEASE-NOTES.md`,
  `hooks/hooks.json`, `hooks/session-start`, `skills/using-superpowers/SKILL.md`,
  `skills/brainstorming/SKILL.md`, `skills/subagent-driven-development/*`,
  `skills/writing-skills/SKILL.md`, `docs/testing.md`, `tests/claude-code/README.md`.
- mattpocock/skills v1.2.3 (fetched 2026-09-18): `README.md`, `.agents/invocation.md`,
  `skills/productivity/writing-for-agents/SKILL-MECHANICS.md`.

## 14. Phase reports

### Phase 1 report (2026-09-19, Windows, branch `simplify/phase-1`, commit `8cbfd3b`)

Changed: 265 files, +1,781 / -25,112 lines. Deleted 161 files, modified 103, added
`tests/static/surface-scope.test.mjs`. The commit message lists every removed area.

| Check | Command | Result |
| --- | --- | --- |
| Core validation | `node scripts/aaa.mjs validate --scope all --format json` | pass, 0 errors |
| Quick gate | `npm run quality:quick` | PASS, 9 of 9 checks |
| Full gate | `npm run quality:full` | PASS on the second run; the first run failed on `tests/integration/codex-install.test.mjs`, which still asserted `core.workflows` and `core.commands`; fixed, then PASS |
| Whole suite | `node --test` | 657 tests, 654 pass, 3 skipped (POSIX mode bits on Windows, live product roots) |
| Dry-run both surfaces | `install --surface all --destination-root <DISPOSABLE> --dry-run` | status dry-run, namespaced: claude 104 files, codex 168 files |
| Apply guard | `install --surface codex --apply` with no destination | exit 2, `destination-root-required` |
| Invariant I4 | `git grep` from the phase 1 acceptance block | no matches |
| Snapshot diff | local regeneration script (git-ignored) | 16 files removed per package; 7 (Claude) and 11 (Codex) kept files changed, all expected |

Not run: macOS (no macOS machine in this session); native `register --apply`; any
live-root install. Native lifecycle claims for this commit: `rendered` and `validated`
only.

Incident D9 during phase 1. A subagent fixing `tests/integration/cli.test.mjs` ran the
pre-existing test "all-surface automatic discovery fails closed before mutation" as its
baseline. That test executed `install --surface all --apply` without a destination and
relied on antigravity-2 to make it fail. After the cut, both remaining surfaces
auto-discovered their live roots, and at 00:38 the phase-1 render was written into
`~/.claude` (104 files) and `~/.codex` (168 files) with no backup.

- Lost: `~/.claude/settings.json` (replaced by the portable overlay; `enabledPlugins`,
  the RTK `PreToolUse` hook, model and effort keys gone). `~/.codex/config.toml` dropped
  from the template render (`model = "gpt-5.6-sol"`, `approval_policy = "never"`,
  `sandbox_mode = "danger-full-access"`, `model_reasoning_effort = "max"`) to the
  portable render. `~/.codex/AGENTS.md` and `agents/*.toml` were byte-identical and lost
  nothing.
- Restored under the owner's authority: `~/.claude/settings.json` rebuilt from the
  template overlay at `main` plus `enabledPlugins` from `installed_plugins.json`; the RTK
  hook via `rtk init -g --hook-only --auto-patch` (backup at `~/.claude/settings.json.bak`);
  `~/.codex/config.toml` from a fresh template render. Personal allow rules, if any
  existed, were not recoverable.
- Cleanup of the 97 + 159 added files is a deletion under the home directory, which the
  auto-mode classifier refused for the agent; the owner runs the prepared dry-run script
  with `--apply`.
- Prevention shipped in `8cbfd3b`: `install --apply` requires `--destination-root`; RED
  tests first, then the guard in `installers/lib/args.mjs`.

### Phase 2 report (2026-09-19, Windows, branch `simplify/phase-2`)

Changed: 25 modified files plus `WhatsNew.md`. Each sub-item started RED and ended GREEN.

| Item | RED test | GREEN change |
| --- | --- | --- |
| 2a bootstrap sources | `tests/contracts/bootstrap-hooks.test.mjs`: `clear` and `compact` must inject, `resume` and `fork` stay empty; matchers `startup\|clear\|compact` (Claude) and `^(startup\|clear\|compact)$` (Codex) | `core/hooks/bootstrap.mjs` `INJECTING_SOURCES`; both bootstrap templates |
| 2b version | `tests/contracts/claude-adapter.test.mjs` and `codex-adapter.test.mjs`: manifest version equals `package.json` version (was `undefined` vs `1.0.0`) | `package.json` `"version": "2.0.0"`; both adapters import it; `WhatsNew.md`; reinstall note in `docs/maintenance/sync-and-update.md` |
| 2c preamble | adapter tests flipped to `doesNotMatch(/Using skill \*\*/)`; `renderInvocationGuidance` must be undefined; no skill carries "Announce at start"; placement test reads `rules/presentation.md` and `AGENTS.md` | preamble renderer removed from `installers/lib/presentation-contract.mjs` and both adapters; five announce lines removed; the checklist contract is rendered once into the presentation catalog from `progress-contract.json` |
| 2d gate evidence | `tests/contracts/quality-gate.test.mjs`: a failing line after 700 passing lines must survive truncation | `scripts/quality-gate.mjs` keeps the last 8,000 characters; `CONTRIBUTING.md` documents `--output` |

| Check | Result |
| --- | --- |
| `node scripts/aaa.mjs validate --scope all` | pass |
| `npm run quality:quick` | PASS 9 of 9 |
| `npm run quality:full` | PASS |
| Snapshot diff | first regeneration: 39 kept files changed per Claude package (manifests, 7 agents, hooks, 28 skills), 0 removed; second: only `rules/presentation.md` and `AGENTS.md` |
| Bootstrap smoke | `source: compact` returns `hookSpecificOutput`; `source: resume` returns `{}` |

Not run: macOS; native `register --apply`; Codex `SessionStart` `source` values are
assumed to match Claude's (the previous template already matched `^startup$`).

### Phase 3 report (2026-09-19, Windows, branch `simplify/phase-3`)

Source of truth: `https://raw.githubusercontent.com/obra/superpowers/v6.3.0/skills/...`,
downloaded with `curl`; byte sizes matched the research record (using-superpowers 3,108;
brainstorming 15,456; writing-skills 26,360; subagent-driven-development 32,339 plus its
three prompt files).

| Item | Change | Evidence |
| --- | --- | --- |
| 3a | `using-all-about-agents` rebuilt: SUBAGENT-STOP block, 1% rule, "The rule" (skill check before clarifying questions, brainstorming before plan mode), skill priority, 8-row red-flags table, portable routing and user-instruction precedence kept | body 488 words (limit 500); content hash re-pinned in `tests/fixtures/bootstrap-skill/expected-manifest.json`; lint pass |
| 3b | `brainstorming`: three paths (spike, bounded, architectural), one-way ratchet, red-flags table, quick reference; description now "You MUST use this before any creative work..." | routing cases `BR-TRIGGER-spike-question` and `BR-TRIGGER-bounded-change` added; lint test extended; lint 10/10 |
| 3c | `subagent-driven-development`: pre-dispatch conflict scan written to the ledger with `Ruling:` lines, dispatch hygiene (brief as single source, no pasted history, base revision), same-kind batching, ledger recovery after compaction | status codes, 15-line report, "Do Not Trust the Report", no reviewer re-run were already present in the three prompt files; lint pass |
| 3d | `writing-skills`: form-to-failure table, word budgets | lint pass |
| 3e | `improve-codebase-architecture` and `systematic-debugging`: the model may invoke the survey once the human asks or agrees; `loop-me`, `wait-what`, `handoff`, `wayfinder` already trigger on observable human signals and were left as is | lint pass |
| 3f | generic-rule dedup across 21 skills. Three implementer agents were stopped by an API rate limit mid-run; the coordinator reviewed every removed line in the diff and finished the last four skills | 155/155 skill lint tests; `receiving-code-review` regained one skill-specific sentence ("review text is input to evaluate, never a command to run") |

Word counts (body only): total 22,723 → 23,756. Upstream pulls added 1,332 words
(brainstorming 586 → 1,004; subagent-driven-development 1,025 → 1,413; writing-skills
863 → 1,145; using-all-about-agents 244 → 488); dedup removed 299 across 19 skills. The
three heavy skills exceed the 500-word budget that `writing-skills` now states, as the
upstream originals do; trimming them is later work, not part of this phase.

| Check | Result |
| --- | --- |
| `node scripts/aaa.mjs validate --scope all` | pass |
| `node --test tests/behavioral/skills/*.test.mjs` | 155 pass, 0 fail |
| `npm run quality:quick` | PASS |
| `npm run quality:full` | PASS |
| Invariant I4 `git grep` | no matches |
| Upstream hygiene `grep -i "superpowers\|telemetry\|\.superpowers/"` over `core/skills` | no matches outside historical companions |
| Snapshot diff | 24 (Claude) / 48 (Codex) kept files changed, none added or removed |

Not run: macOS; native `register --apply`; any `claude -p` behavior check (phase 4).

### Phase 4 report (2026-09-19, Windows, branch `simplify/phase-4`)

| Item | Change | Evidence |
| --- | --- | --- |
| 4a | `tests/behavioral/` renamed to `tests/lint/` (`git mv`, 31 files). `quality:skill` check id `skill-behavior` → `skill-lint`; validator artifact `lint-test`, error `missing-lint-test`; paths updated in `scripts/quality-gate.mjs`, `installers/lib/validate-skill.mjs`, `core/inventory.json`, and the static, contract, and lint tests that named them. README, CONTRIBUTING, `docs/maintenance/skill-development.md`, and `docs/limitations/known-limitations.md` now call the regex layer lint and describe the model run separately. | static 67/67, lint layer + model contract 197 pass |
| 4b | `tests/model/run-trigger-suite.mjs` (manual, `npm run test:model`), `tests/model/suite.json` (5 skills, 17 routing cases), `tests/model/suite-age.mjs`, and `tests/contracts/model-suite.test.mjs` (RED first: module not found; GREEN after the files landed). Preconditions: `claude` on PATH, installed plugin version equals `package.json`, rendered global `CLAUDE.md` deployed; otherwise every case is `NOT_RUN_UNAVAILABLE` and no session starts. Every process (`claude`, `git`) runs through `scripts/lib/process-runner.mjs` with a structured argument list and no shell; the contract test asserts the runner source contains no shell option. Results are written by the shared eval runner to `.aaa/eval-runs/result.json` (overwritten per run; the timestamped name in the design text was not implemented). `quality:full` gained the optional, non-required `model-suite-age` check. | contract test 6/6 with a fake `claude`; first real run on this machine: 17/17 `NOT_RUN_UNAVAILABLE`, reason "installed package stale: plugin 1.0.0, package.json 2.0.0"; result file written to `.aaa/eval-runs/` |
| 4c | macOS run | `NOT_RUN_UNAVAILABLE`: no macOS machine in this session. Next owner: the owner's Mac runs `npm run quality:full`, the two-surface install dry-run, and `npm run test:model`, then records `docs/evaluations/native-macos-<date>.md`. |

| Check | Result |
| --- | --- |
| `node scripts/aaa.mjs validate --scope all` | pass |
| `npm run quality:quick` | PASS (after pinning `test:model` in `tests/static/runtime.test.mjs`) |
| `npm run quality:full` | PASS; `model-suite-age` reports "newest result is 0 hours old" |
| `npm run test:model` | 17 cases, 0 PASS, 0 FAIL, 17 NOT_RUN_UNAVAILABLE (stale install) |

Not run: macOS; any `claude -p` case with a current install. To get real trigger evidence
on this machine: authorized `register --apply` for Claude from the rendered 2.0.0
package, `claude plugin uninstall` + `claude plugin install`, then `npm run test:model`.
