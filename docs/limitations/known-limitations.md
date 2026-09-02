# Known limitations and unavailable checks

This document records boundaries that are intentional or not yet observable.
The status vocabulary follows the [evaluation method](../evaluations/method.md).
`NOT_RUN` means intentionally not attempted. `NOT_RUN_UNAVAILABLE` means the
required product, host, entitlement, session, or transport was unavailable.
Neither status is a pass.

Global instructions come from one canonical source and are rendered for all
four surfaces. See [global instructions](../maintenance/global-instructions.md)
for the two-layer model, exact destinations, emoji labels, and checklist
guidance.

The native lifecycle is ordered:

```text
rendered -> validated -> registered -> trusted -> active -> runtime verified
```

## Current qualification boundary

Gate 0 source checks and Gate 1 repository and installer checks establish
deterministic rendering, validation, containment, redaction, and disposable
root behavior. They do not establish native discovery or behavior.

T07 Windows checks observed Claude Code `2.1.251`, Codex CLI
`0.151.0-alpha.7.2`, Antigravity Desktop `2.11.0`, and agy `1.1.22` for only
the operations listed in the evaluation records. Codex Desktop, Antigravity
IDE, macOS, authenticated model transport, hook trust, hook execution,
permission blocking, persistence, and Gate 3 remain `NOT_RUN` or
`NOT_RUN_UNAVAILABLE`.

## Surface limits

| Surface | Observed or rendered | Still manual, unknown, or unavailable |
| --- | --- | --- |
| [Claude Code](../compatibility/claude.md) | Package validation, disposable marketplace registration, plugin discovery, and both statusline fixtures passed on Windows. | Authenticated model and component use, hook trust and execution, Fable access, deny blocking, persistence, Desktop behavior, and macOS are not qualified. |
| [Codex](../compatibility/codex.md) | Marketplace add, plugin add, exact available-plugin discovery, and discovered hook-file checks passed in an isolated Windows CLI home. | `/hooks` trust, hook execution, authenticated model use, Desktop behavior, persistence, and macOS are not qualified. Automatic fallback is unsupported. |
| [Antigravity 2.0 Desktop](../compatibility/antigravity-2.md) | A Windows Desktop project discovered the package, 28 skills, the consolidated rule, and 7 agents. | Role tools, Custom Deny enforcement, hook behavior, statusline, persistence, IDE behavior, and macOS are not qualified. |
| [agy](../compatibility/agy.md) | Both profiles validated with 28 skills, 7 agents, 1 hook, both statusline fixtures, and exact model discovery on Windows. | Live plugin install, runtime skill use, settings merge, hook behavior, persistence, authenticated requests, and macOS are not qualified. |

## Safety and setup constraints

- Never guess a vendor path. An explicit `--destination-root` authorizes only
  that disposable or test root.
- Full-access profiles keep emergency denies. A product that has not been
  observed cannot be described as enforcing them.
- The Claude `disableAllHooks` setting disables hooks globally. It does not
  prove emergency deny behavior.
- Codex hooks are not automatic. Registration, trust, active loading, and
  runtime behavior are separate states.
- The `agy` settings artifact is a sparse overlay. Its only documented
  destination is `~/.gemini/antigravity-cli/settings.json`. Its installed
  plugin root is a different directory, `~/.gemini/config/plugins/`, which
  Antigravity Desktop also reads. On the observed versions a global `agy`
  install and a global Desktop install cannot both own `all-about-agents`.
  See [agy compatibility](../compatibility/agy.md).
- Desktop hook templates are disabled and inert. They are not active
  protection.
- Native manual steps must use a fresh disposable product or workspace root.
  Do not request real credentials or paid model calls for a repository check.
- Emoji labels, short reasons, and 2-to-7 item checklists are prompt guidance.
  They are not a guarantee about vendor UI rendering.
- `git pull` updates the repository only. It does not install or register live
  configuration. Package apply and native registration remain separate.
- Native registration needs the product binary on `PATH`. When it is missing,
  the plan copies managed files and then fails its native commands, so a
  package can look installed while the product knows nothing about it. Confirm
  with the product's own discovery command, never from installer output.
- A registered package root is read on every product launch. A root under
  `%TEMP%`, `$TMPDIR`, or `/tmp` can be removed by routine cleanup, which
  breaks the registration with no error at install time.

## No automated pre-execution command guard

The `emergency-guard` `PreToolUse` hook and its command classifier were removed
on 2026-09-02 on operator instruction, because the classifier failed closed and
denied read-only commands that were not destructive.

What remains is declarative only:

- the rendered permission deny rules in each profile (Claude `settings.json`
  `permissions.deny`; the `agy` settings overlay; the Codex and Antigravity
  Desktop manual Deny checklists);
- the `destructive-actions` rule and the global operating rules, which are
  model guidance rather than enforcement.

No packaged artifact inspects a command before it runs on any surface. Do not
describe the remaining deny rules as an automated guard, and do not record a
catastrophic-action or secret-exposure check as `PASS` from a static render.
For this reason `emergency` and `secret` are no longer release gates in
`core/evals/rubric.json`. They are recorded there under `qualification` as
`NOT_RUN_UNAVAILABLE`.

An already installed package still contains the old hook files. They are
removed only when the surface is re-registered from a current render.

## Required next evidence

Use [native registration](../maintenance/native-registration.md) for the
separate native mutation. Use [native verification](../maintenance/native-verification.md)
for the restart/reload and evidence steps. Use the manual checklist at
`tests/integration/manual-desktop-checklist.json` for Desktop.

Capture the exact product version, discovery root, model and effort selection,
permission result, hook input and output, and persistence behavior. Redact
secrets and private prompts. Until the observation exists, record the affected
state as `NOT_RUN` or `NOT_RUN_UNAVAILABLE`, not `PASS`.
