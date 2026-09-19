# All About Agents

All About Agents is a portable, repository-only agent-system source. The
repository renders surface-specific packages; it does not launch a native
product, register an account, or claim that a product session has passed.

## Canonical repository layout

| Path | Responsibility |
| --- | --- |
| `core/` | Vendor-neutral records: 28 skills, 7 roles, 9 rules, hooks, and evaluations. |
| `profiles/` | `portable` and `template` policy profiles. |
| `adapters/` | Claude and Codex renderers, manifests, native mappings, and limitations. |
| `installers/` | Root resolution, validation, deterministic planning, atomic writes, managed state, and launchers. |
| `scripts/aaa.mjs` | The repository CLI. |
| `tests/` | Static, contract, lint, integration, and snapshot checks, plus the manual `test:model` trigger suite. |

Legacy files were removed in phase 1 of the simplification and remain in Git
history. New work must use `core/`, `profiles/`, `adapters/`, and
`installers/`. The Claude adapter renders its plugin manifest and local
marketplace together inside the generated package.

## Requirements

- Node.js **22.12.0 or newer** (`node --version`).
- Windows: PowerShell and Node.js. See [Windows setup](docs/setup/windows.md).
- macOS: Bash or another POSIX `sh` and Node.js. See [macOS setup](docs/setup/macos.md).

That is the whole requirement list. The repository declares no `dependencies`
and no `devDependencies`. Optional workstation tools such as `uvx`,
`ui-ux-pro-max-cli`, Ponytail, and Context7 are described in
[companion tooling](docs/setup/companion-tooling.md); none of them is needed to
render, validate, or install a package.

Native registration additionally needs the product binary to resolve. See
[native registration](docs/maintenance/native-registration.md).

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
- [Global instructions and presentation](docs/maintenance/global-instructions.md)
- [Sync and update](docs/maintenance/sync-and-update.md)
- [Skill development](docs/maintenance/skill-development.md)
- [Cross-tool quality](docs/maintenance/cross-tool-quality.md)
- [Native registration](docs/maintenance/native-registration.md)
- [Native verification](docs/maintenance/native-verification.md)
- [Prompt for another session](docs/maintenance/session-prompt.md)

Design specs for multi-phase changes live in `docs/plans/YYYY-MM-DD-<name>.md` and are
reviewed before phase 1 starts. Current:
[Simplify to Claude + Codex](docs/plans/2026-09-18-simplify-to-claude-codex.md) with its
[repository comparison](docs/plans/2026-09-18-repo-comparison.md).

A pull updates only the repository. It does not install files into a coding
tool. Installation always needs a separate, exact action.

The global layer gives shared safety and quality behavior. Project files and
plugin rules are the more specific second layer. Read [global instructions and
presentation](docs/maintenance/global-instructions.md) for the exact files,
destinations, emoji labels, and checklist rules.

On a receiving machine, use this exact order:

```text
pull -> validate -> render -> dry-run -> apply package -> dry-run registration -> explicit registration apply -> restart -> verify loaded instructions
```

Git is the source of truth. Pull does not install or write live configuration.
Package apply and native registration are separate explicit actions.

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

Use `--surface claude|codex|all` and an explicit `--destination-root` for
qualification. Claude and Codex also have documented environment-based roots,
but the setup pages use disposable roots so a real user configuration is not
changed. `install --apply` refuses to run without `--destination-root`
(`destination-root-required`), so the live roots are never written by
automatic discovery. Only `--dry-run`, `doctor`, and `diff` may resolve a root
from the environment.

When `--surface all` is used with one explicit root, each package is placed in
a surface namespace below that root: `<root>/claude` and `<root>/codex`. This
keeps surface files from colliding.
The adapters render package files and manual registration records; they do not
install a native plugin or run a native product.

The `portable` profile is the default. `template` selects the documented
template model/effort policy where the adapter supports it. Full-access policy
does not remove emergency deny rules. The rendered policy retains those deny
rules. Native enforcement is not claimed until a product runtime probe observes
it.

`--statusline-name` applies to Claude only. In an interactive install that
includes Claude, omitting it prompts for a name; non-interactive
invocation uses an empty name. A supplied name is trimmed, must contain at most 64 Unicode
code points, and may not contain control or ANSI characters.

## Compatibility and evaluation

Read the surface manifests for exact component paths and manual/native status:

- [Claude manifest](installers/manifests/claude.json)
- [Codex manifest](installers/manifests/codex.json)
- [Claude compatibility](docs/compatibility/claude.md)
- [Codex compatibility](docs/compatibility/codex.md)
- [Known limitations](docs/limitations/known-limitations.md)
- [Evaluation method and limitations](docs/evaluations/method.md)

Retained Windows evidence covers only the checks named in the evaluation
records. Filesystem and package evidence is not a native discovery or behavior
claim. Use the evaluation method and record unavailable checks as
`NOT_RUN_UNAVAILABLE`.
