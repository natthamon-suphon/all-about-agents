# all-about-agents vs obra/superpowers vs mattpocock/skills

Brainstorm input and evidence record behind [the simplification spec](2026-09-18-simplify-to-claude-codex.md).
Date: 2026-09-18. Analysis only; the spec holds the decisions and phases.

Evidence labels: **verified** = read from the file or API named. **inferred** = follows
from verified facts. **unknown** = not checked.

## 0. Decisions so far (brainstorm log)

| # | Question | Answer (user, 2026-09-18) | Effect |
| --- | --- | --- | --- |
| 1 | Audience | Personal use only, several machines, macOS + Windows | R7 closed: personal rules stay in `core/`; "portable" = one source for my machines. Cross-OS installer checks stay valuable. macOS is `NOT_RUN` everywhere, a real gap. |
| 2 | Weekly surfaces | Claude Code + Codex | R8 resolved: cut `adapters/antigravity-2`, `adapters/agy`, their manifests, templates, snapshots, compatibility docs, and tests. |
| 3 | Commands and workflows | Not used. Delete. | R3 resolved by deletion: remove `core/commands/`, `core/workflows/`, `core/roles/router.mjs`, `command.schema.json`, `workflow.schema.json` (887 lines). Dependents to clean: `checkpoint` hook (records `workflowId`), `emoji-registry.json` commands/workflows sections, `presentation-contract.mjs` command branch, `adapter-contract.mjs`, both adapters, manifests `actions` block, 13 test files. Skills carry the flow. |
| 4 | Enforcement style | Superpowers style: all skills model-invoked, strict gates, "1% rule" | Bootstrap grows toward upstream `using-superpowers` (1% rule, red flags table, skill check before clarifying questions, SUBAGENT-STOP). `startup\|clear\|compact` becomes required. C3 (`disable-model-invocation`) dropped; the 5 explicit-only skills get auto-trigger wording on clear signals instead. Content strategy: pull superpowers v6.3.0 + `dev`; take only skill content (`retro`, `pr`) from mattpocock, not mechanics. |
| 5 | Tests | Keep regex as "contract lint" + add a small `claude -p` suite | Rename `tests/behavioral/` to contract lint. Add headless Claude Code trigger / non-trigger / pressure runs for critical skills, run manually, kept out of `quality:quick`. First macOS run becomes required evidence. |

### Agreed direction (from decisions 1-5)

Phase order proposed; each phase is independently shippable and verifiable.

1. **Cut** (deletion only): `adapters/antigravity-2`, `adapters/agy`, their manifests,
   templates, snapshots, compatibility docs, evaluation records, tests; `core/commands`,
   `core/workflows`, `core/roles/router.mjs`, `command.schema.json`,
   `workflow.schema.json`; `quarantine/legacy`; superpowers authoring artifacts from
   `systematic-debugging` inventory assets. Clean every reference; run `quality:full`.
2. **Fix mechanics**: bootstrap on `startup|clear|compact`; single version source + bump
   script + `CHANGELOG.md`; remove the rendered preamble, keep the announce rule once in
   global rules.
3. **Pull upstream content**: bootstrap text from `using-superpowers`; brainstorming
   three-path router; SDD v6.3 diff against AAA's compressed SDD; "Match the Form to the
   Failure" into `writing-skills`; rewrite the 5 explicit-only skills for auto-trigger;
   move generic operating rules out of skills into `rules/`.
4. **Tests**: rename regex layer; add `claude -p` trigger suite for brainstorming, TDD,
   systematic-debugging, verification-before-completion; record a macOS run.
5. **Later, optional**: mattpocock `retro` and `pr`; evaluate installing the Claude
   package straight from the GitHub repo (marketplace) so the installer shrinks to
   global `CLAUDE.md`, `settings.json`, statusline.

ASSUMPTION MADE: keep both profiles (`portable`, `template`) and all 7 roles for now;
revisit after phase 1 shows the remaining size.

