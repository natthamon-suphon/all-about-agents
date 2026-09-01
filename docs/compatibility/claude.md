# Claude Code compatibility

This page describes the Claude package and its native boundary. The observed
runtime is Claude Code `2.1.251` on Windows. The T07 disposable checks passed
strict validation, local marketplace registration, plugin discovery, and both
statusline profiles. Authenticated session behavior is still
`NOT_RUN_UNAVAILABLE`.

## Lifecycle and support

Use these states in order:

```text
rendered -> validated -> registered -> trusted -> active -> runtime verified
```

`rendered` and `validated` are repository or package results. `registered`
needs product discovery. Claude has no separate native trust step for the
statusline or emergency policy, so `trusted` is `NOT_RUN_UNAVAILABLE`. `active`
and `runtime verified` need a fresh product session. Do not promote one state
from another state.

| Capability | Current evidence | Boundary |
| --- | --- | --- |
| Skills, agents, rules, commands, and hooks | Package rendered; plugin discovery passed in a disposable Windows root | Component execution and hook execution are not claimed. |
| Plugin registration | Disposable marketplace add, plugin install, and enabled-plugin discovery passed | Run the native registration steps for a new package. |
| Statusline and display name | Native `statusLine` settings and platform launchers render; both disposable profiles produced the expected text | An installed live session and persistence are not claimed. |
| Strict validation | `claude plugin validate "<PACKAGE_ROOT>" --strict` passed in the disposable check | A validator proves package shape, not model or hook behavior. |
| Product session | `NOT_RUN_UNAVAILABLE` | No authenticated model session was run. |

Plugin registration is manual, not automatic. The generated statusline accepts
native JSON on stdin and writes only one statusline text result. The install
command asks for a display name when it is interactive. Use
`--statusline-name "<YOUR_NAME>"` in a script. The name is trimmed, limited to
64 Unicode code points, and rejects control and ANSI characters.

Some native behavior remains unsupported until a product session is observed.

## Models, permissions, and hooks

The `portable` profile uses Claude's surface default with controlled
permissions. The `template` profile uses:

- model `claude-opus-5`;
- `CLAUDE_CODE_EFFORT_LEVEL=max`;
- server-failure fallback `claude-sonnet-5` at max effort;
- advisor `claude-fable-5` when the account and product permit it;
- permission mode `bypassPermissions`.

Fable access depends on account, organization, plan, provider, consent, and
Claude Code version. The package does not claim Fable access from a rendered
file. Sonnet is a qualifying server-failure fallback. No permission or policy
fallback is claimed.

Full access does not remove the emergency denies. The profiles keep denies for
`rm -rf /`, `rm -rf ~`, force-push, and hard-reset operations. The
`disableAllHooks` setting disables hooks globally. It does not prove that an
emergency deny is active, and it does not replace the narrow deny policy.

## Registration and reload

Claude uses `CLAUDE_CONFIG_DIR` when it is set. Otherwise it uses `~/.claude`.
The repository installer needs an explicit disposable destination root.

Warning: native registration can change the selected Claude product root.
Use the dry-run first and use `--apply` only with exact authority.

PowerShell:

```powershell
New-Item -ItemType Directory -Force -LiteralPath "<PRODUCT_ROOT>" | Out-Null
$env:CLAUDE_CONFIG_DIR = "<PRODUCT_ROOT>"
node scripts/aaa.mjs register --surface claude --profile <PROFILE> --package-root "<PACKAGE_ROOT>" --dry-run --format json
```

POSIX shell on macOS or Linux:

```sh
mkdir -p "<PRODUCT_ROOT>"
export CLAUDE_CONFIG_DIR="<PRODUCT_ROOT>"
node scripts/aaa.mjs register --surface claude --profile <PROFILE> --package-root "<PACKAGE_ROOT>" --dry-run --format json
```

Run the same command with `--apply` only after exact authority.

During apply, the installer first overwrites `settings.json`,
`all-about-agents/statusline.json`, and the four files under `statusline/` in
`CLAUDE_CONFIG_DIR`: `statusline.mjs`, `track-tool.mjs`, `statusline.ps1`, and
`statusline.sh`. In the rendered source `settings.json`, it rebases only
`statusLine.command` to this exact config root and keeps the other rendered
fields. The existing target `settings.json` is replaced without a backup;
target-only settings are not preserved. Native marketplace and plugin
registration run after those files are present. The package managed state,
surface, profile, and owned hashes must match before any write.

The fixed native commands are:

```text
claude plugin marketplace add "<PACKAGE_ROOT>" --scope user
claude plugin install all-about-agents@all-about-agents-dev --scope user
claude plugin list --json
claude plugin validate "<PACKAGE_ROOT>" --strict
```

Run `claude plugin list --json` after registration. Restart Claude Code or
reload the plugin. Then record each lifecycle state separately. Claude has no
separate native hook trust step. A package list does not prove an active
session or runtime behavior.

## Full access and emergency evidence

The template policy asks for broad access so an operator can work across the
repository. The emergency deny rules remain part of the generated policy. A
static check proves that the rules are rendered. It does not prove native
blocking. Record native deny behavior only after a disposable product session.

## Limits

The disposable Windows evidence does not cover authenticated model calls,
skill or agent invocation, hook execution, fallback events, Fable access,
statusline persistence, macOS execution, or Desktop behavior. Those checks are
`NOT_RUN` or `NOT_RUN_UNAVAILABLE` in the [evaluation method](../evaluations/method.md).

Use [native registration](../maintenance/native-registration.md),
[native verification](../maintenance/native-verification.md), and the
[cross-tool quality guide](../maintenance/cross-tool-quality.md). Use the
[Windows](../setup/windows.md) or [macOS](../setup/macos.md) guide for the
next check. See [known limitations](../limitations/known-limitations.md).
