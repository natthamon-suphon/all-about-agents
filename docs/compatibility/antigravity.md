# Antigravity CLI and Desktop compatibility

Sibling pages: [Claude Code](claude-code.md) and [Codex](codex.md).

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
| Skills and roles | `agy plugin validate` reported 28 skills and 7 agents, before `nano-image-generator` was removed in `19f0b4f` (the package now has 27 skills and was not re-validated); a headless session named real skills and `agy agents` listed all seven | Desktop loading is not claimed. |
| `GEMINI.md` | Written when absent; never overwritten; an existing file is complete when it already contains the managed body as one block | Otherwise registration reports `manual-required` with exit code 1, and the routing contract needs one manual merge. |
| Plugin registration | `agy plugin install <dir>`, then `agy plugin list` and `agy agents` listed the package and all seven roles | The install is a copy; it does not follow later renders. |
| Routing contract | Inlined into `GEMINI.md`; a headless session quoted its first heading | Whether the model follows the contract is a behavior question, not a discovery one. |
| Hooks | None rendered | No session-start event can be named with current evidence; the recorded event list is inherited from the 1.1.22 evaluation. Do not infer hook support from another product. |
| Status line | None rendered | No statusline is rendered, so the Claude-only `--statusline-name` option has no effect here. The removed adapters pointed one at a path the product never creates. |
| Permission deny rules | Recorded as a manual expectation only | This package never writes `antigravity-cli/settings.json`. |
| Antigravity Desktop | `NOT_RUN_UNAVAILABLE` | No headless mode; the workspace slot is a manual copy. |

## What the package contains

```text
plugin.json                 name and description only, at the package root
GEMINI.md                   canonical rules, inlined routing contract, presentation
README.md                   install summary
agents/<role>.md            7 roles, Markdown with YAML frontmatter
skills/<skill>/SKILL.md     27 skills and their companion files
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

Registration first deploys `GEMINI.md` (see below), then runs
`agy plugin validate`, `agy plugin install`, and `agy plugin list`. `agy` must
resolve on `PATH`. When it does not, `register` still deploys `GEMINI.md`
first, then stops at the validate step with error
`native-executable-unavailable` and exit code 1. The report status is `partial`
when `GEMINI.md` was written or already held the managed body, and `failed`
when the no-clobber guard refused it. `npm run setup` reports that step as
`not-run-unavailable` in the first case and `manual-required` in the second.
Either way it continues with the other surfaces, and a `manual-required` step
ends the run with exit code 1.

`agy plugin install` takes a plain directory and needs no Git repository. That
is the opposite of `codex plugin add`, which clones its source.

`agy plugin uninstall <name>` exits 0 and prints `Uninstalled plugin "<name>"`
even for a name that was never installed, so its exit code is not evidence that
anything was removed. `setup` runs it only to clear a cached copy before the
reinstall, and treats it as best-effort.

## GEMINI.md is never overwritten

The `GEMINI.md` deploy carries `guard: "no-clobber"`. When the destination
already exists, it is complete when it contains the managed body as one
contiguous block; your own sections before or after it stay. When the body is
missing or edited, registration reports `manual-required`, writes nothing, and
the run ends with exit code 1 (`manual-step-required`).

This differs from Claude on purpose. `CLAUDE.md` is deployed without the guard
because the Claude render is a superset of the live file. The Antigravity render
is not: an operator may keep unrelated always-on sections in `~/.gemini/GEMINI.md`,
and overwriting would delete them. Merge the managed body by hand instead.
`<ROOT>/GEMINI.md` is the exact file registration deploys, so compare it
with `~/.gemini/GEMINI.md` directly. To preview the plan, set
`AAA_ANTIGRAVITY_ROOT` to a disposable directory and run `register --dry-run`.
Do not use `--apply` for a preview: the `agy` steps do not read that variable,
so `agy plugin install` still writes the live Antigravity plugin folder.

## Configuration root

The root is the user's `.gemini` directory. Antigravity documents no environment
variable for it, so the product itself reads none.

For qualification and tests this repository defines its own override,
`AAA_ANTIGRAVITY_ROOT`. It is not a product variable. `install`, `doctor`,
`diff`, and `register` all honor it; without it every run resolves to the
operator's live home. For `register` it moves only the `GEMINI.md`
destination: the `agy` steps run with the normal environment.

## Models and effort

`agy models` lists the available slugs; `agy --help` documents
`--effort low|medium|high`.

The `portable` profile changes neither. The `template` profile records
`gemini-3.1-pro-high` as the approved model and emits it as a **manual** step:
selection happens through `agy --model` or the `/model` command, because no
documented on-disk key persists it.

The package sets no model fallback. Automatic model fallback is unsupported and
not claimed.

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

`agy plugin install` copies the package, so a new render reaches Antigravity
only when registration runs again. `npm run setup -- --mode update --apply`
does that: it removes and registers the plugin for each surface. After a manual
`install --apply`, run `register --surface antigravity --apply` again.

Use [native registration](../maintenance/native-registration.md),
[native verification](../maintenance/native-verification.md), and the
[cross-tool quality guide](../maintenance/cross-tool-quality.md) for the
evidence each lifecycle state needs.