---

## 1. Where all-about-agents comes from (verified from `git log`)

| Date | Event | Evidence |
| --- | --- | --- |
| 2025-10-09 | Fork starts as "Initial commit: Superpowers plugin v1.0.0" | `dd013f6` |
| ... to 2026-07-23 | Tracks upstream superpowers through v6.2.0 | `3dcbd5c` "Release v6.2.0" |
| 2026-08-08 | Rebrand to All About Agents, 14 skills | `4e5a8a0` |
| 2026-08-15 | Merge a subset of mattpocock/skills (+10 skills), add `interviewing` | `8827c62` |
| 2026-08-28 | Add 7 roles, 4 more skills, cross-platform tooling | `a0abf1f` |
| 2026-08 to 2026-09-08 | Build installers, adapters, 4 surfaces, workflows, commands, profiles | ~40 commits |
| today | 809 commits, `main` clean, version string still `1.0.0` | `adapters/claude/adapter.mjs:481` |

So all-about-agents (AAA) = superpowers v6.2.0 skills + a mattpocock snapshot from
mid-August + a large installer and adapter layer that neither source has.

Upstream has moved since:
- superpowers `main` is v6.3.0 (2026-08-12). `dev` has ~16 commits on 2026-09-18 alone.
- mattpocock/skills is v1.2.3, last push 2026-09-18 (new `pr` and `retro` skills).

---

## 2. The three repos at a glance

| | all-about-agents | obra/superpowers | mattpocock/skills |
| --- | --- | --- | --- |
| Purpose (own words) | "portable, repository-only agent-system source" that renders packages for 4 tools | "a complete software development methodology for your coding agents" | "small, easy to adapt, and composable" skills; "work with any model" |
| Skills | 28 | 14 | 38 dirs, 25 promoted |
| Roles / agents | 7 (md + json, read-only tool lists) | 0 (prompt templates inside skills) | 0 |
| Workflows / commands | 6 JSON state machines, 8 commands | 0 | 0 |
| Hooks | 3 (bootstrap, checkpoint, activity-audit) | 1 (session-start bash) | 0 |
| Surfaces | 4 (Claude, Codex, Antigravity 2, agy) via a renderer | 13 harnesses via thin per-harness manifests; skills identical everywhere | Claude plugin + `npx skills add`; skills identical everywhere |
| Install | own installer: plan, atomic write, hashes, managed state, doctor, diff | `/plugin install` or per-harness one-liner | `/plugin install` or `npx skills@latest add` |
| Skill tests | 82 test files, 751 tests; "behavioral" tests are regex on SKILL.md prose | infra tests in bash/node; `claude -p` headless runs; external Drill evals (tmux, LLM verifier) | none; `claude plugin validate --strict` only |
| Routing | bootstrap skill injected at `startup`; native skill listing | bootstrap skill injected at `startup, clear, compact`; "1% rule" | `ask-matt` human-read router; `disable-model-invocation: true` on orchestrators |
| Volume | 5.9k lines skill md, 6.3k lines docs, 29k lines JS (tests 16.5k), 11.9k lines quarantine | 14 skills, largest 32 KB (SDD); RELEASE-NOTES 94 KB | tiny; largest skill ~11 KB; CHANGELOG via changesets |
| Dependencies | zero | zero (bash + node scripts) | 2 devDeps (changesets) |
| Stars | private fork | 288k | 265k |

---

## 3. all-about-agents today

### Architecture (verified)

- `core/` is vendor-neutral: skills, roles, rules (9), workflows (6), commands (8),
  hooks (3), presentation contract, JSON schemas, eval rubric and routing cases.
- `adapters/{claude,codex,antigravity-2,agy}` render `core/` into a package.
- `installers/lib/` plans, validates, writes atomically, keeps `state.json`, runs `doctor`.
- `profiles/{portable,template}` set model and permission policy.
- `tests/` = static, contracts, behavioral (regex), integration (CLI), snapshots.
- Bootstrap hook injects `using-all-about-agents/SKILL.md` (29 lines) on `SessionStart`
  with `source === "startup"` only (`core/hooks/bootstrap.mjs`).

