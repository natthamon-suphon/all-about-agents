# Antigravity CLI and Desktop compatibility

Sibling pages: [Claude Code](claude.md) and [Codex](codex.md).

This page covers the Antigravity package and its native boundary. The observed
runtime is the `agy` CLI `1.2.7` on Windows.

The rendered package was installed on 2026-09-19 with
`setup --mode update --surface antigravity --apply`. `agy plugin list` reported
it, `agy agents` listed all seven roles, and a headless `agy -p` session run
from a directory with no `.agents/` folder named real skills and confirmed the
inlined routing contract. That is `runtime verified` for the CLI.

Antigravity Desktop remains `NOT_RUN_UNAVAILABLE`: it has no headless mode.

The surface was removed on 2026-09-18 and restored on 2026-09-19. See
[the restoration plan](../plans/2026-09-19-restore-antigravity.md) for the
decisions behind the shape of this package, and
[the product contract evidence](../evaluations/research-antigravity.md) for the
observations behind those decisions.

## Lifecycle and support

Use these states in order:

```text
rendered -> validated -> registered -> trusted -> active -> runtime verified
```

`agy plugin validate` is read-only and gives `validated`. `agy plugin list`
gives `registered`. There is no separate trust step. A fresh session is needed
for `active` and `runtime verified` evidence, and the session must run from a
directory with no `.agents/` folder, or the answer cannot say which copy of the
package was loaded.

| Capability | Current evidence | Boundary |
| --- | --- | --- |
| Skills and roles | `agy plugin validate` reported 28 skills and 7 agents; a headless session named real skills and `agy agents` listed all seven | Desktop loading is not claimed. |
| `GEMINI.md` | Deployed only when the destination does not already differ | On a machine with an existing file, the routing contract needs one manual merge. |
| Plugin registration | `agy plugin install <dir>`, then `agy plugin list` and `agy agents` listed the package and all seven roles | The install is a copy; it does not follow later renders. |
| Routing contract | Inlined into `GEMINI.md`; a headless session quoted its first heading | Whether the model follows the contract is a behavior question, not a discovery one. |
| Hooks | None rendered | No session-start event can be named with current evidence; the recorded event list is inherited from the 1.1.22 evaluation. Do not infer hook support from another product. |
| Status line | None rendered | The removed adapters pointed one at a path the product never creates. |
| Permission deny rules | Recorded as a manual expectation only | This package never writes `antigravity-cli/settings.json`. |
| Antigravity Desktop | `NOT_RUN_UNAVAILABLE` | No headless mode; the workspace slot is a manual copy. |

## What the package contains

```text
plugin.json                 name and description only, at the package root
GEMINI.md                   canonical rules, inlined routing contract, presentation
README.md                   install summary
agents/<role>.md            7 roles, Markdown with YAML frontmatter
skills/<skill>/SKILL.md     28 skills and their companion files
docs/manual-desktop.md      the Desktop workspace-slot procedure
```

`plugin.json` must sit at the package **root**. Pointing `agy plugin validate`
at a package whose manifest is under `.claude-plugin/` fails with
`missing plugin.json`.

## Install and register

```text
node scripts/aaa.mjs install --surface antigravity --destination-root "<ROOT>" --dry-run
node scripts/aaa.mjs install --surface antigravity --destination-root "<ROOT>" --apply
node scripts/aaa.mjs register --surface antigravity --package-root "<ROOT>" --dry-run
node scripts/aaa.mjs register --surface antigravity --package-root "<ROOT>" --apply
```

Registration runs `agy plugin validate`, then `agy plugin install`, then
`agy plugin list`, and deploys `GEMINI.md`. `agy` must resolve on `PATH`; when
it does not, the run is `NOT_RUN_UNAVAILABLE`, not a failure.

`agy plugin install` takes a plain directory and needs no Git repository. That
is the opposite of `codex plugin add`, which clones its source.

`agy plugin uninstall <name>` exits 0 and prints `Uninstalled plugin "<name>"`
even for a name that was never installed, so its exit code is not evidence that
anything was removed. `setup` runs it only to clear a cached copy before the
reinstall, and treats it as best-effort.

## GEMINI.md is never overwritten

The `GEMINI.md` deploy carries `guard: "no-clobber"`. When the destination
already exists and differs from the managed source, registration reports
`manual-required` and writes nothing.

This differs from Claude on purpose. `CLAUDE.md` is deployed without the guard
because the Claude render is a superset of the live file. The Antigravity render
is not: an operator may keep unrelated always-on sections in `~/.gemini/GEMINI.md`,
and overwriting would delete them. Merge the managed body by hand instead, or
point `--instruction-root` at a disposable directory first and compare.

## Configuration root

The root is the user's `.gemini` directory. Antigravity documents no environment
variable for it, so none is read.

For qualification and tests this repository defines its own override,
`AAA_ANTIGRAVITY_ROOT`. It is not a product variable. `install`, `doctor`,
`diff`, and `register` all honor it; without it every run resolves to the
operator's live home.

## Models and effort

`agy models` lists the available slugs; `agy --help` documents
`--effort low|medium|high`.

The `portable` profile changes neither. The `template` profile records
`gemini-3.1-pro-high` as the approved model and emits it as a **manual** step:
selection happens through `agy --model` or the `/model` command, because no
documented on-disk key persists it.

## Antigravity Desktop

Desktop is registered by hand. Copy `plugin.json`, `skills/`, and `agents/` into
`<workspace>/.agents/plugins/all-about-agents/` and add `.agents/plugins/` to
that workspace's ignore file.

ASSUMPTION MADE: Desktop reads the per-workspace slot rather than the shared
plugin root. The source is a 2026-09-03 observation, not a check on the current
Desktop build. Open Desktop and ask it to name a skill before treating the slot
as active.

The CLI and Desktop share `~/.gemini/config/plugins/`. In 2026-09 that was a
collision because two adapters wrote different, surface-tagged payloads into one
slot. This package is a single neutral payload, so both slots now carry the same
files. Running the CLI with both present produced no duplicate or shadow warning
in `~/.gemini/antigravity-cli/log/` on `agy 1.2.7`, which is an absence of
evidence rather than proof that the product merges them cleanly.

## Keeping the install current

`agy plugin install` copies the package. A later `setup --mode update` refreshes
the package root but not the installed copy, so re-run registration after every
package update.
