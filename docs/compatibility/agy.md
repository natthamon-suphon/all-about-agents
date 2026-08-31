# agy CLI compatibility

`agy` is the Antigravity CLI surface. The repository renderer can produce a
portable plugin package and a settings overlay for manual review. It does not
write an active profile, install a live plugin, or execute a hook
automatically. Native Windows agy 1.1.22 evidence is partial and recorded per
check; see the [evaluation method](../evaluations/method.md).
The redacted observation record is [Native Windows evidence](../evaluations/native-windows-2026-08-31.md).

## Support summary

| Capability | Current status | Contract |
| --- | --- | --- |
| Plugin package, rules, agents, skills, hooks | Automatic render; native validator passed | `agy plugin validate` accepted both rendered packages and reported 28 skills, seven agents, and one hook; runtime invocation remains narrower evidence. |
| Plugin install/profile write | Manual | Use the operator’s exact `agy plugin install PACKAGE_DIRECTORY` flow only in a disposable target. |
| Active plugin/settings roots | Unknown/manual discovery | The candidate roots are version-sensitive and must not be guessed or directly written. |
| Model and effort | Native Windows pass | `agy models` listed `gemini-3.7-flash-high`; headless `high` effort with full-access flag completed successfully. |
| Automatic model fallback | Unsupported | If the exact model is unavailable, stop, rerun discovery, or omit the model; do not substitute another model. |
| Statusline and native command mapping | Unknown | No native agy statusline or command-file contract is established. |
| Native/session behavior | Partial Windows evidence | Version, model, effort/help, headless, plugin validation, and agent selection passed; install, runtime skill discovery, hooks, settings merge, persistence, and Gate 3 remain `NOT_RUN`. |

## Profiles, model, and permissions

The `portable` overlay requests review (`toolPermission=request-review`,
`artifactReviewPolicy=asks-for-review`), disallows non-workspace access, and
enables the terminal sandbox. The `template` overlay records the full-access
operator intent (`always-proceed`, `always-proceed`, non-workspace access
allowed, terminal sandbox disabled). The documented headless argument vector
is:

```text
agy -p <prompt> --model gemini-3.7-flash-high --effort high --dangerously-skip-permissions
```

The full-access setting does not erase the emergency denies: destructive
erasure, `sudo`, force-push/history rewrite, credential/secret access or
output, and guardrail bypass remain explicit safety controls. Hooks are
disabled/inert in the rendered template until the CLI’s actual hook contract
is observed. This page does not claim that the CLI has a separate max-effort
setting or an automatic fallback.

## Roots and manual discovery

The observed executable is `%LOCALAPPDATA%/agy/bin/agy.exe` on Windows and
reported version 1.1.22. The documented candidate plugin destination is
`~/.gemini/antigravity-cli/plugins/<name>/`, with a candidate settings file at
`~/.gemini/antigravity-cli/settings.json`. Both are version-sensitive records,
not permission to write a live root. Active roots, runtime version,
entitlement, merge behavior, and complete tool vocabulary are unknown.

The manual discovery sequence is:

```text
agy --help
agy models
agy agents
agy plugin list
agy plugin install PACKAGE_DIRECTORY
```

The first four discovery commands were executed. `agy agents` exited zero but
printed no rows, so the list result is inconclusive; `--agent architect` was
accepted in the disposable workspace. Run installation only against an explicitly disposable package/root. Confirm
the exact model slug in `agy models`; if it is absent, retry with the exact
operator-provided slug or omit `--model`, and record the result. No native
skills shape is claimed because the capability record has conflicting flat
Markdown and folder-`SKILL.md` descriptions.

## Verification limits

agy version 1.1.22, model list, effort help, headless execution, package
validation, and agent selection were observed on Windows. Entitlement, plugin
installation, runtime skill discovery, hook events, settings merge, model
persistence, statusline, Gate 3, and macOS remain unqualified. The [quarantined Antigravity
setup guide](../../quarantine/legacy/setup/setup-guide-antigravity.md) is a historical setup
reference; use the discovery sequence and explicit roots above for current
qualification. See [known limitations](../limitations/known-limitations.md)
and the [evaluation method](../evaluations/method.md) for status handling.