### Skill style (verified)

- 26/28 skills use a numbered "Skill Gate Protocol".
- 22/28 say "not run". 17/28 say "untrusted data". 10/28 have "Red Flags".
- Average ~850 words per skill (23.7k words / 28).
- Every rendered skill, agent, and command gets a ~10-line preamble
  ("Using skill **X** ... Checklist ... Reason rule ... Checklist rules"),
  from `installers/lib/presentation-contract.mjs:183`.

### What AAA has that neither reference has (keep list, unless cost is too high)

- Read-only agent roles with `disallowedTools` (reviewer, verifier, security-reviewer).
- Rules as a separate layer (`rules/*.md`), not mixed into skills.
- Zero-dependency, schema-validated, deterministic render with snapshots.
- Installer safety: root containment, no symlink writes, dry-run default, ownership hashes.
- PreCompact checkpoint hook and `session-compaction-resilience` skill.
- Statusline with context usage.
- Honest status vocabulary (`NOT_RUN_UNAVAILABLE`) and native lifecycle terms.

---

## 4. obra/superpowers: what to learn

### 4.1 Changed since AAA last synced (v6.2.0 -> v6.3.0 + `dev`) (verified from RELEASE-NOTES and commits)

- **Brainstorming three-path router**: Spike / Bounded / Architectural. The artifact
  scales down, the approval gate never does. AAA still has a two-way gate
  (trivial read-only vs behavior change).
- **SDD**: continue on non-catastrophic conflicts, conflict scan in ledger, batch small
  tasks, reviewers re-read evidence rather than re-run tests. AAA's SDD keeps ledger and
  round mechanics (11 matches for ledger/rounds/status codes), but is 140 lines vs 32 KB
  upstream. Unknown which behaviors were dropped in compression.
- **`dev` branch**: bootstrap retained after native compaction, OpenCode V2,
  child-session lookup retries. Not released yet.
- New harnesses: Devin, Hermes, Grok Build. Not relevant unless you use them.

### 4.2 Distinctive ideas

1. **Bootstrap is the whole integration.** Only `using-superpowers` (3 KB) is injected.
   Everything else is pulled by the `Skill` tool. Porting guide: "Without it, the skill
   files are inert." AAA follows this model already.
2. **Fires on `startup|clear|compact`.** AAA fires on `startup` only. After `/clear` or a
   compaction the AAA session has no routing contract in context.
3. **Iron Law + rationalization table + red flags** as a fixed shape for pressure-skipped
   rules. Rows come from recorded baseline failures. CLAUDE.md forbids editing them
   without eval evidence.
4. **"Match the Form to the Failure"**: prohibition + table for pressure-skipping; positive
   recipe for wrong output shape; template with REQUIRED fields for omissions. AAA uses
   one form (numbered gate protocol) for every skill.
5. **Description = trigger, not summary.** "Use when [conditions]". AAA follows this.
6. **Word budgets**: <500 words per skill, <200 for frequently-loaded. Upstream violates
   its own budget (SDD 32 KB). AAA averages ~850 words.
7. **SDD prompt templates** with status codes DONE / DONE_WITH_CONCERNS / BLOCKED /
   NEEDS_CONTEXT, report under 15 lines, reviewer "Do Not Trust the Report", verdict first.
8. **Per-harness thin manifests**, no renderer. Skills are byte-identical on 13 tools.

### 4.3 How they test

- `tests/claude-code/`: run Claude Code headless, assert on output text
  (`assert_contains`, `assert_order`). Fast set ~2 min, integration 10-30 min.
- `tests/explicit-skill-requests/`: targets the "skill did not trigger" problem.
- External Drill harness: real tmux sessions on Claude Code, Codex, Gemini; LLM actor and
  LLM verifier. Not in CI.
