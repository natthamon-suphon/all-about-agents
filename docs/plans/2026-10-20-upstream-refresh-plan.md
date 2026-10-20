# Upstream Refresh Implementation Plan

Status: Authorized for execution. The human accepted the written design and
explicitly delegated planning and execution without a second approval question.

**Goal:** Refresh AAA from ready upstream workflows and prove the portable package contracts.
**Architecture:** Keep the canonical core, three adapters and managed installer. Reuse owned helpers and merge overlapping workflows.
**Stack:** Node.js >=22.12.0, standard library, portable Markdown/JSON; no new dependencies.
**Spec:** [approved design](2026-10-20-upstream-refresh-design.md)
**Research:** [pinned source comparison](2026-10-20-upstream-research.md)
**Execution:** Sequential subagent-driven tasks with independent review; coordinator owns integration and final verification.

## Global Constraints

- Preserve pre-existing dirty work recorded under `.aaa/upstream-refresh-2026-10-20/`.
- No commit, push, merge, installation, native registration or live settings changes.
- Preserve model/effort/access policy, emergency denies, session language, brevity, minimal comments and Karpathy integration.
- Keep every change portable across Windows and macOS. Use structured process arguments and verified paths.
- Sources are Superpowers `bb92a77741419a4ab5f06e711a283343f1ada0c3` and Matt `5beb35b040e3de97e54fa9e386d7e42d15c295c2`; do not execute downloaded upstream code.
- Maintain 31 canonical skills after Task 4. No duplicate TDD, review, debugging or execution frameworks.
- Record intended RED, observed GREEN, independent review and unavailable checks. Static prose assertions are lint, not model behavior.
- Use the inherited user-selected model for workers and reviewers. No model override or cheaper substitution.

## Review Focus

- Running helpers from a rendered package must not depend on the source checkout.
- A successful command with no output still completes; failure or launch error never completes.
- A brief carries the spec and global constraints even when task headings appear inside fenced examples.
- New skill selection must preserve natural-language requests and explicit user-intent boundaries.
- Transcript evidence can contain huge records and secrets; diagnosis reads bounded scoped fields and does not export.

## Task graph and ownership

Tasks run in order because they share inventory and release output. Each writer
owns only its listed source area and matching tests. The coordinator owns this
plan, the ledger and review reports. No overlapping writers run together.

### Task 1: Portable execution evidence helpers

**Files:** `core/skills/subagent-driven-development/scripts/{task-brief,review-package,sdd-workspace}.cjs`, new `core/skills/executing-plans/scripts/{task-start,task-done}.cjs`, their inventory script entries, and focused tests under `tests/` that exercise these helpers.

**Interfaces:**
- Consume existing `sddPath`, `ensureSddDir`, `customOutPath`, `writeOutFile` and current task-brief/review-package CLI contracts.
- Produce `node task-start.cjs PLAN_FILE N`: a brief path and base tree/revision, with no commit/ref/index changes.
- Produce `node task-done.cjs PLAN_FILE N BASE -- EXECUTABLE [ARGS...]`: run an argument vector, retain bounded evidence, record completion only on exit 0; preserve the failing status otherwise.
- Brief output includes its task, exact spec pointer and Global Constraints; code fences cannot create fake task boundaries.
- Committed review ranges require ancestry and nonempty changes; `WORKTREE` and tree snapshots remain supported.

- [ ] Add executable regression tests before code. Cover silent success, failure, launch error, spaces/Unicode/metacharacters, unsafe links, invalid task/base and unchanged user index.
- [ ] Run the focused helper tests. RED must be a missing behavior assertion, not a malformed fixture.
- [ ] Extend the existing owning helper. Add Node entry points, safe output/ledger rules, interpreter-based instructions and inventory delivery. Do not add shell interpolation or a second workspace format.
- [ ] Run `node --test tests/contracts/execution-helpers.test.mjs tests/lint/skills/subagent-driven-development.test.mjs`. Run `node scripts/aaa.mjs validate --scope all`.

### Task 2: Intent-first design and decision-rich planning

**Files:** `core/skills/{brainstorming,interviewing,writing-plans,using-all-about-agents,writing-skills}/`, their matching files under `tests/lint/skills/` and `core/evals/skill-routing/`, relevant inventory companion entries.

**Interfaces:** User request -> proportional route, full description/design -> builder questions -> approved decisions -> executable plan. No implementation during planning. Small clear authorized changes do not require a document or extra approval.

- [ ] Add routing/pressure cases and focused lint assertions for intent-first discovery, quick/small/project paths, builder checks, skip-interview boundary, Review Focus and lean steps.
- [ ] Run `node --test tests/lint/skills/brainstorming.test.mjs tests/lint/skills/interviewing.test.mjs tests/lint/skills/writing-plans.test.mjs tests/lint/skills/using-all-about-agents.test.mjs tests/lint/skills/writing-skills.test.mjs`; record intended RED.
- [ ] Refresh bodies and owned companions from pinned sources. Remove the superseded spec/plan reviewer companions only with all references/inventory entries updated. Retain native-neutral routing and existing safety boundaries.
- [ ] Rerun that command and `node scripts/aaa.mjs validate --scope all`. Record body word counts and missing model runs.

### Task 3: Continuous execution and two-axis review

**Files:** `core/skills/{executing-plans,subagent-driven-development,requesting-code-review,test-driven-development,systematic-debugging,verification-before-completion}/`, matching lint tests/eval cases and owned inventory entries.

