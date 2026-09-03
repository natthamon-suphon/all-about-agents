# Codex CLI and Desktop compatibility

This page covers the Codex package and its native boundary. The observed
runtime is Codex CLI `0.151.0-alpha.7.2` on Windows. The T07 disposable
checks passed local marketplace add, plugin add, exact plugin discovery, and
hook-file discovery. Hook trust remains `NOT_RUN`. Authenticated sessions remain
`NOT_RUN_UNAVAILABLE`.

## Lifecycle and support

Use these states in order:

```text
rendered -> validated -> registered -> trusted -> active -> runtime verified
```

The package can be `rendered` and locally `validated` without being
`registered`. Plugin discovery is evidence for `registered`. Open `/hooks` for
the separate `trusted` step when Codex asks. A fresh session is needed for
`active` and `runtime verified` evidence.

| Capability | Current evidence | Boundary |
| --- | --- | --- |
| `AGENTS.md`, skills, roles, and profiles | Package rendered; the disposable CLI loaded the base config and Terra profile | Role execution and Desktop loading are not claimed. |
| Plugin registration | Disposable marketplace add, plugin add, and `plugin list --available --json` discovery passed | Trust and runtime execution remain separate. |
| Hooks | Hook files were present in the discovered package | Hooks are not automatic. `/hooks` trust and hook execution were not run. |
| Statusline display name | Codex has no native statusline contract in this package | Do not infer statusline setup from another product. |
| Native session | `NOT_RUN_UNAVAILABLE` | No authenticated model or Desktop session was run. |

## Models, recovery, and permissions

The shared global file is rendered from
`core/instructions/global-operating-rules.md` and registered at
`<CODEX_HOME>/AGENTS.md`, or `~/.codex/AGENTS.md` with the normal root. Project
`AGENTS.override.md` or `AGENTS.md`, plus plugin rules, are the more specific
second layer. Visible names use the registry emoji after the machine ID and
include a short reason and a 2-to-7 item checklist. This is prompt guidance,
not a UI guarantee.

Plugin registration is a manual product action.

The `portable` profile uses `sandbox_mode=workspace-write` and
`approval_policy=on-request`. The `template` profile uses:

- model `gpt-5.6-sol`;
- `model_reasoning_effort=max`;
- `sandbox_mode=danger-full-access`;
- `approval_policy=never`.

The explicit `terra-max` profile selects `gpt-5.6-terra` with max reasoning.
This is an operator-selected recovery profile. Automatic model fallback is
unsupported. No automatic model fallback is claimed.

```text
codex --profile terra-max
```

Full access does not remove the emergency-deny contract. The rendered policy
keeps denies for `command(rm -rf)`, `command(sudo)`, `write_file(.git/)`, and
`write_file(/home/user/.ssh)`. These are declarative permission rules; the
package installs no `PreToolUse` command guard. Native deny behavior needs a
product check.

## Registration and trust

Codex uses `CODEX_HOME` when it is set. Otherwise it uses `~/.codex`.
The repository installer uses an explicit disposable package root.

Warning: native registration and hook trust can change the selected Codex
home. Use a disposable home and review the dry-run before an authorized apply.

PowerShell:

```powershell
New-Item -ItemType Directory -Force -LiteralPath "<PRODUCT_ROOT>" | Out-Null
$env:CODEX_HOME = "<PRODUCT_ROOT>"
node scripts/aaa.mjs register --surface codex --profile <PROFILE> --package-root "<PACKAGE_ROOT>" --dry-run --format json
```

POSIX shell on macOS or Linux:

```sh
mkdir -p "<PRODUCT_ROOT>"
export CODEX_HOME="<PRODUCT_ROOT>"
node scripts/aaa.mjs register --surface codex --profile <PROFILE> --package-root "<PACKAGE_ROOT>" --dry-run --format json
```

Run the same command with `--apply` only after exact authority.

Codex clones a local marketplace source. If `<PACKAGE_ROOT>` is a newly
rendered folder and is not already a Git repository, prepare only that folder.

Warning: the following Git commands write metadata only inside the reviewed
`<PACKAGE_ROOT>`. Never run them on an unreviewed existing repository.

```text
git -C "<PACKAGE_ROOT>" init
git -C "<PACKAGE_ROOT>" add -A
git -C "<PACKAGE_ROOT>" -c user.name=all-about-agents -c user.email=all-about-agents@invalid.example commit -m "Prepare local Codex plugin source"
```

During apply, the installer first overwrites `AGENTS.md`, `config.toml`,
`terra-max.config.toml` for the template profile, and the seven `agents/*.toml`
files in `CODEX_HOME`. Native registration runs after these files are present,
so product-written plugin metadata is not erased by a later config deployment.

The fixed current CLI commands are:

```text
codex plugin marketplace add "<PACKAGE_ROOT>" --json
codex plugin add all-about-agents@all-about-agents --json
codex plugin list --available --json
```

After a new or changed hook hash, restart Codex and open `/hooks`. Review or
trust the hook only when Codex presents that step. A registered hook is not
automatically trusted or active.

## Limits

The disposable check did not run model calls, role execution, hook trust,
hook execution, Desktop registration, Desktop model selection, persistence,
macOS execution, or Gate 3. Record these checks as `NOT_RUN` or
`NOT_RUN_UNAVAILABLE`. Package output and static tests do not promote their
status.

Use [native registration](../maintenance/native-registration.md),
[native verification](../maintenance/native-verification.md), and the
[cross-tool quality guide](../maintenance/cross-tool-quality.md). See
[known limitations](../limitations/known-limitations.md).