- Pressure scenarios kept inside the skill folder (`test-pressure-1..3.md`).

---

## 5. mattpocock/skills: what to learn

### 5.1 Shape

- Buckets: `engineering/`, `productivity/` (promoted), `in-progress/` (beta, public on
  purpose), `misc/`, `deprecated/` (empty; retired skills are deleted, changeset names
  the replacement).
- Frontmatter: `name`, `description`, optional `disable-model-invocation: true`. Nothing else.
- Every skill has `agents/openai.yaml` for Codex. No renderer, no hooks, no tests.
- Per-repo setup writes `docs/agents/*.md` (issue tracker, domain, triage labels), so
  skills stay identical and config lives in the codebase.

### 5.2 Distinctive ideas

1. **User-invoked vs model-invoked split.** Orchestrators (grill-me, to-spec, implement,
   triage, ask-matt) carry `disable-model-invocation: true`: zero description tokens in
   context, cannot auto-fire, can call model-invoked skills, never the reverse.
   AAA has none of this field. AAA skills that are explicit-only by prose (loop-me,
   wait-what, handoff, wayfinder, improve-codebase-architecture) still load their
   descriptions every session and can still be auto-selected.
2. **Wording of the pointer is the trigger.** "Front-load the leading word."
3. **Grilling asks the whole frontier in one round**, numbered, each with a recommended
   answer. AAA `interviewing` asks exactly one question per message. This is a real
   design disagreement, worth deciding on purpose.
4. **Config is death.** Push mechanical standards into linters, pre-commit, CI, not into
   CLAUDE.md prose. `retro` skill converts session findings into deterministic checks.
5. **Flow**: grill-with-docs -> prototype -> to-spec -> to-tickets -> `/implement` per
   ticket in fresh context -> code-review (two axes: standards and spec, parallel
   sub-agents) -> commit.
6. **Skills are tiny.** `grill-me` is 157 bytes and just calls `grilling`.

### 5.3 mattpocock skills AAA did not take (verified against `core/skills/`)

ask-matt, code-review, diagnosing-bugs, domain-modeling, grill-with-docs, grilling,
grill-me, implement, prototype, setup-matt-pocock-skills, tdd, to-spec, to-tickets,
triage, wizard, teach, to-questionnaire, writing-for-agents, claude-handoff,
implement-spec, pr, retro.

Most overlap with an AAA skill (tdd, diagnosing-bugs, writing-for-agents, to-spec,
code-review). Non-overlapping candidates: `retro`, `pr`, `setup` pattern, `ask-matt`
style human router, `triage`.

---

## 6. Comparison in three buckets

**Drift** (upstream did it, AAA did not pull): three-path brainstorming; `clear|compact`
bootstrap; SDD v6.3 refinements; mattpocock `retro`, `pr`, bucket model, `disable-model-invocation`.

**Divergence** (AAA built it, neither source has it): 8.8k-line render and install
pipeline; 4 surfaces; 7 roles; 6 workflow state machines; 8 commands; profiles; rules
layer; presentation preamble; 16.5k lines of tests; A2 English and RTK rules in core.

**Residue** (inherited, still shipped): `quarantine/legacy` 11.9k lines; superpowers eval
scenarios (`CREATION-LOG.md`, `test-pressure-1..3.md`, `test-academic.md`) listed as
installed skill assets in `core/inventory.json`.

---

## 7. Findings

### 7.1 Remove or shrink (ranked by evidence strength)

**R1. "Behavioral" tests are regex on prose.** `tests/behavioral/skills/brainstorming.test.mjs`
asserts `/changes behavior or architecture/iu` against SKILL.md. `core/evals/rubric.json`
records gate-2 and gate-3 as `NOT_RUN_UNAVAILABLE`. `core/skills/writing-skills/SKILL.md`
says "Keyword presence can guard an interface, but cannot substitute for fresh decisions
under pressure." The repo contradicts its own rule. Options: rename the layer to
"contract lint" and stop calling it behavioral; or add real `claude -p` runs
(superpowers pattern) for trigger / non-trigger / pressure cases; or delete the regex
layer. 16.5k lines of tests is the largest code area in the repo.

