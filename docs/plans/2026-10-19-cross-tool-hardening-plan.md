# Cross-tool hardening implementation plan

Design: [accepted design](2026-10-19-cross-tool-hardening.md).
Execution authority: the owner said to complete everything after the written
design was presented. This authorizes scoped repository implementation and
verification, not Git history changes, live installation or registration.

## Goal, architecture and constraints

Implement the seven accepted recommendations at the existing adapter,
profile, hook, installer and documentation boundaries. Keep zero dependencies,
portable profiles, emergency denies, unowned configuration and existing user
changes. Use native paths and structured subprocess arguments. Model changes
apply to new managed sessions, not an active conversation. Unsupported native
interfaces must return an explicit unavailable result, not guessed success.

Pre-mortem: native catalogs can change shape; an IDE can offer fewer models;
model version ordering can cross into a weaker family; plugin updates can
erase package-local history; Windows shims need different execution from POSIX.
Keep catalog parsing bounded, eligibility explicit, state outside packages,
history import non-destructive, and platform tests independent of native claims.

One coordinator owns all production and test writes. Parallel owners are
read-only researchers for GUI model interfaces and companion coexistence.
Independent review follows implementation. Use the existing ignored topic
directory for commands, evidence and continuation state.

## Task 1: JSON registration

Files: `installers/lib/native-registration.mjs`,
`tests/contracts/native-registration.test.mjs`.
Interface: `planNativeRegistration(input)` returns the existing action list;
`antigravity-plugin-list` must request JSON, and `runNativeRegistration` must
still reject malformed output. No mutation in dry-run.

1. Add a focused action/runner regression which distinguishes native human
   output from `--json` output.
2. Run `node --test --test-name-pattern="Antigravity.*JSON" tests/contracts/native-registration.test.mjs`.
   Expected RED: missing JSON argument causes the registration probe to fail.
3. Add the argument at the producing action; keep the parser strict.
4. Run the same test, then the whole registration contract test. Expected GREEN.

## Task 2: Full-access template agents

Files: Claude/Codex adapter role renderers, their capability records and
contract tests; profile tests as needed; matching snapshots.
Interface: resolved profile is passed into native role rendering. Template
roles inherit approved parent tools/permissions/model; portable keeps its
controlled policy. Role purpose and assignment scope are unchanged.

1. Add assertions at rendered native role boundaries for both profiles.
2. Run focused adapter tests. Expected RED: template still limits native tools
   or emits misleading per-role sandbox overrides.
3. Change only profile-dependent rendering and claims. Retain emergency denies.
4. Run focused adapter/profile tests. Expected GREEN; record native inheritance
   as unverified until actually observed.

## Task 3: Durable audit/checkpoint state

Files: new `core/hooks/state-path.mjs`, Claude/Codex wrapper generators,
installer manifests, audit/checkpoint contracts, installer tests and snapshots;
new `scripts/migrate-hook-state.mjs` and focused migration contracts.
Interfaces: `resolveHookDataRoot(surface, options)` returns a safe native data
directory or unavailable status; migration dry-run produces bounded copy
actions, apply preserves source files and refuses destination conflicts.

1. Add a rendered-handler test using separate package and native data roots,
   execute two package versions, and assert history survives replacement.
2. Run focused audit/checkpoint tests. Expected RED: state is package-local.
3. Implement shared path validation, render the helper, and move wrapper state
   writes. Missing/unsafe roots skip optional writes with a bounded diagnostic.
4. Add RED then GREEN import tests for repeatability, byte bounds, traversal,
   links, existing different targets and source preservation. No live import.
5. Run audit/checkpoint and migration contracts; update owned output snapshots.

## Task 4: Automatic model selection for managed sessions

Files: new `scripts/model-policy.mjs`, new focused model-policy tests, existing
process runner only if its public execution seam needs stdin, package scripts,
and adapter model policy/guidance. Native discovery and selection stay apart.
Interfaces: pure selection consumes validated product metadata and requested
family/effort and returns supported model/effort or explicit unavailable.
CLI entry performs bounded native discovery, prints a dry-run plan by default,
and launches only on an explicit launch action. Never mutate live config as a
side effect of a read-only check. Forward native arguments as an array.

1. Verify exact native catalog, effort and selection contracts. Prefer Claude
   aliases; Codex `model/list` upgrade metadata; `agy models` for CLI.
2. Add RED tests for upgrade chains, cycles, unavailable effort, hidden models,
   unknown/malformed catalogs, family preservation and cross-runtime exclusion.
3. Implement the smallest native-first resolver and managed CLI launch path.
4. Test argument forwarding, subprocess failure, bounds/timeouts and Windows
   executable lookup. Explicit GUI unavailable results remain truthful unless
   research establishes a supported control interface.
5. Run the focused model-policy contracts. Record what automatic means and
   which launch routes it covers; do not claim direct GUI launches are managed.

## Task 5: Compatibility, settings and companions

Files: three compatibility pages and capability records, relevant adapter
guidance, both setup pages, companion guide, maintenance verification guide,
cross-tool quality guide, Antigravity research note and CI matrix.

Refresh current contracts with primary citations. Preserve working discovery
roots, inlined routing and managed-block boundaries. Correct SessionStart and
statusline claims; do not add duplicate hooks. Keep undocumented settings
distinct from proven invalid keys and preserve operator-owned values. Add
all seven companion responsibilities and verified conflict/installation
limits. Include Antigravity in the explicit Windows/macOS clean-profile CI job.

Verify docs using `node --test tests/static/documentation.test.mjs
tests/static/capabilities.test.mjs tests/static/maintenance-docs.test.mjs`;
configuration-only changes receive schema/render checks, not artificial TDD.

## Task 6: Integration, independent review and final evidence

Run focused tests first, then `npm run sync:status`, `npm run quality:quick`,
and `npm run quality:full`. Inspect direct failures before proposing fixes;
do not increase timeouts without a demonstrated root cause. Review the entire
scoped working diff independently, including permissions, data migration and
native subprocess boundaries. Fix findings and rerun affected checks.

Native checks use disposable roots and exact versions. Actual macOS execution,
GUI model application, trust and paid model behavior remain not run when the
host/capability/authority is unavailable. Preserve the lifecycle and never
promote static render evidence to native runtime success. Record exact changes,
commands, results, baseline/user work, branch/SHA and remaining mandatory gaps.

## Plan self-review

All seven approved recommendations map to tasks. Dependencies are serialized:
registration, role rendering, hook state, models, docs, integration. There is
one writer. No dependency, installation, commit, push, daemon or GUI automation
is added implicitly. Research gaps are explicit acceptance limits, not stubs
or invented APIs. The owner-directed execution continues without another
approval request for the same accepted scope.
