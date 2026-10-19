# Current Antigravity contract update - 2026-10-19

This section supersedes the older hook/model assumptions retained below as
historical evidence. Current Windows CLI version: `agy 1.4.2`.

- [Official hooks](https://antigravity.google/docs/hooks/) documents
  `SessionStart`, `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`
  and `Stop` for App/CLI/IDE. `PreCompact` is not established. Keep one inlined
  bootstrap carrier instead of adding duplicate injection.
- `agy models` listed Gemini 4 Argon low/medium/high variants. `models --json`
  and `models --output-format json` were rejected by this installed binary.
  Observed TSV parsing is version-sensitive and must fail when format changes.
- Read-only `agy -p "/model" --output-format json` and `/effort` returned
  command metadata, zero turns and zero tokens. `/model` is current selection,
  not a structured catalog. `/effort` advertised low/medium/high on this account.
- [Effort documentation](https://antigravity.google/docs/cli/commands/effort)
  lists xhigh/max only for models that offer those variants. `/model` and
  `/effort` persist explicit defaults; launch flags do not.
- [Model eligibility](https://antigravity.google/docs/models/) excludes Gemini
  4 Argon from standalone IDE. No supported universal automatic GUI selection
  key/API was verified in models, settings, hooks or IDE launcher help.
- [Custom subagents](https://antigravity.google/docs/subagents/) applies to
  App/CLI. `model: inherit` and `commandExecutionPolicy: eager` are documented
  declarations; omission otherwise defaults the command policy to sandbox.
  Parent file/sandbox boundaries inherit; effective eager behavior and IDE
  support remain native verification gaps.
- `agy plugin list` produces human output unless `--json` is supplied. The
  registration planner now requests JSON and keeps strict parsing.
- `agy plugin validate <path> --strict --json` on 1.4.2 rejected both profile
  packages with one warning: `never loaded: plugins load rules only from
  rules/. Move it to rules/GEMINI.md`. Moving only the staging file to
  `config/GEMINI.md` made both return exit 0 with no findings. The adapter and
  registration now use that staging path while keeping the native global
  destination `~/.gemini/GEMINI.md`; no second rule carrier is introduced.

Native model turns, App/IDE loading and macOS execution were not performed in
this update. See [model policy](../maintenance/model-policy.md) for managed
launch scope and explicit unavailable results.

---

# Antigravity product contract evidence - 2026-09-19

Retrieved: 2026-09-19

Observed local CLI: `agy --version` returned `1.2.7` on Windows. Antigravity
Desktop was present at its installed path but was not exercised: it has no
headless mode.

This record covers the surface restored by
[the restoration plan](../plans/2026-09-19-restore-antigravity.md). It replaces
nothing: the earlier `agy` and `antigravity-2` records in
[native-windows-2026-08-31.md](native-windows-2026-08-31.md) describe two
adapters that no longer exist.

## Observed command contract

Read from `agy --help` and `agy plugin --help` on 1.2.7:

- Subcommands include `agent`/`agents`, `mcp`, `models`, `plugin`/`plugins`,
  `install`, `update`, and `remote-control`.
- `agy plugin` exposes `list`, `import [source]`, `install <target>`,
  `uninstall <name>`, `enable <name>`, `disable <name>`, `validate [path]`, and
  `link <mp> <target>`.
- Session flags include `--model`, `--effort low|medium|high`, `--agent`,
  `--print`/`-p`, `--output-format text|json|stream-json`, and
  `--print-timeout`.

## Plugin package shape

- `agy plugin validate <path>` is read-only. It prints one processed count per
  component and names the components it knows: `skills`, `agents`, `commands`,
  `mcpServers`, and `hooks`. A `rules` folder is not a processed component.
- The manifest must be `plugin.json` at the **package root**. Pointing the
  validator at a package whose manifest lives in `.claude-plugin/` fails with
  `missing plugin.json`.
- Skills use `skills/<skill>/SKILL.md`. Roles use flat `agents/<role>.md` with
  YAML frontmatter.
- `agy plugin install <path>` accepts a plain local directory. It does **not**
  clone the source with git, unlike `codex plugin add`, which fails on a
  non-repository with `does not appear to be a git repository`.
- The installed copy lands in `~/.gemini/config/plugins/<name>/`. It is a copy:
  a later render of the package root does not reach it.
- `agy plugin uninstall <name>` exits 0 and prints `Uninstalled plugin "<name>"`
  even for a name that was never installed, so its exit code is not evidence
  that anything was removed.

## Lifecycle events - inherited, not re-verified

**Status: inferred.** The event list on record is
`PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, and `Stop`,
with no `SessionStart`. That list is **not** a 1.2.7 observation. It comes from
the capability record of the removed `agy` adapter
(`git show 8cbfd3b^:adapters/agy/capabilities.json`), checked on 2026-08-31
against `agy 1.1.22`.

What 1.2.7 does show:

- `agy --help` and `agy plugin --help` expose no hook subcommand and document
  no event names, so the CLI publishes nothing to re-verify the list against.
- `agy plugin validate` counts `hooks` as one of its components, so a plugin on
  1.2.7 can carry hooks. What events they may declare is not established here.

Consequence for this repository: no event can be *named* with current evidence,
and the portable-routing rule forbids inventing one. So no hook is rendered,
and the `using-all-about-agents` routing contract is inlined into the rendered
`GEMINI.md` instead. If a future check establishes a session-start event on
this surface, the inlining becomes removable.

## Global instructions

`~/.gemini/GEMINI.md` is loaded every session. A headless session quoted its
first heading back, which is discovery evidence, not a behavior claim.

No environment variable for the Gemini home is documented, so none is read.
This repository defines `AAA_ANTIGRAVITY_ROOT` for qualification runs only; it
is a repository variable, not a product one.

## Models and effort

`agy models` listed, strongest first for the Gemini family:

```text
gemini-3.8-flash-high / -medium / -low
gemini-3.7-flash-high / -medium / -low
gemini-3.6-flash-high / -medium / -low
gemini-3.1-pro-high / gemini-3.1-pro-low
```

The `template` profile records `gemini-3.1-pro-high`. Selection is manual
through `--model` or `/model`: no documented on-disk key persists it, so the
adapter emits it as a manual step rather than writing a settings file.

## Runtime observation

Run from a directory with no `.agents/` folder, so no workspace copy of the
package could answer instead of the global install:

- `agy agents` listed all seven canonical role names.
- `agy -p` quoted `# Global Operating Rules`, confirmed a `Routing contract`
  section, and named three real skill folders.

Inside a workspace that carries its own copy of the package, the same answer
proves nothing about the global install, because the two copies hold the same
files.

## Not run

- The lifecycle event list on 1.2.7. The recorded list is inherited from the
  1.1.22 evaluation; no 1.2.7 source re-states it.
- Antigravity Desktop discovery, active state, and runtime behavior. No
  headless mode.
- Permission deny enforcement. This repository writes no settings file for this
  surface.
- macOS. No host was available.
- Authenticated model transport and any model-quality claim.

## Addendum 2026-09-27: Desktop and IDE plugin discovery

This addendum records documentation, not a runtime check. The 2026-09-19
findings above stay as they were.

Antigravity Desktop (Antigravity 2, this adapter's `desktop` target) and
Antigravity IDE are separate apps; `native-windows-2026-08-31.md` lists
Desktop 2.11.0 and IDE 2.5.5 on one host. The macOS host had Antigravity IDE
2.5.5 (`CFBundleShortVersionString` of the app bundle), no Desktop, and no
`agy` CLI.

Sources, read on 2026-09-27:

- [Plugins](https://antigravity.google/docs/plugins): the page covers
  Antigravity 2.0, the Antigravity CLI, and Antigravity IDE. The global
  plugin root `~/.gemini/config/plugins/` applies to all of them, and 2.0 and
  the IDE also read a workspace `.agents/plugins/`. The IDE view of the page
  ([Plugins, IDE](https://antigravity.google/docs/plugins?app=antigravity-ide))
  says the IDE needs no CLI to install a plugin and shows loaded parts in the
  Customizations dropdown of the agent side panel.
- [Skills](https://antigravity.google/docs/skills?app=antigravity-ide): global
  skills live in `~/.gemini/config/skills/`, and the legacy
  `~/.gemini/antigravity/skills/` is still supported. Workspace skills live in
  `<workspace>/.agents/skills/`.
- [Rules](https://antigravity.google/docs/rules?app=antigravity-ide): global
  rules are `~/.gemini/AGENTS.md`, `~/.gemini/GEMINI.md`, and
  `~/.gemini/config/rules/*.md`.
- [Subagents](https://antigravity.google/docs/subagents?app=antigravity-ide):
  global subagents live in `~/.gemini/config/agents/`, and a plugin's
  `agents/` folder is read too.
- The IDE's built-in `agy-customizations` skill (under
  `~/.gemini/antigravity-ide/builtin/skills/`) names `~/.gemini/config/` as the
  machine-wide root and gives the priority order: workspace `.agents/`, then
  declared `skills.json` or `plugins.json` entries, then the global root, then
  built-in skills, then globally declared entries. It says a higher-priority
  customization wins a naming conflict, with same-name skills as its example.

Consequence: the documentation contradicts the 2026-09-03 assumption that
Desktop reads only a per-workspace slot. `agy plugin install` fills the global
slot; on a host without `agy`, the package is copied there by hand.

Not run: whether Desktop or the IDE loaded the copy. Neither app has a
headless mode; the check is the app's Customizations view.

## Addendum - 2026-09-28: global rule files and size limits

Observed local CLI: `agy --version` returned `1.2.12` on Windows (it was
`1.2.7` earlier the same day and updated itself).

- Google's [Rules](https://antigravity.google/docs/rules) page lists `~/.gemini/AGENTS.md` or
  `~/.gemini/GEMINI.md`, `~/.gemini/config/AGENTS.md` or
  `~/.gemini/config/GEMINI.md`, and `~/.gemini/config/rules/*.md` as global
  rules. It says "Antigravity truncates any single rule file that exceeds
  24,000 bytes" and "All active global and `always_on` rules share a
  20,000-token budget". A rule file needs a `trigger` of `always_on`,
  `model_decision`, `glob`, or `manual`.
- A probe file in `~/.gemini/config/rules/` without frontmatter was rejected:
  the log line was `rules.go:413] Invalid rule trigger:
  CORTEX_MEMORY_TRIGGER_UNSPECIFIED`, and a headless session answered NOT
  PRESENT for its first and last line.
- The same 8,633-character file with `trigger: always_on` was loaded: a
  headless session quoted its first and last line and, in the same answer,
  the last line of the 23,678-character live `GEMINI.md`. The byte limit is
  therefore per file, not one shared budget of 24,000.
- The probe file was deleted afterwards.

Consequence: the canonical rules and the presentation catalog move to
`config/rules/all-about-agents.md`, and `GEMINI.md` becomes a marked block
like `CLAUDE.md` and `AGENTS.md`. The operator's always-on sections then fit
beside the block without a hand-condensed copy.