**R2. Rendered preamble on every skill, agent, command.** ~10 lines x 43 artifacts.
The placeholder checklist ("Scope / Execute / Evidence") is not the 2-7 derived steps the
house rule asks for, so the model must still build a real one. The announce rule already
exists once in `global-operating-rules.md`, and 5/28 skills also carry "Announce at
start". Triple-stated. Superpowers states it once in the bootstrap. mattpocock never.
Candidate: drop the preamble, keep the rule in one place.

**R3. Commands point at workflows that are not shipped.** Rendered `commands/build.md`
says "Dispatch canonical action `aaa:build` through workflow `implement-change`" and
nothing else. The six `core/workflows/*.json` state machines (states, gates, transitions)
do not appear anywhere in the Claude package. Source-of-truth check at HEAD:
`installers/manifests/claude.json` has no `workflows` entry in `components` and no
workflow path in `ownedPaths` (only the semantic capability name `workflow-state`).
On the Claude surface the 8 commands are hollow. Either render the workflow body into the command, or delete commands and
workflows and let skills carry the flow (both reference repos do the latter).

**R4. Plugin version pinned to `1.0.0` for 809 commits.** `adapters/claude/adapter.mjs:481`.
The installed cache path is `.../all-about-agents/1.0.0/`. Verified against the memory
record `plugin-cache-staleness.md` (2026-09-02): "`claude plugin update` no-ops when the
version string is unchanged (1.0.0)". The same record notes Codex clones HEAD of a
package-local git repo and agy never prunes deleted files, so a version bump fixes only
the Claude case. Superpowers bumps nine files via
`scripts/bump-version.sh`; mattpocock uses changesets. Candidate: derive version from a
single source and bump per release; add a CHANGELOG.

**R5. Bootstrap fires on `startup` only.** `core/hooks/bootstrap.mjs` returns empty output
unless `source === "startup"`. Superpowers matches `startup|clear|compact`. After `/clear`
or compaction, AAA has no routing contract in context. One-line matcher change plus a
test.

**R6. Residue.** `quarantine/legacy` (11.9k lines) is fully recoverable from git history.
`systematic-debugging` ships five authoring artifacts as user-facing assets.

**R7. Personal rules inside the "portable" core.** `core/instructions/global-operating-rules.md`
renders "Always answer in simple English at CEFR A2 level" and a full RTK section into
CLAUDE.md on all four surfaces. Commit `9cd27d0` adds egroup rules to Claude only. If AAA
is personal, drop the word "portable" and the profile split. If AAA is for others, move
these into a personal overlay.

**R8. Four surfaces with a renderer vs daily use.** Memory files record: agy plugin-root
collision with Antigravity Desktop, silent codex/agy registration failure when off PATH,
cache staleness. Superpowers serves 13 harnesses with thin manifests and byte-identical
skills. The renderer buys per-surface tool-name mapping and role tool lists; it costs
8.8k lines plus snapshots per surface. Decision depends on which surfaces you actually run.

### 7.2 Change

**C1. Skill text repetition.** Generic operating rules (untrusted data, not run,
preserve unrelated work, no invented paths) are repeated inside most skills. Both
references state such rules once (bootstrap or CLAUDE.md) and keep skills to the
decision-changing content. Candidate: move generic rules to `rules/` and cut each skill
toward the superpowers budget. Also apply "Match the Form to the Failure" instead of one
gate-protocol shape for all 28.

**C2. Pull upstream v6.3.0 ideas selectively.** Three-path brainstorming (Spike /
Bounded / Architectural) fits AAA's "proportional" language better than the current
two-way gate. Check SDD v6.3 changes against AAA's compressed SDD.

