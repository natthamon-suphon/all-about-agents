# macOS setup

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

  ```sh
  node --version
  ```

- Bash or another POSIX `sh`.
- A checkout of this repository. Run the commands from its repository root.

The launcher at `installers/install.sh` resolves its own directory and forwards
the CLI arguments to `scripts/aaa.mjs`.

Optional workstation tools are listed in
[companion tooling](companion-tooling.md). They are not repository
dependencies.

### Product binaries must resolve before native registration

`register --apply` spawns the product executables by bare name: `claude`,
`codex`, and `agy`. Rendering and `install --apply` do not need them, so a
package can be complete while a later registration silently fails its native
steps. Confirm each binary you intend to register:

```sh
command -v claude codex agy
```

A product installed outside `PATH` still works; prepend its `bin` directory for
the registration command only, rather than editing your shell profile:

```sh
PATH="<PRODUCT_BIN_DIRECTORY>:$PATH" node scripts/aaa.mjs register ...
```

Do not copy another machine's install path. Resolve it on the machine you are
setting up.

## Choose the package root before you render

There are two different jobs, and only one of them may use a temporary
directory:

- **Reviewing a render.** Use a fresh `mktemp -d` root and delete it when the
  review is done. Every example below is this case.
- **A package you will register.** Claude and Codex store the package path in
  live configuration and read it on every launch, so the root must outlive the
  session. macOS removes items from `$TMPDIR` and `/tmp`, which silently breaks
  a registered plugin. Use a durable root such as `~/.all-about-agents/package`
  instead.

The root is still explicit either way; the CLI never guesses one.

## Validate before rendering

```sh
bash ./installers/install.sh validate --scope all
```

For JSON diagnostics:

```sh
bash ./installers/install.sh validate --scope all --format json
```

## Dry-run, then apply

Create an explicit disposable root with `mktemp`. The installer is authoritative
and may overwrite differing regular files under this root without a backup, so do not use a
live `~/.claude`, `~/.codex`, or other product directory.

```sh
CLAUDE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/all-about-agents-claude.XXXXXX")"

bash ./installers/install.sh doctor --surface claude --destination-root "$CLAUDE_ROOT" --format json
bash ./installers/install.sh install --surface claude --profile portable --destination-root "$CLAUDE_ROOT" --statusline-name "<YOUR_NAME>" --dry-run --format json
bash ./installers/install.sh install --surface claude --profile portable --destination-root "$CLAUDE_ROOT" --statusline-name "<YOUR_NAME>" --apply --format json
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

```sh
CODEX_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/all-about-agents-codex.XXXXXX")"
ANTIGRAVITY_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/all-about-agents-antigravity-2.XXXXXX")"
AGY_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/all-about-agents-agy.XXXXXX")"

bash ./installers/install.sh install --surface codex --destination-root "$CODEX_ROOT" --dry-run
bash ./installers/install.sh install --surface codex --destination-root "$CODEX_ROOT" --apply

bash ./installers/install.sh install --surface antigravity-2 --destination-root "$ANTIGRAVITY_ROOT" --dry-run
bash ./installers/install.sh install --surface antigravity-2 --destination-root "$ANTIGRAVITY_ROOT" --apply

bash ./installers/install.sh install --surface agy --destination-root "$AGY_ROOT" --dry-run
bash ./installers/install.sh install --surface agy --destination-root "$AGY_ROOT" --apply
```

Antigravity 2.0 and `agy` have documented native discovery roots. These commands
still require explicit disposable roots. They do not write live native roots,
register a native plugin, or enable hooks automatically.

To render all four packages in one disposable tree, use one more explicit root:

```sh
ALL_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/all-about-agents-all.XXXXXX")"
bash ./installers/install.sh install --surface all --destination-root "$ALL_ROOT" --statusline-name "<YOUR_NAME>" --dry-run
bash ./installers/install.sh install --surface all --destination-root "$ALL_ROOT" --statusline-name "<YOUR_NAME>" --apply
```

The all-surface tree is namespaced by surface (`claude/`, `codex/`,
`antigravity-2/`, and `agy/`).

## Policy and limitations

The `template` profile may select a model/effort policy, but it does not grant
permission to bypass emergency denies. Full-access output still carries the
documented emergency deny controls. Native model selection, product discovery,
and manual registration require the product-specific procedure; they are not
performed by these commands.

See the [repository overview](../../README.md), [surface manifests](../../installers/manifests/agy.json),
[Antigravity 2.0 compatibility notes](../compatibility/antigravity-2.md), and the
[evaluation method and current limitations](../evaluations/method.md). After an
approved install, follow [native registration](../maintenance/native-registration.md),
[native verification](../maintenance/native-verification.md), and
[cross-tool quality](../maintenance/cross-tool-quality.md).
