# macOS setup

This procedure renders the repository package into a disposable directory. It
does not launch Claude, Codex, Antigravity 2.0, or agy, change a live product
configuration, or prove native discovery. Use a new root for every qualification
run.

## Prerequisites

- Node.js 22.12.0 or newer:

  ```sh
  node --version
  ```

- Bash or another POSIX `sh`.
- A checkout of this repository. Run the commands from its repository root.

The launcher at `installers/install.sh` resolves its own directory and forwards
the CLI arguments to `scripts/aaa.mjs`.

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
bash ./installers/install.sh install --surface claude --profile portable --destination-root "$CLAUDE_ROOT" --statusline-name "AAA" --dry-run --format json
bash ./installers/install.sh install --surface claude --profile portable --destination-root "$CLAUDE_ROOT" --statusline-name "AAA" --apply --format json
```

Inspect the dry-run JSON before the explicit `--apply`. A successful dry-run
does not write files. Apply preflights the selected surface before the first
write, uses atomic file replacement, and returns a non-zero exit code when the
plan is rejected or incomplete.

`--statusline-name` is Claude-only. In an interactive install that includes
Claude, omitting it prompts for the name; the non-interactive default is empty.
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

Antigravity 2.0 and agy require explicit roots because the repository does not
guess a persistent native root. Their manifests keep native installation and
hook execution manual.

To render all four packages in one disposable tree, use one more explicit root:

```sh
ALL_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/all-about-agents-all.XXXXXX")"
bash ./installers/install.sh install --surface all --destination-root "$ALL_ROOT" --statusline-name "AAA" --dry-run
bash ./installers/install.sh install --surface all --destination-root "$ALL_ROOT" --statusline-name "AAA" --apply
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
[evaluation method and current limitations](../evaluations/method.md).