**Interfaces:** Approved plan + method -> task ledger + rulings + verification; change package + standards + spec -> separate Standards/Spec verdicts and explicit declined judgments. Public-seam tests -> focused proof -> relevant project suite.

- [ ] Add focused cases for continuous inline work, safe rulings, no inferred external/Git authority, full relevant suite evidence, authentic repro and realistic unlisted inputs.
- [ ] Run the six matching `tests/lint/skills/<name>.test.mjs` files and record intended RED.
- [ ] Refresh skills and templates. Reference Task 1's delivered helpers. Preserve sequential writers and native inherited-context/model constraints. Reuse the current good-test reference; do not rewrite correct guidance.
- [ ] Rerun focused tests and core validation. Review worker/reviewer prompts together for contradictions and omitted global constraints.

### Task 4: Four new portable skills and complete portfolio

**Files:** new `core/skills/{domain-modeling,pr,retro,diagnosing-agent-workflows}/`, their routing cases and lint tests, `core/inventory.json`, `core/schemas/inventory.schema.json`, `core/presentation/emoji-registry.json`, and count/manifest tests directly affected by the portfolio.

**Interfaces:**
- `domain-modeling`: resolved domain terms/decisions -> lazy glossary/ADR, never an automatic legacy-file deletion.
- `pr`: authorized drafting request -> template-aware Summary/Evidence/Merge Danger; no publication.
- `retro`: explicit retrospective request -> ranked environment findings; no automatic live changes.
- `diagnosing-agent-workflows`: scoped request + verified transcript/evidence path -> bounded local path:line findings; unavailable discovery stays unavailable; no export or invented metrics.
- Canonical inventory/schema -> 31 source-backed skills and deterministic rendering on all surfaces.

- [ ] Define trigger, neighbor nontrigger and pressure cases first. Run focused tests for the four new skills to observe missing-contract RED.
- [ ] Add concise complete bodies and only their required companions. Preserve source licenses and Matt/Dex PR attribution. Update inventory/schema/presentation together.
- [ ] Run the four focused lint tests, `node scripts/aaa.mjs validate --scope all`, and `node --test tests/contracts/core-loader.test.mjs tests/contracts/complete-skill-manifest.test.mjs`.
- [ ] Confirm rendered packages carry every linked asset and do not change invocation metadata.

### Task 5: Traceable upstream baseline and release integration

**Files:** new `core/upstreams.json`, a focused provenance contract test, narrow refreshes in `core/skills/{codebase-design,improve-codebase-architecture,handoff,session-compaction-resilience,wayfinder,finishing-a-development-branch}/` and their existing owned tests/cases as needed, README/maintenance docs, `package.json`, and generated snapshot JSON files.

**Interfaces:**
- Provenance record contains `schemaVersion`, `checkedAt`, exact upstream IDs/URLs/tag/version/commit and one disposition/source-path/adaptation entry for every canonical skill.
- Record consumers validate coverage and safe source references without network access during load/render/install.
- Release metadata derives from package version `2.4.0`; snapshots come from current renderers, not hand-authored hashes.
- Existing companion tooling, global defaults and pre-existing web-document changes remain intact.

- [ ] Add a focused provenance test: missing skill, duplicate/unknown source, malformed revision and empty adaptation decisions must fail. Observe RED against the missing record.
- [ ] Write provenance and the maintenance update guide. Make only evidenced companion/reference refreshes in existing skills; audit unchanged skills and record deliberate retention.
- [ ] Update version/counts/docs and regenerate all three surfaces/both profiles with the existing renderer seam. Check deterministic output, ownership and links.
- [ ] Run the provenance test, focused tests for any changed retained skills, `node --test tests/static/documentation.test.mjs tests/static/maintenance-docs.test.mjs`, and core validation.

### Task 6: Model evidence and final qualification

**Files:** `tests/model/suite.json`, `tests/model/run-trigger-suite.mjs`, `tests/contracts/model-suite.test.mjs`, model cases if needed, final evidence under `.aaa/upstream-refresh-2026-10-20/`, and factual qualification notes in the approved research/design/maintenance documentation.

**Interfaces:** Changed-skill scenarios -> honest routing/action evidence, distinct from self-reported trailers. Quality report -> actual required-check results, optional/unavailable native/model checks preserved.

- [ ] Extend manual suite coverage for material routing changes and new skills. Add focused model-scoring tests before changing scoring behavior. Do not manufacture model PASS from lint or a trailer alone.
- [ ] Inspect authenticated CLI/current-package prerequisites without changing them. Support a temporary current rendered plugin through the verified `--plugin-dir` flag when this avoids installation; require tool-use/load evidence instead of a trailer-only PASS. Run real isolated behavior checks when available; otherwise record the exact missing prerequisite and `lint-verified, model run pending`. No installation is authorized by this plan.
- [ ] Run `npm run sync:status`, `npm run quality:quick`, `npm run quality:full`; retain JSON reports. Dirty sync exit 1 is expected and distinct from a failed quality check.
- [ ] Obtain independent whole-change review, repair blockers and rerun only affected checks plus final required gates after material fixes.
- [ ] Verify branch/HEAD/index, preserved work, complete ownership, and no live/Git actions. Report exact results and remaining model/macOS/native limitations.

## Self-review

The six tasks cover the approved goals, routing, helpers, new portfolio,
provenance, release integration and qualification. Shared inventory writes
are ordered. Every implementation task has a RED/GREEN seam and an independent
review gate. No commit or live-system step is hidden in execution.
Runtime implementation bodies belong to the implementer. This plan fixes
interfaces, values and evidence rather than prewriting the program.
