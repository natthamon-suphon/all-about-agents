# Antigravity CLI, Desktop, and IDE compatibility

Sibling pages: [Claude Code](claude-code.md) and [Codex](codex.md).

This page covers the Antigravity package and its native boundary. The observed
runtime is the `agy` CLI `1.2.7` on Windows.

The rendered package was installed on 2026-09-19 with
`setup --mode update --surface antigravity --apply`. `agy plugin list` reported
it, `agy agents` listed all seven roles, and a headless `agy -p` session run
from a directory with no `.agents/` folder named real skills and confirmed the
inlined routing contract. That is `runtime verified` for the CLI.

Antigravity Desktop and Antigravity IDE are two more apps. Both read the global
plugin slot that `agy plugin install` fills; without `agy`, the slot takes a
manual copy. Whether either app loaded the plugin stays `NOT_RUN_UNAVAILABLE`,
because neither has a headless mode. See
[Antigravity Desktop and IDE](#antigravity-desktop-and-ide).

Decision D6 of the 2026-09-18 plan removed the surface (commit `8cbfd3b`). The
owner reversed that decision on 2026-09-19, and commit `e36b3d5` restored it. See
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
| Status line | None rendered | No statusline is rendered. The Claude-only `--statusline-name` option is refused with `--surface antigravity` (exit code 2); with `--surface all` it reaches Claude alone. The removed adapters pointed one at a path the product never creates. |
| Permission deny rules | Recorded as a manual expectation only | This package never writes `antigravity-cli/settings.json`. |
| Antigravity Desktop and IDE | Loading `NOT_RUN_UNAVAILABLE` | Both read the documented global slot `~/.gemini/config/plugins/all-about-agents/`, which `agy plugin install` fills; without `agy` the copy is manual. Neither app has a headless mode. |

## What the package contains

```text
plugin.json                 name and description only, at the package root
GEMINI.md                   canonical rules, inlined routing contract, presentation
README.md                   install summary
agents/<role>.md            7 roles, Markdown with YAML frontmatter
skills/<skill>/SKILL.md     27 skills and their companion files
docs/manual-desktop.md      the Desktop and IDE global-slot procedure
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

`register` defaults to the `portable` profile. Pass the same `--profile` that
rendered the package; `npm run setup` renders `template` by default. A mismatch
fails with `package-profile-mismatch`.

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

This differs from Claude and Codex on purpose. `CLAUDE.md` and `AGENTS.md`
carry a marked block that registration replaces in place. `GEMINI.md` does
not: an operator may keep unrelated always-on sections in `~/.gemini/GEMINI.md`
or condense the managed body to fit the rule size limit below, and a replaced
block would undo that. Merge the managed body by hand instead.

Observed on `agy 1.2.7`: agy keeps only the first 24,020 characters of
`~/.gemini/GEMINI.md` and drops the rest without a session-visible error. The
only signal is a `Global rule truncated` line in
`~/.gemini/antigravity-cli/cli.log`. After a merge, count the characters of
the file and search that log for `truncated`.
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

## Antigravity Desktop and IDE

Antigravity Desktop (Antigravity 2, the `desktop` target of this adapter) and
Antigravity IDE are separate apps. The Windows record of 2026-08-31 lists
Desktop 2.11.0 and IDE 2.5.5 side by side; the macOS host had IDE 2.5.5 and no
Desktop on 2026-09-27. Google's plugin documentation says every Antigravity
app reads the global plugin root `~/.gemini/config/plugins/`, and Desktop and
the IDE also read a workspace `.agents/plugins/` folder
([Plugins](https://antigravity.google/docs/plugins)). The IDE's built-in
`agy-customizations` guide names `~/.gemini/config/` as the machine-wide root
and gives this priority order: a workspace `.agents/` copy, then entries
declared in `skills.json` or `plugins.json`, then the global root, then the
built-in skills, then globally declared entries. It says a higher-priority
customization wins a naming conflict, with same-name skills as its example.

`agy plugin install` fills `~/.gemini/config/plugins/all-about-agents/`, so a
host with `agy` needs no other step. On a host without `agy`, copy
`plugin.json`, `skills/`, and `agents/` there by hand, and replace an older
copy instead of merging into it. Do not also keep a copy in
`<workspace>/.agents/plugins/all-about-agents/`: the guide does not say how two
copies of one plugin combine.

Outside a plugin, the IDE reads global rules from `~/.gemini/GEMINI.md`,
`~/.gemini/AGENTS.md`, and `~/.gemini/config/rules/*.md`
([Rules](https://antigravity.google/docs/rules?app=antigravity-ide)), and
global skills from `~/.gemini/config/skills/`; the legacy
`~/.gemini/antigravity/skills/` is still read
([Skills](https://antigravity.google/docs/skills?app=antigravity-ide)).

Neither app has a headless mode, so this repository does not claim that the
plugin loaded. Check it in the Customizations panel (Desktop) or the
Customizations dropdown of the agent side panel (IDE).

The CLI, Desktop, and the IDE read one global folder. In 2026-09 that folder was
a collision point, because two adapters wrote different, surface-tagged payloads
into it; this package is one neutral payload. On `agy 1.2.7`, a run with a
workspace copy present as well produced no duplicate or shadow warning in
`~/.gemini/antigravity-cli/log/`. That is an absence of evidence, not proof
that two copies merge cleanly.

## Keeping the install current

`agy plugin install` copies the package, so a new render reaches Antigravity
only when registration runs again. `npm run setup -- --mode update --apply`
does that: it removes and registers the plugin for each surface. After a manual
`install --apply`, run
`register --surface antigravity --package-root "<ROOT>" --apply` again.

Use [native registration](../maintenance/native-registration.md),
[native verification](../maintenance/native-verification.md), and the
[cross-tool quality guide](../maintenance/cross-tool-quality.md) for the
evidence each lifecycle state needs.
