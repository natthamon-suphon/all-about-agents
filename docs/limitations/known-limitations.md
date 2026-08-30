# Known limitations and unavailable checks

This document records boundaries that are intentional or not yet observable.
The status vocabulary follows the [evaluation method](../evaluations/method.md):
`NOT_RUN` means intentionally not attempted, while `NOT_RUN_UNAVAILABLE` means
the required product, host, entitlement, session, or transport was unavailable.
Neither status is a pass.

## Current qualification boundary

Gate 0 source/contract checks and Gate 1 repository-package/installer checks
may establish deterministic rendering, validation, containment, redaction,
and disposable-root behavior. They do not establish native discovery or
behavior. At the current qualification point there is no native Claude Code,
Codex CLI/Desktop, Antigravity Desktop, or agy session; no macOS host; and no
external model transport. Therefore affected Gate 2 and Gate 3 checks are
`NOT_RUN_UNAVAILABLE`. No native model, routing, hook, permission, persistence,
or behavioral release claim may be inferred from package files or renderer
output.

## Surface-specific limitations

| Surface | Automatic package facts | Manual/unknown boundary | Unsupported or unavailable |
| --- | --- | --- | --- |
| [Claude Code](../compatibility/claude.md) | Plugin-relative skills, agents, rules, commands, hooks, settings overlays, and statusline candidate files render deterministically. | `CLAUDE_CONFIG_DIR`/`~/.claude` discovery, plugin install, hook execution, model/fallback event, Fable access, and statusline persistence require native observation. | Native statusline configuration key is unknown; Fable is experimental/access-controlled; native Gate 2/3 are `NOT_RUN_UNAVAILABLE`. |
| [Codex](../compatibility/codex.md) | `AGENTS.md`, skills, role TOMLs, Sol/ Terra profile files, and plugin metadata render deterministically. | `CODEX_HOME`/`~/.codex` discovery, CLI/Desktop registration, hooks, emergency guard execution, and Desktop Terra picker require observation. | Automatic model fallback and Claude-style command plugins are unsupported; native statusline/schedules are not declared; Gate 2/3 are `NOT_RUN_UNAVAILABLE`. |
| [Antigravity 2.0 Desktop](../compatibility/antigravity-2.md) | Workspace/global plugin package paths, skills, rules, and retained role files render; emergency-deny policy is explicit. | Plugin/agent registration, role discovery, hooks, Unrestricted permission UI, Flash Medium selection, and conversation-local behavior are manual. | Flash High and Desktop effort are unsupported; command/statusline/settings keys and cross-session persistence are unknown; Gate 2/3 are `NOT_RUN_UNAVAILABLE`. |
| [agy](../compatibility/agy.md) | Portable plugin package and sparse settings overlay render below an explicit root. | `agy --help`, `models`, `agents`, `plugin list`, exact install, active roots, settings merge, and hook behavior require operator discovery. | Automatic install/profile writes, automatic model fallback, native statusline, and native command mapping are not established; skills shape and model persistence key are unknown; Gate 2/3 are `NOT_RUN_UNAVAILABLE`. |

## Safety and setup constraints

- Never guess a vendor path. An explicit `--destination-root` authorizes only
  that disposable/test root; an omitted root must not be treated as permission
  to mutate live configuration.
- Full-access profiles are bounded by the emergency-deny contract. A product
  UI or CLI that has not been observed cannot be described as enforcing it.
- Native manual steps must use a fresh disposable product/workspace root and
  must not request real credentials, paid APIs, or product calls from a live
  user profile.
- Read-only roles, secret redaction, containment, and emergency denies are
  release controls. An unavailable check remains unavailable, not green.
- The [quarantined Antigravity setup guide](../../quarantine/legacy/setup/setup-guide-antigravity.md)
  contains older automation examples. The supported platform setup guides,
  surface compatibility pages, and adapter manifests are the current capability
  boundary; do not infer native acceptance from the historical guide.

## Required next evidence

When the products and hosts become available, use the manual acceptance
checklist at `tests/integration/manual-desktop-checklist.json`, then run the
fresh-session Gate 3 procedure in the [evaluation method](../evaluations/method.md).
Capture exact runtime/version and discovery-root evidence, model/effort and
permission observations, hook input/output, and persistence behavior. Keep
secrets and private prompts out of retained evidence. Until those observations
exist, report the affected rows as `NOT_RUN_UNAVAILABLE` and keep the release
scope limited to the deterministic repository/package gates.
