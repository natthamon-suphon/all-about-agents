# Cross-tool hardening and automatic model selection

Status: owner authorized repository implementation; verification in progress.
Date: 2026-10-19.
Working branch: `main`, commit `179b5ab6ce3e5e848de77c22a50ef7426a992609`.
Continuation record: `.aaa/compatibility-audit-2026-10-19/snapshot.md`.

The owner later said to complete everything. The executable plan is
[cross-tool hardening implementation](2026-10-19-cross-tool-hardening-plan.md).
The design below records the original decision context. Supported repository
work has proceeded; automatic App/IDE model control remains an unresolved
requirement, not an accepted reduction in scope. Current execution evidence is
kept in `.aaa/compatibility-audit-2026-10-19/execution.md`.

## Approved intent and remaining decision

The owner approved the seven recommendations in the current conversation:
correct Antigravity registration; correct agent permission claims; move hook
state out of installed packages; refresh compatibility evidence; review settings
and duplicate loading; document companion coexistence; and verify behavior.

The owner explicitly chose full-access agents, Windows and macOS support,
Extra High reasoning, and automatic changes to newer models. In a later direct
answer the owner accepted the highest supported native effort when `xhigh` is
unavailable, with the actual value reported per tool. These preferences
do not authorize Git history changes, plugin installation, native registration,
trust changes, or writes to live product configuration in this work session.

The remaining design decision is the supported boundary of automatic model
selection. No verified public configuration or control API has yet been found
that makes both Antigravity App and standalone IDE always select the newest
eligible model. This is an implementation blocker for that requirement, not
evidence that those products can never provide it. The owner must accept a
bounded first implementation or identify another supported integration before
the project can promise automatic selection on all requested products.

The effort decision is now resolved. Antigravity CLI documents `high`, not
`xhigh`; the owner accepted the highest supported native effort when `xhigh`
is unavailable. This does not permit choosing `low` or `medium` when `high`
is available, or claiming that different effort scales are equivalent. Native
evidence must establish the supported scale before applying the exception.

## Scope and architecture

Extend the existing `core`, profile, adapter, installer, and quality-gate
boundaries. Do not add another plugin framework. Keep the current three render
surfaces: `claude`, `codex`, and `antigravity`. Track native results separately
for Claude Code, Codex CLI/Desktop, Antigravity App, Antigravity IDE, and `agy`.
One rendered Antigravity package does not prove identical runtime capabilities.

Use `template` for the owner's full-access configuration. Keep `portable` as
the existing controlled, model-preserving alternative. Task assignment and
native permissions are separate: a reviewer can inherit full native access
while its assigned task still permits inspection only.

No new runtime dependency is needed for registration, permission rendering,
hook-state paths, documentation, or tests. A new model-selection integration
must use a documented native interface and structured arguments, not private
credential extraction, guessed settings, or a shell-generated command.

## Two approaches and trade-off

1. **Native selection first.** Use official model aliases when available and
   native model discovery where it exposes the required metadata. Validate
   selected model and effort before a managed launch. Stop or preserve the
   existing selection when evidence is insufficient. This keeps the repository
   small, but cannot promise automatic selection in an app with no verified
   control interface.
2. **A repository model-selection service and managed launchers.** Discover
   models, rank eligible releases, prepare a config change, and launch through
   a repository entry point. This can add automatic selection for verified CLI
   paths. It adds state and maintenance, and still does not control sessions
   opened directly from unsupported App/IDE interfaces.

Recommend approach 1, with a small managed CLI resolver only where native
aliases do not cover the approved behavior. Do not add a background daemon,
scheduled automation, generic web scraper, or GUI click bot as an inferred part
of this request. A launcher alone cannot support the word "always" for sessions
opened outside that launcher.

## Verified model and effort facts