**C3. Add `disable-model-invocation: true` for explicit-only skills.** loop-me,
wait-what, handoff, wayfinder, improve-codebase-architecture say "explicitly invokes" in
prose. `core/schemas/skill.schema.json` has `additionalProperties: false`, so the schema
and the Claude adapter need a field. Effect: fewer description tokens per session, no
accidental auto-fire.

**C4. Interviewing style.** AAA: one question per message. mattpocock: whole frontier in
one numbered round with recommended answers. Pick one on purpose, or make it a parameter
of the wrapper skill.

**C5. Roles, workflows, commands layer.** Verify whether anything executes
`core/roles/router.mjs` or the workflow JSON at runtime on any surface. If only tests
read them, they are documentation in JSON form.

### 7.3 Add candidates (decide after the audience question)

- A1. Real trigger tests: `claude -p` with `assert_contains` / `assert_order`
  (superpowers `tests/claude-code/`), plus an explicit-request set.
- A2. `disable-model-invocation` field (C3).
- A3. Bootstrap on `startup|clear|compact` (R5).
- A4. Three-path brainstorming (C2).
- A5. Version bump script + CHANGELOG (R4).
- A6. Buckets: promoted / in-progress / misc. All 28 AAA skills are marked "stable" in
  `core/inventory.json`; there is no beta lane.
- A7. From mattpocock: `retro` (session findings -> deterministic checks), `pr` body
  format, per-repo `setup` writing `docs/agents/*.md`.
- A8. From superpowers: "Match the Form to the Failure" table in `writing-skills`.

### 7.4 Keep

See section 3, "What AAA has that neither reference has". Read-only roles, the rules
layer, the installer's containment checks, and the honest status vocabulary are real
advantages. The question is only whether their current size is justified.

---

## 8. Questions for the brainstorm (ask in this order)

1. **Audience.** Is AAA for you alone, or for a team or the public? This decides R7, R8,
   and the "portable" framing.
2. **Surfaces.** Which of Claude, Codex, Antigravity, agy do you run every week?
3. **Commands and workflows.** Do you use `/aaa:build`, `/aaa:fix`, etc.? If not, R3 becomes a delete.
4. **Enforcement style.** Superpowers: mandatory gates, auto-trigger, "1% rule".
   mattpocock: opt-in orchestrators, model-invoked helpers. AAA sits between. Which do you want?
5. **Tests.** Keep regex as lint, add real model runs, or drop the layer?

---

## 9. Sources

Local (verified): `git log`, `core/**`, `adapters/claude/adapter.mjs`,
`installers/lib/presentation-contract.mjs`, `installers/manifests/claude.json`,
`tests/behavioral/skills/brainstorming.test.mjs`, `core/evals/rubric.json`,
`docs/limitations/known-limitations.md`, installed package at
`~/.claude/plugins/cache/all-about-agents/all-about-agents/1.0.0/`.

Superpowers (fetched 2026-09-18): README, CLAUDE.md, RELEASE-NOTES.md, hooks/hooks.json,
hooks/session-start, docs/porting-to-a-new-harness.md, docs/testing.md,
tests/claude-code/README.md, skills/*/SKILL.md for 9 skills,
subagent-driven-development/implementer-prompt.md and task-reviewer-prompt.md,
api.github.com repo and commit endpoints.

mattpocock/skills (fetched 2026-09-18): README, CLAUDE.md, CHANGELOG.md,
.claude-plugin/plugin.json, .agents/invocation.md, .agents/install-block.md,
.agents/adr/0002, skills/*/SKILL.md for 14 skills, writing-for-agents/SKILL-MECHANICS.md,
aihero.dev posts (5-agent-skills-i-use-every-day, my-grill-me-skill-has-gone-viral,
how-to-make-codebases-ai-agents-love), api.github.com repo and commit endpoints.

Not verified: exact upstream line counts (byte sizes only); Drill eval repo; superpowers
marketplace repo; whether AAA's compressed SDD dropped specific v6.2/6.3 behaviors.
