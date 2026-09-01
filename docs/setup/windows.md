# Windows setup

This procedure renders the repository package into a disposable directory. It
does not launch Claude, Codex, Antigravity 2.0, or agy, change a live product
configuration, or prove native discovery. Use a new root for every run.

If this checkout came from another machine, follow [sync and update](../maintenance/sync-and-update.md)
first. A pull does not install or update any coding tool.

Read [global instructions](../maintenance/global-instructions.md) for the
shared rules and the two-layer model. Global behavior is followed by the more
specific project and plugin layer.

For a receiving machine, keep this exact order:

```text
pull -> validate -> render -> dry-run -> apply package -> dry-run registration -> explicit registration apply -> restart -> verify loaded instructions
```

The `install --dry-run` command performs the render and plan step. Package
apply and native registration are separate. Do not treat a pull or a package
render as a live product update.

## Prerequisites

- Node.js 22.12.0 or newer:

  ```powershell
  node --version
  ```

- PowerShell (`pwsh` is shown below; replace it with `powershell` when using
  Windows PowerShell).
- A checkout of this repository. Run the commands from its repository root.

The launcher at `installers/install.ps1` checks that `node` is available and
forwards the CLI arguments to `scripts/aaa.mjs`.

## Validate before rendering

```powershell
pwsh -NoProfile -File .\installers\install.ps1 validate --scope all
```

For JSON diagnostics:

```powershell
pwsh -NoProfile -File .\installers\install.ps1 validate --scope all --format json
```

## Dry-run, then apply

Create an explicit disposable root. The installer is authoritative and may
overwrite differing regular files under this root without a backup, so do not use a live
`%USERPROFILE%\.claude`, `%USERPROFILE%\.codex`, or other product directory.

```powershell
$ClaudeRoot = Join-Path $env:TEMP "all-about-agents-claude"
New-Item -ItemType Directory -Path $ClaudeRoot -Force | Out-Null

pwsh -NoProfile -File .\installers\install.ps1 doctor --surface claude --destination-root $ClaudeRoot --format json
pwsh -NoProfile -File .\installers\install.ps1 install --surface claude --profile portable --destination-root $ClaudeRoot --statusline-name "<YOUR_NAME>" --dry-run --format json
pwsh -NoProfile -File .\installers\install.ps1 install --surface claude --profile portable --destination-root $ClaudeRoot --statusline-name "<YOUR_NAME>" --apply --format json
```

Inspect the dry-run JSON before the explicit `--apply`. A successful dry-run
does not write files. Apply preflights the selected surface before the first
write, uses atomic file replacement, and returns a non-zero exit code when the
plan is rejected or incomplete.

`--statusline-name` applies to Claude and `agy`. In an interactive install that
includes either surface, omitting it prompts for the name; the non-interactive
default is empty.
The name is trimmed, limited to 64 Unicode code points, and cannot contain
control or ANSI characters.

## Disposable roots for every surface

Use separate roots when inspecting each package:

```powershell
$CodexRoot = Join-Path $env:TEMP "all-about-agents-codex"
$AntigravityRoot = Join-Path $env:TEMP "all-about-agents-antigravity-2"
$AgyRoot = Join-Path $env:TEMP "all-about-agents-agy"
New-Item -ItemType Directory -Path $CodexRoot,$AntigravityRoot,$AgyRoot -Force | Out-Null

pwsh -NoProfile -File .\installers\install.ps1 install --surface codex --destination-root $CodexRoot --dry-run
pwsh -NoProfile -File .\installers\install.ps1 install --surface codex --destination-root $CodexRoot --apply

pwsh -NoProfile -File .\installers\install.ps1 install --surface antigravity-2 --destination-root $AntigravityRoot --dry-run
pwsh -NoProfile -File .\installers\install.ps1 install --surface antigravity-2 --destination-root $AntigravityRoot --apply

pwsh -NoProfile -File .\installers\install.ps1 install --surface agy --destination-root $AgyRoot --dry-run
pwsh -NoProfile -File .\installers\install.ps1 install --surface agy --destination-root $AgyRoot --apply
```

Antigravity 2.0 and `agy` have documented native discovery roots. These commands
still require explicit disposable roots. They do not write live native roots,
register a native plugin, or enable hooks automatically.

To render all four packages in one disposable tree, use one more explicit root:

```powershell
$AllRoot = Join-Path $env:TEMP "all-about-agents-all"
New-Item -ItemType Directory -Path $AllRoot -Force | Out-Null
pwsh -NoProfile -File .\installers\install.ps1 install --surface all --destination-root $AllRoot --statusline-name "<YOUR_NAME>" --dry-run
pwsh -NoProfile -File .\installers\install.ps1 install --surface all --destination-root $AllRoot --statusline-name "<YOUR_NAME>" --apply
```

The all-surface tree is namespaced by surface (`claude/`, `codex/`,
`antigravity-2/`, and `agy/`).

## Policy and limitations

The `template` profile may select a model/effort policy, but it does not grant
permission to bypass emergency denies. Full-access output still carries the
documented emergency deny controls. Native model selection, product discovery,
and manual registration require the product-specific procedure; they are not
performed by these commands.

See the [repository overview](../../README.md), [surface manifests](../../installers/manifests/claude.json),
[Antigravity 2.0 compatibility notes](../compatibility/antigravity-2.md), and the
[evaluation method and current limitations](../evaluations/method.md). After an
approved install, follow [native registration](../maintenance/native-registration.md),
[native verification](../maintenance/native-verification.md), and
[cross-tool quality](../maintenance/cross-tool-quality.md).
