# Automatic model policy

The owner profile is `template`: full native access, Extra High (`xhigh`) when
supported, otherwise the highest available effort. Emergency deny policy and
the assigned task scope still apply. `portable` leaves native model and access
choices unchanged.

## Managed CLI sessions

These commands work from the repository on Windows and macOS with Node.js
22.12 or newer and the selected native CLI on `PATH`. They preview the actual
model and argument list; they do not start a model turn or edit live config:

```text
node scripts/model-policy.mjs --surface claude
node scripts/model-policy.mjs --surface codex
node scripts/model-policy.mjs --surface antigravity
```

Add `--launch` to start the native CLI after discovery. Forward native arguments
after `--`, as separate arguments. For example:

```text
node scripts/model-policy.mjs --surface codex --launch
node scripts/model-policy.mjs --surface claude --launch
node scripts/model-policy.mjs --surface antigravity --launch
node scripts/model-policy.mjs --surface codex --profile portable --launch
```

This is automatic selection at each **managed launch**. Opening a native CLI
directly or resuming an existing GUI conversation does not run this launcher.
No background updater or scheduler is installed. Active sessions are unchanged.

The npm aliases remain available. In PowerShell, use
`npm.cmd run models -- --surface codex`; some `npm.ps1` shims remove the `--`
separator and npm consumes the policy flags. The direct Node commands above
avoid that shell boundary on both operating systems.

## Selection and failure behavior

- Claude uses the rolling `opus[1m]` alias. Rendered fallback `sonnet` and advisor
  `fable` also follow their approved families. Provider, client version,
  organization and account restrictions still apply. An alias does not promise
  the newest model across unrelated families or the greatest intelligence.
- Codex queries the native App Server `model/list` API, including initialization
  and pagination. It chooses the newest visible numeric release in the approved
  Sol family and validates supported effort. Hidden models, preview names,
  weaker families, malformed records, missing upgrade targets, upgrade cycles
  and ambiguous releases cannot silently win selection.
- Antigravity reads the observed `agy models` tab-separated list. It chooses
  the newest Gemini premium Argon/Pro release, excluding Flash, and selects an
  advertised effort variant. `agy 1.4.2` on the reviewed Windows host offered
  Argon 4 through `high`, although its CLI syntax also accepts `xhigh` and `max`.
  Syntax alone does not prove a model offers those efforts. Changed list
  formats fail explicitly; no undocumented JSON listing flag is assumed.

Native catalog reads are bounded by time, output size, records and pages.
Failure stops a managed launch; it does not choose a stale cached model or
write partial settings. Competing forwarded model/config flags are rejected.
Commands run with structured arguments and no command shell.

The rendered Codex `gpt-6.1-sol`/`xhigh` default and explicit Terra/max recovery
profile remain available when not using the managed launcher. Recovery is an
explicit operator action, not automatic failover.

## App and IDE boundary

`--runtime desktop` and `--runtime ide` return an explicit unavailable result.
No supported universal automatic model-control API has been verified for
Antigravity App or standalone IDE, and a CLI catalog does not establish IDE
eligibility. Gemini 4 Argon is currently excluded from the standalone IDE.
Use each app's model/effort controls and record its actual result separately.
Codex Desktop shares configuration with CLI, but this launcher does not run
when Desktop opens a thread. Native default selection is not a guarantee of
chronologically newest models. These limits remain outstanding native features,
not completed automatic GUI support.

Sources checked on 2026-10-19: [Claude models](https://code.claude.com/docs/en/model-config),
[Codex models](https://learn.chatgpt.com/docs/models),
[Codex App Server](https://learn.chatgpt.com/docs/app-server),
[Antigravity models](https://antigravity.google/docs/models/),
[Antigravity effort](https://antigravity.google/docs/cli/commands/effort),
[Antigravity headless mode](https://antigravity.google/docs/cli/headless/).

## Hook history

Audit/checkpoint writes use native `CLAUDE_PLUGIN_DATA` for Claude and
`PLUGIN_DATA` for Codex. The package contains executable code only. Missing,
relative, package-local or linked state paths skip optional writes with a short
diagnostic. A package update does not own or remove the native data directory.

Legacy package-local logs are preserved. Review a bounded import first:

```text
node scripts/migrate-hook-state.mjs --surface codex --package-root "<OLD_PACKAGE_ROOT>" --data-root "<NATIVE_PLUGIN_DATA>"
```

Use the exact native data directory, not a guessed plugin identifier. Add
`--apply` only after reviewing the report and authorizing that import. It
copies known regular history files into a content-addressed `legacy/` area,
keeps sources, detects repeated imports, and refuses existing different data,
links, traversal and limit violations. It never removes old history. An
interrupted import may have copied a subset; repeat the reviewed import to
continue without overwriting different files.

Review and import history before replacing the old package or clearing its
cache. Source preservation is a guarantee of the import command; it does not
control a native product's later cache cleanup.