- Claude Code's `opus`, `sonnet`, and `haiku` aliases update within their
  families; resolution depends on provider and client version. The Anthropic
  API currently resolves `opus` to Opus 5.5. Fable 5.1 is documented as more
  capable for long work, but can use separately billed usage credits. Newest
  release and greatest capability are not the same ordering. Preserve the
  existing Opus primary/Fable advisor policy unless the owner chooses a change
  of primary family. Use the alias for the approved family rather than a stale
  version pin. Keep `CLAUDE_CODE_EFFORT_LEVEL=xhigh`; native fallback to a lower
  supported effort must be reported rather than called Extra High.
  Sources: [model configuration](https://code.claude.com/docs/en/model-config),
  [advisor](https://code.claude.com/docs/en/advisor).
- Official OpenAI Docs recommends `gpt-6.1-sol` when available. The config
  reference accepts model-dependent reasoning effort such as `xhigh`, `max`,
  and `ultra`. The owner requested `xhigh`, so do not silently raise it to Max
  or Ultra. A literal model ID remains pinned. A missing `model` uses the
  native recommended model; that is not proof of the newest available release.
  Do not invent a `latest` model ID or equate a local cached catalog with a
  current account entitlement.
  Sources: [models](https://learn.chatgpt.com/docs/models),
  [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).
- Codex App Server documents `model/list`, paginated model records, supported
  reasoning efforts, `isDefault`, and optional `upgrade` metadata. These are a
  supported candidate for a Codex resolver. Follow documented initialization;
  read all bounded pages; reject cycles, missing upgrade targets, hidden or
  effort-ineligible targets. A recommended upgrade is a vendor migration
  recommendation, not a verified chronological release ordering. Catalog
  freshness and local-client behavior still need a focused native probe before
  implementation promises. Do not run a model turn just to list models.
  Source: [Codex App Server](https://learn.chatgpt.com/docs/app-server).
- Antigravity currently documents Gemini 4 Argon for App and CLI, with an
  explicit exclusion for the standalone IDE. On this Windows host, `agy models`
  exited 0 and listed `gemini-4-argon-high`, `claude-opus-5-5-high`, and other
  variants. This proves CLI catalog discovery only. The CLI documents `--model`
  and `--effort high`; do not pass an invented `xhigh` value. App/IDE controls
  require separate evidence.
  Sources: [models](https://www.antigravity.google/docs/models),
  [headless CLI](https://www.antigravity.google/docs/cli/headless).

Automatic selection must define eligibility before ordering versions: product,
provider, account availability, approved model family/tier, release status,
and supported effort. Do not sort all model names and select the largest
version number: a newer Flash model or an IDE-ineligible model can win that
sort. Treat unrecognized metadata as unsupported. Never silently switch to a
smaller family, unsupported effort, or a different provider to conceal failure.
Apply an accepted change before a new session; leave active sessions alone.

## Changes at the existing boundaries

### 1. Registration JSON contract

Modify `installers/lib/native-registration.mjs:planNativeRegistration` so the
`antigravity-plugin-list` process action supplies `plugin list --json`, matching
its existing `expectedProbe: "json"`. Keep `probeOutput` strict. A malformed,
truncated, or non-JSON response must still fail. Do not change plugin staging
roots merely because documentation differs from this host's observed layout.

Proof: a contract assertion on the action argument array, plus a registration
test whose fake `agy` returns human text without `--json` and JSON with it.
Verify the same behavior through the public registration runner. Dry-run must
not invoke the process. Preserve all existing containment and source-hash tests.

### 2. Full-access template agents

Modify the Claude and Codex role renderers to receive the resolved profile.
For `template`, Claude roles inherit the parent's tools, model, and approved
full-access permission context rather than emitting per-role tool deny lists.
Codex roles inherit the parent policy rather than emitting misleading local
`read-only` or `workspace-write` overrides. Verify the installed client's
documented role fields before deciding the final syntax. Antigravity roles
must use verified inheritance fields and exact native tool names only.

Keep role purpose, assignment scope, canonical semantic contracts, and the
portable profile's controlled behavior. Update capability records and prose
that conflate a read-only assignment with a host-enforced sandbox. Retain
emergency denies. Full access does not authorize unrelated changes or Git
operations.

Proof: render all seven roles under both profiles; assert inheritance for
`template`, preserved controlled behavior for `portable`, unchanged emergency
deny policy, and no claims that prompt text enforces native isolation. Use
harmless disposable-file probes for native permissions when a supported,
authenticated product session is available.

### 3. Durable hook data

Claude state belongs below `CLAUDE_PLUGIN_DATA`; Codex state belongs below
`PLUGIN_DATA`. Bundled executable code remains under the installed plugin root.
The native data directory, rather than package version, owns audit/checkpoint
history. Use one shared resolver at `core/hooks/state-path.mjs`, rendered into
both packages, so wrappers do not implement separate path policies.

The resolver accepts a surface and an environment object. It returns a verified
absolute native data root or an explicit unavailable result. Reject a relative,
empty, linked, or package-contained destination; account for canonical macOS
temporary-directory ancestors. Missing or invalid paths make the optional
handler skip with a bounded diagnostic. Never fall back to the current working
directory or installed package. Preserve bounded stdin, audit redaction, and
retention behavior.

Do not delete legacy package-local history. Keep migration review separate from
runtime writes: detect exact legacy `hooks/audit` and `hooks/checkpoints` roots,
report them, and provide a dry-run import from regular owned files into a
separate legacy area under the native data directory. Import requires explicit
application authority; use hashes to avoid duplicates, preserve source bytes,
reject links/traversal, bound files and bytes, and never overwrite an existing
different file. A missing native data root prevents import.

Proof: materialize two package versions with the same data root and execute
their rendered handlers. Earlier entries must remain present. Assert no writes
under either package, no secrets in records, and safe behavior for missing data
variables, malformed input, links, destination collisions, and repeated import.
Sources: [Claude plugin data](https://code.claude.com/docs/en/plugins-reference),
[OpenAI plugin data](https://developers.openai.com/plugins/build/plugins).

### 4. Current compatibility and both operating systems

Update adapter guidance, capability records, compatibility pages, and native
verification instructions together. Google now documents `SessionStart` for
App/CLI/IDE; remove the old claim that the event does not exist. Keeping the
inlined routing contract can still be a valid design. Do not add a duplicate
bootstrap just because the event is available. `PreCompact` is not established
for Antigravity, so do not fabricate a checkpoint event.

Keep Codex `commandWindows` changes already present in the working tree.
Verify PowerShell and POSIX argument expansion with spaces and Unicode. Keep
the native CLI statusline separate from Desktop/IDE UI claims. Preserve App,
IDE, and CLI discovery evidence separately, including the current unresolved
IDE custom-subagent documentation scope.

Reuse `.github/workflows/installer-matrix.yml`, which already runs Windows and
macOS. Include Antigravity in its explicit clean-profile installer list. Run
actual macOS checks in CI or on a Mac; path simulation on Windows is not a Mac
runtime result. Never label an unobserved CI run passing.
Sources: [Google hooks](https://www.antigravity.google/docs/hooks),
[Google subagents](https://www.antigravity.google/docs/subagents).

### 5. Settings and automatic model policy

Use a documented global-settings overlay for model, permissions, reasoning,
memory, and supported UI preferences. Plugin metadata carries discoverable
components, not arbitrary global preferences. Preserve unowned settings and
existing companion hooks. Review `autoDreamEnabled` as undocumented in the
retrieved reference, not as proven invalid; do not erase an operator-owned
value on that evidence alone.

An automatic resolver must have a pure selection seam consuming a validated
product-specific catalog and policy. It returns either a supported model/effort
selection with evidence or an explicit unavailable/conflict result. Catalog
acquisition and native application remain adapter-owned. Network failure,
unknown schema, unavailable entitlement, or unsupported effort never writes
partial config. Reject concurrent stale writes and preserve unowned fields.
No live write is part of a render, doctor, ordinary dry-run, or quality check.

Before this resolver is scheduled for implementation, establish the supported
catalog and selection interfaces for each product. For App/IDE, absence of
that evidence blocks the automatic-selection portion. Do not create an
apparently successful generic implementation around guessed native APIs.

### 6. Seven companion tools

Update `docs/setup/companion-tooling.md` for `ui-ux-pro-max`, Ponytail, Caveman,
Context7, RTK, `andrej-karpathy-skills`, and `frontend-design`. Inspect installed
entry instructions or first-party sources before claiming compatibility.

Keep ownership clear: this repo routes and verifies work; UI/UX Pro Max owns UI
analysis; frontend-design owns interface craft; Ponytail guides simplicity;
Caveman guides chat compression; Context7 supplies current library references;
RTK filters command output; Karpathy skills supply coding discipline. Explicit
user instructions and task correctness take precedence over style guidance.
Do not activate UI-building skills while auditing configuration. Do not vendor
these packages or install duplicate copies as dependencies of this repo.

Record name/command collisions, competing bootstrap carriers, hook ownership,
and per-product support. A missing companion is unavailable, not a repo test
failure. Keep static package coexistence, loading, and actual behavior as
separate evidence levels. Update stale Caveman hook claims from current
upstream or installed bytes before retaining installation examples.

### 7. Verification and completion evidence

Start each behavioral change with a failing test at its public seam. Record
focused results before broad gates. The previous suite was interrupted; it
does not establish either a repository failure or a pass. Investigate the
specific slow test/process before changing a timeout or asserting a root cause.

Expected touched tests include registration, per-surface adapter and installer
tests, `tests/contracts/audit-checkpoint.test.mjs`, profile contracts, rendered
snapshots, and static documentation/capability checks. Add a focused model-policy
test only once the catalog/selection contract is established. Do not add tests
that merely duplicate a prose claim of native success.

Run `npm run sync:status`, focused `node --test` commands, `npm run quality:quick`,
and `npm run quality:full`. Record exact commands, exit codes, counts, and
evidence paths. If a skill body changes, use `writing-skills` and its model
behavior checks. No skill-body change is needed merely to refresh an adapter
reference.

Native evidence must use the ordered lifecycle `rendered`, `validated`,
`registered`, `trusted`, `active`, `runtime verified`. Record unavailable
products, macOS hardware, authentication, and GUI automation as
`NOT_RUN_UNAVAILABLE`. Full completion requires the owner-approved automatic
model scope to be satisfied; documentation of a limitation alone does not
satisfy an unrelaxed mandatory requirement.

## File ownership map for implementation planning

| Boundary | Files |
| --- | --- |
| Registration | `installers/lib/native-registration.mjs`; `tests/contracts/native-registration.test.mjs`; `tests/integration/native-registration.test.mjs` |
| Role and profile rendering | `adapters/claude/adapter.mjs`; `adapters/codex/adapter.mjs`; `adapters/antigravity/adapter.mjs`; `profiles/profile-contract.mjs`; `profiles/template/profile.json`; `core/schemas/profile.schema.json`; matching profile and adapter contract tests |
| Hook state | proposed `core/hooks/state-path.mjs`; existing Claude/Codex wrappers; `installers/manifests/claude.json`; `installers/manifests/codex.json`; `tests/contracts/audit-checkpoint.test.mjs`; related installer tests and snapshots |
| Native evidence | all three `adapters/*/capabilities.json`; `docs/compatibility/claude-code.md`; `docs/compatibility/codex.md`; `docs/compatibility/antigravity.md`; `docs/evaluations/research-antigravity.md` |
| Setup and documentation | `scripts/setup.mjs`; `docs/setup/windows.md`; `docs/setup/macos.md`; `docs/setup/companion-tooling.md`; `docs/maintenance/native-registration.md`; `docs/maintenance/native-verification.md`; `docs/maintenance/cross-tool-quality.md` |
| Cross-platform evidence | `.github/workflows/installer-matrix.yml`; relevant contract/integration tests; existing snapshot files |

The map names affected boundaries, not permission to rewrite every listed file.
The executable implementation plan must name the final model integration and
migration interfaces after the design boundary is accepted.

## Security, errors, and accepted risk

Actors are the owner, native products, model catalogs, installer, and local
companions. Assets are user configuration, source work, plugin state, logs,
credentials, and model usage credits. Trust boundaries are product metadata to
selection, rendered package to registration, event payload to logs, and
environment paths to filesystem writes.

Main risks are an unsupported/cheaper tier winning model ordering, a new model
incurring credits, a path redirect writing outside the native data root, an
update deleting history, duplicate bootstrap instructions, and a native
permission claim exceeding its evidence. Validate catalog data and paths,
retain explicit family policy and emergency denies, preserve legacy files,
and keep model application distinct from read-only discovery.

The owner accepts full machine access for assigned agents and automatic model
changes, including the previously stated possibility of changed usage cost.
This acceptance does not prove safety, model quality, or product support.
The implementer owns checks; the owner owns final native trust and access
choices. Re-review the policy when a new provider family or native schema
changes, not merely when an unknown model name appears.

## Acceptance criteria and non-goals

- JSON registration succeeds against a faithful `agy` fixture and rejects
  malformed output without relaxing validation.
- Template agents inherit approved full access; portable behavior and emergency
  denies remain intact; documentation distinguishes task scope from enforcement.
- New hook data survives package replacement; historical files remain
  recoverable; an authorized import is repeatable without data loss.
- Windows and macOS tests cover native path rules and launchers, with actual
  host results recorded independently.
- Settings and companion changes preserve unrelated keys and instructions.
- Every claimed model/effort choice has current product-specific evidence.
  Mandatory automatic-selection gaps remain blockers until resolved or the
  owner explicitly accepts a narrower scope. Where `xhigh` is unavailable,
  use the highest supported effort under the owner's recorded exception and
  report its native name. Passing a static check does not prove native support.
- Required focused and quality checks pass; all unavailable runtime checks are
  named. No claim that the repository can have no possible future bugs.

No commits, pushes, merges, releases, package installations, live configuration
changes, native trust changes, paid model evaluation runs, or background
automation are performed by this design review. Preserve the seven pre-existing
modified Codex files and the untracked `.agents/` content.
