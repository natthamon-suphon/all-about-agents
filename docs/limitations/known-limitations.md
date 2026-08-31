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
behavior by themselves. Windows Claude Code 2.1.248, Codex CLI
0.151.0-alpha.7.2, Antigravity Desktop 2.11.0, and agy 1.1.22 now have partial
native evidence; Codex Desktop, Antigravity IDE, macOS, authenticated external
model transport, and all unexercised Gate 2/Gate 3 behaviors remain unavailable
or not run. No broader routing, hook, permission,
persistence, or behavioral release claim may be inferred from the partial
checks.

## Surface-specific limitations

| Surface | Automatic package facts | Manual/unknown boundary | Unsupported or unavailable |
| --- | --- | --- | --- |
| [Claude Code](../compatibility/claude.md) | Plugin-relative artifacts render deterministically; strict validation, disposable marketplace/install, and enabled-plugin discovery passed on Windows 2.1.248 without loader errors. | Authenticated skill/agent invocation, hook execution, model/fallback event, Fable access, and statusline persistence require native observation. | Native statusline configuration key is unknown; Fable is experimental/access-controlled; unrun Gate 2/3 behavior is `NOT_RUN_UNAVAILABLE`. |
| [Codex](../compatibility/codex.md) | `AGENTS.md`, skills, role TOMLs, and Sol/Terra profile files render deterministically; an isolated Windows CLI loaded the base Sol config strictly and parsed the Terra profile. | Authentication, model invocation, CLI/Desktop registration, hooks, emergency guard execution, and Desktop Terra picker require observation. | The isolated doctor reported no credentials and a non-interactive terminal; automatic model fallback and Claude-style command plugins are unsupported; unrun Gate 2/3 behavior is not qualified. |
| [Antigravity 2.0 Desktop](../compatibility/antigravity-2.md) | Workspace plugin, 28 skills, consolidated rule, seven agents, Flash High selector, and current preset names were observed on Windows 2.11.0. | Role tools, Custom deny enforcement, hooks, persistence, IDE, and other platforms remain manual. | Separate Desktop effort, automatic model fallback, command/statusline/settings keys are unsupported or unknown; Gate 3 and unrun Gate 2 checks are not qualified. |
| [agy](../compatibility/agy.md) | agy 1.1.22 version/model/effort/headless/plugin validation and agent selection passed on Windows. | `agy agents` was inconclusive; exact install, runtime skill discovery, active roots, settings merge, hooks, and persistence remain manual. | Automatic install/profile writes, automatic model fallback, native statusline, and native command mapping are not established; Gate 3 and unrun Gate 2 checks are not qualified. |

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

For the remaining products, hosts, and unrun checks, use the manual acceptance
checklist at `tests/integration/manual-desktop-checklist.json`, then run the
fresh-session Gate 3 procedure in the [evaluation method](../evaluations/method.md).
Capture exact runtime/version and discovery-root evidence, model/effort and
permission observations, hook input/output, and persistence behavior. Keep
secrets and private prompts out of retained evidence. Until those observations
exist, report the affected rows as `NOT_RUN_UNAVAILABLE` and keep the release
scope limited to the deterministic repository/package gates.
