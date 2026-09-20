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
