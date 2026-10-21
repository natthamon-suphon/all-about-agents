# Claude settings setup

Setup builds a shared Claude settings policy for Windows and macOS. It does
not copy the author's live `settings.json`, credentials, proxy, or local paths.
The reviewed reference version is Claude Code `2.1.306`; use a current Claude
Code version on each computer.

## Settings delivered

The `template` profile is the owner's full-access profile. It sets:

```json
{
  "model": "opus[1m]",
  "advisorModel": "fable",
  "env": {
    "CLAUDE_CODE_EFFORT_LEVEL": "xhigh"
  },
  "viewMode": "focus",
  "outputStyle": "Concise",
  "showThinkingSummaries": false,
  "autoCompactEnabled": true,
  "autoMemoryEnabled": true,
  "idleCompaction": false
}
```

This shows policy fields, not a complete file to paste over existing settings.
Setup also adds the platform's statusline command and the profile's permissions.

| Setting | Reason |
| --- | --- |
| `model` | Uses the rolling Opus alias. The provider controls the exact target. |
| `advisorModel` | Keeps the approved Fable advisor. Account and provider access are still required. |
| `env.CLAUDE_CODE_EFFORT_LEVEL` | Selects `xhigh` reasoning effort. It does not guarantee a correct answer. |
| `viewMode` | Starts in the focus transcript view. |
| `outputStyle` | Uses short replies while keeping normal engineering work. |
| `showThinkingSummaries` | Hides summaries on screen. It does not lower thinking effort. |
| `autoCompactEnabled` | Allows normal context compaction when needed. |
| `autoMemoryEnabled` | Keeps native auto memory enabled. Each project keeps its default memory store. |
| `idleCompaction` | Prevents compaction only due to a pause. Returning after cache expiry can cost more tokens. |
| `permissions.defaultMode` | `bypassPermissions` for `template`; `default` for `portable`. Emergency denies stay in both. |
| `statusLine` | Runs the existing launcher for the current OS and config root. |

The `portable` profile uses the same session defaults. It leaves personal
model, effort, advisor, and fallback choices unchanged. It uses controlled
permissions rather than the template's full access.

## Values left to Claude or the operator

- No fixed `autoCompactWindow`, token cap, or thinking budget. A new install
  uses the model and provider defaults. Updates preserve manual overrides.
- No shared `autoMemoryDirectory`. Native memory stays separate by project.
- No forced `language`. Global instructions follow the session language and
  use simple English when no session language is clear.
- No global ultracode toggle. Use `/effort ultracode` when needed, then
  `/effort ultracode off`. The repository does not reset an existing personal
  ultracode setting. Inspect `/effort` on each computer.
- No new allowlists, blanket `allow` rules, workflow flags, telemetry targets,
  or companion plugin registrations. Configure those only for a real need.

The [official settings reference](https://code.claude.com/docs/en/settings-reference)
defines setting scope and defaults. See also
[model configuration](https://code.claude.com/docs/en/model-config) and
[Concise output](https://code.claude.com/docs/en/output-styles#concise).

## What an update changes

Native registration merges the rendered policy into the selected user
`settings.json`. Keys in the policy win. Unrelated keys remain, including
environment values, endpoint settings, plugins, and real hooks. Existing
permission `allow` and `deny` lists are kept, and package rules are added once.

There are two explicit removals:

- Both profiles remove `autoDreamEnabled`, an undocumented old preference.
- `template` also removes a saved `fallbackModel` chain. It no longer configures
  Sonnet as a server-failure fallback. `portable` keeps personal fallback choices.

Removing `fallbackModel` does not disable Claude's separate native
content-based fallback. Higher-priority project, command-line, environment,
or managed settings can still change the effective configuration.

The JSON dry-run shows `removeKeys` in the `claude-settings-deploy` action.
The text report shows a `remove-keys` line. Dry-run writes nothing. Approved
registration writes atomically, checks source hashes and paths, and creates
no backup. It does not remove companion hooks or a user's manual preferences
outside the listed keys.

## Use on another computer

Follow [sync and update](../maintenance/sync-and-update.md) first. Read the
[Windows](windows.md) or [macOS](macos.md) prerequisites. Set credentials and
any required gateway locally on that computer.

These commands use the same arguments in PowerShell and a macOS shell. They
preview an update from this checkout without changing live config:

```text
node scripts/setup.mjs --mode update --surface claude --profile template --package-root "~/.all-about-agents/claude-package" --dry-run
```

After reviewing the preview, the following command writes the package and
native Claude configuration. Run it only when that install is authorized:

```text
node scripts/setup.mjs --mode update --surface claude --profile template --package-root "~/.all-about-agents/claude-package" --apply
```

`--mode fresh` clears the managed package before rebuilding it. It does not
delete the shared Claude settings file or uninstall the Claude application.
These examples use a dedicated Claude-only package root. If a previous setup
managed all tools in one root, keep that original root and the full surface
selection instead. Do not mix all-surface and single-surface management in one
root. See [one-command setup](../maintenance/sync-and-update.md#one-command-setup)
for these boundaries and the plugin reinstall step.

Restart Claude Code. Check `/status`, `/model`, `/effort`, and `/config`.
Confirm Opus, `xhigh`, manual ultracode, short replies, statusline, memory,
permissions, and hooks. Run `claude doctor`. Confirm advisor access through
the actual provider before relying on it. These are native checks; repository
tests cannot prove that a live session loaded the settings or improved accuracy.
