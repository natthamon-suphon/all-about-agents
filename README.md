# All About Agents

All About Agents is a portable, repository-only agent-system source. The
repository renders surface-specific packages; it does not launch a native
product, register an account, or claim that a product session has passed.

## Canonical repository layout

| Path | Responsibility |
| --- | --- |
| `core/` | Vendor-neutral records: 28 skills, 7 roles, 9 rules, workflows, commands, hooks, and evaluations. |
| `profiles/` | `portable` and `template` policy profiles. |
| `adapters/` | Claude, Codex, Antigravity 2.0, and agy renderers, manifests, native mappings, and limitations. |
| `installers/` | Root resolution, validation, deterministic planning, atomic writes, managed state, and launchers. |
| `scripts/aaa.mjs` | The repository CLI. |
| `tests/` | Static, contract, behavioral, integration, and snapshot checks. |

The old top-level `agents/`, `configs/`, `hooks/`, `setup/`, `statusline/`,
`skills/`, legacy Antigravity guide, and obsolete Claude plugin manifest are
isolated under [`quarantine/legacy/`](quarantine/README.md). New work must use
`core/`, `profiles/`, `adapters/`, and `installers/`; quarantined files are not
installer inputs or supported setup entrypoints. The Claude adapter now renders
its plugin manifest and local marketplace together inside the generated package.

## Requirements

- Node.js **22.12.0 or newer** (`node --version`).
- Windows: PowerShell and Node.js. See [Windows setup](docs/setup/windows.md).
- macOS: Bash or another POSIX `sh` and Node.js. See [macOS setup](docs/setup/macos.md).

## Safe repository workflow

Warning: `--apply` is installer-authoritative for the selected root. It may
replace differing regular files at declared destinations, writes atomically,
and creates no backup. Use a new disposable root first.

Run from the repository root:

```text
node scripts/aaa.mjs validate --scope all
node scripts/aaa.mjs install --surface claude --destination-root "<DISPOSABLE_ROOT>" --dry-run --statusline-name "<NAME>"
node scripts/aaa.mjs install --surface claude --destination-root "<DISPOSABLE_ROOT>" --apply --statusline-name "<NAME>"
```

`--dry-run` is the default, but it is written explicitly above. Unsafe roots,
symlinks/junctions, path escapes, invalid rendered content, and preflight
conflicts are rejected. Unknown neighboring paths are preserved. Managed state
is kept under `.all-about-agents/state.json` in the selected root.

Use `--format json` for machine-readable output. Successful validation and
successful dry-run/apply return exit code 0; invalid arguments, validation
failures, and rejected applies return non-zero. `doctor` reports repository and
runtime checks without opening a native product. `diff` is non-mutating.

## Maintain and share changes

Use these guides to keep the same source and quality on every machine:

- [Contributing protocol](CONTRIBUTING.md)
- [Sync and update](docs/maintenance/sync-and-update.md)
- [Skill development](docs/maintenance/skill-development.md)
- [Cross-tool quality](docs/maintenance/cross-tool-quality.md)
- [Native registration](docs/maintenance/native-registration.md)
- [Native verification](docs/maintenance/native-verification.md)
- [Prompt for another session](docs/maintenance/session-prompt.md)

A pull updates only the repository. It does not install files into a coding
tool. Installation always needs a separate, exact action.

Use this lifecycle for every surface:

```text
rendered -> validated -> registered -> trusted -> active -> runtime verified
```

Use [sync and update](docs/maintenance/sync-and-update.md) for the author and
receiving machine flows. Keep Git actions separate from native registration.
`register --dry-run` is for review. `register --apply` is an explicit native
mutation and needs exact authority. Restart or reload before checking `active`
or `runtime verified`.

## Surfaces and roots

Use `--surface claude|codex|antigravity-2|agy|all` and an explicit
`--destination-root` for qualification. Claude and Codex also have documented
environment-based roots, but the setup pages use disposable roots so a real
user configuration is not changed. Antigravity and `agy` have documented
native discovery roots. The repository still requires an explicit destination
and does not write those live roots automatically.

When `--surface all` is used with one explicit root, each package is placed in
a surface namespace below that root. This keeps surface files from colliding.
The adapters render package files and manual registration records; they do not
install a native plugin or run a native product.

The `portable` profile is the default. `template` selects the documented
template model/effort policy where the adapter supports it. Full-access policy
does not remove emergency deny rules. The rendered policy retains those deny
rules. Native enforcement is not claimed until a product runtime probe observes
it.

`--statusline-name` applies to Claude and `agy`. In an interactive install that
includes either surface, omitting it prompts for a name; non-interactive
invocation uses an empty name. A supplied name is trimmed, must contain at most 64 Unicode
code points, and may not contain control or ANSI characters.

## Compatibility and evaluation

Read the surface manifests for exact component paths and manual/native status:

- [Claude manifest](installers/manifests/claude.json)
- [Codex manifest](installers/manifests/codex.json)
- [Antigravity 2.0 manifest](installers/manifests/antigravity-2.json)
- [agy manifest](installers/manifests/agy.json)
- [Claude compatibility](docs/compatibility/claude.md)
- [Codex compatibility](docs/compatibility/codex.md)
- [Antigravity 2.0 compatibility](docs/compatibility/antigravity-2.md)
- [agy compatibility](docs/compatibility/agy.md)
- [Known limitations](docs/limitations/known-limitations.md)
- [Legacy quarantine disposition](quarantine/README.md)
- [Evaluation method and limitations](docs/evaluations/method.md)

Retained Windows evidence covers only the checks named in the evaluation
records. Filesystem and package evidence is not a native discovery or behavior
claim. Use the evaluation method and record unavailable checks as
`NOT_RUN_UNAVAILABLE`.
