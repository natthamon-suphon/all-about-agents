# Companion tooling

This page lists tools an operator installs **alongside** this repository on a
workstation. None of them is a repository dependency.

The repository itself stays zero-dependency: `package.json` declares no
`dependencies` and no `devDependencies`, and a static check enforces that. The
only requirement to render, validate, or install a package is Node.js 22.12.0
or newer. See the [repository overview](../../README.md).

Everything below is optional. Install a tool only when you want the capability
it provides, and record the version you installed. A tool that is absent is
`NOT_RUN_UNAVAILABLE` for any check that needs it, not a failure.

## What each tool is for

| Tool | Kind | Provides |
| --- | --- | --- |
| `uvx` | Python runner | Runs Python entry points for skills that ship `.py` scripts, without a project virtual environment. |
| `ui-ux-pro-max-cli` | npm CLI | Installs the UI/UX Pro Max skill into supported AI coding assistants. |
| Ponytail | agent plugin | A "lazy senior developer" ruleset that pushes an agent to write less code. |
| Caveman | skill set plus an operator-written hook | Compresses agent prose without dropping technical detail. Ships no hook of its own. |
| Context7 | MCP server | Fetches current library documentation into a session instead of relying on model memory. |
| RTK | CLI proxy | Trims shell output before it reaches the session context, and reports the measured saving. |

## `uvx`

`uvx` is the tool runner that ships with `uv`. Install `uv` from the
[official installation guide](https://docs.astral.sh/uv/getting-started/installation/),
then confirm the runner:

```text
uvx --version
```

Windows note: a winget or Python-scripts install can put more than one `uvx.exe`
on `PATH`. Run `where.exe uvx` and keep the one you intend to use first.

## `ui-ux-pro-max-cli`

```text
npm install -g ui-ux-pro-max-cli
uipro --help
```

The package installs the `uipro` binary. An older `uipro-cli` package provides
the same binary name; install only one of the two so the resolved `uipro` is
unambiguous.

## Ponytail

Ponytail is an MIT-licensed plugin published at
[`DietrichGebert/ponytail`](https://github.com/DietrichGebert/ponytail). It
registers through the same plugin surfaces this repository uses, so it can be
installed next to `all-about-agents` on each tool.

Claude Code:

```text
/plugin marketplace add DietrichGebert/ponytail
/plugin install ponytail@ponytail
```

Codex CLI:

```text
codex plugin marketplace add DietrichGebert/ponytail
codex plugin add ponytail@ponytail
```

Its lifecycle hooks need Node.js on `PATH`. Ponytail and `all-about-agents`
are separate plugins in each product's plugin root; they do not overwrite each
other.

Ponytail reads its default level from `PONYTAIL_DEFAULT_MODE`, then from a
config file, then falls back to `full`. The config path is platform-specific:
`$XDG_CONFIG_HOME/ponytail/config.json` when that variable is set,
`~/.config/ponytail/config.json` on macOS and Linux, and
`%APPDATA%\ponytail\config.json` on Windows. Do not assume `~/.config` on
Windows.

To confirm the plugin is active in a session, read the flag file its
`SessionStart` hook writes:

```text
cat "$CLAUDE_CONFIG_DIR/.ponytail-active"
```

`CLAUDE_CONFIG_DIR` defaults to `~/.claude`. The file holds the active level.
An absent file means the hook did not run.

Ponytail changes how an agent decides what to write. It is guidance, not a
guardrail, and it does not replace the emergency deny rules in this repository's
profiles.

## Caveman

Caveman is a set of skills that compress agent prose while keeping code, error
strings, and technical terms exact. It is published at
[`JuliusBrussee/caveman`](https://github.com/JuliusBrussee/caveman).

Unlike Ponytail, the copy installed as plain skills ships **no lifecycle hook**,
so nothing activates it at session start. The skills load on demand only. To
start every session in caveman mode you add a `SessionStart` hook yourself.

### Install the skills

The skills live in the personal skills directory, one folder per skill:

```text
~/.claude/skills/caveman
~/.claude/skills/caveman-commit
~/.claude/skills/caveman-help
...
```

How a given machine acquired them is not recorded here. Copy the `caveman*`
folders from a machine that already has them, or install from upstream and read
what that package ships before adding a hook of your own. If upstream already
ships a working `SessionStart` hook, use it and skip the rest of this section.

### Activation hook

The activator, the level config, and the Codex plugin live together in one
operator-owned folder:

```text
~/.caveman/caveman-activate.js      resolves the level, emits the skill text
~/.caveman/codex-plugin/            the Codex plugin that carries the hook
~/.config/caveman/config.json       {"defaultMode": "full"}
```

Copy that folder to the new machine, then wire each product. The full
procedure, including hosts outside this repository's scope, is kept next to the
files in `~/.caveman/README.md`.

Claude Code reads a `SessionStart` hook straight from user settings. Merge this
into `~/.claude/settings.json`; do not replace the file, which also holds your
plugins and other hooks:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|resume|clear|compact",
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["<HOME>/.caveman/caveman-activate.js", "--surface", "claude"],
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

The `args` exec form spawns the executable directly with no shell, so a Windows
path with spaces or `$` never reaches a shell parser.

Codex needs a plugin. Two facts observed on Codex `v0.152.1`, both of which
cost a debugging cycle:

- A `SessionStart` hook written to `$CODEX_HOME/hooks.json` is **parsed but not
  executed**. Invalid JSON there produces `warning: failed to parse hooks
  config`, which proves the file is read, yet the handler never runs. Hooks
  delivered by an installed plugin do run in the same session. The cause is not
  established; prefer the plugin path.
- `codex plugin add` clones the plugin source with `git`, so a local plugin
  directory must be a git repository with at least one commit, or the install
  fails with `does not appear to be a git repository`.

```text
cd ~/.caveman/codex-plugin
git init && git add -A && git commit -m "Caveman Codex plugin source"
codex plugin marketplace add ~/.caveman/codex-plugin
codex plugin add caveman@caveman
```

### Verify

Ask the product itself, in a fresh session:

```text
claude -p "Is caveman mode active? Name the level."
codex exec "One short line: is caveman mode active and at what level?"
```

A hook that is written but never fires is the common failure, and only a live
answer separates *installed* from *runtime verified*.

Caveman changes how an agent writes, not what it is allowed to do. It is
guidance, not a guardrail.

## Context7

Context7 is an MCP server from Upstash that serves current library
documentation. Register it with Claude Code:

```text
claude mcp add --scope user context7 -- npx -y @upstash/context7-mcp@latest
claude mcp list
```

It needs Node.js 18 or newer. Some deployments require an API key; pass it with
`--api-key` only from your own shell, and never commit it to this repository.
See the [package page](https://www.npmjs.com/package/@upstash/context7-mcp).

## RTK

RTK, also called `rust-token-killer`, is a local CLI proxy. It filters and
summarizes shell output before that output reaches the session context. Install
it from the project's own instructions, then confirm the binary:

```text
rtk --version
rtk gain
```

A failing `rtk gain` usually means a different tool named `rtk` resolves first
on the path. Check the resolved binary with `where.exe rtk` on Windows or
`which rtk` on macOS. The `rtk rg` subcommand shells out to ripgrep, so install
ripgrep as well when you want it.

On `rtk 0.47.0`, `rtk gain --history` printed the same summary as plain
`rtk gain` and no per-command history, so do not rely on that flag as evidence
that a specific command was proxied. The running total in `rtk gain` moving
across two calls is the cheaper proof that the hook is wrapping commands.

Hosts pick RTK up through a hook, which rewrites a plain shell command into an
`rtk` call. Claude Code uses a `PreToolUse` hook that runs `rtk hook claude`,
and Gemini CLI uses `rtk hook gemini`. Codex has no RTK hook today, so put
`rtk` in front of the command yourself there.

RTK changes how much command output reaches the model. It is a context-cost
tool, not a guardrail. It does not replace any check in this repository, and a
machine without it is `NOT_RUN_UNAVAILABLE`.

## Recording what you installed

Companion tooling is part of the machine, not part of the package. When you
report native evidence, list the tool, its version, and how it was resolved, and
keep it separate from the `rendered -> validated -> registered -> trusted ->
active -> runtime verified` states of this repository's own package. See
[native verification](../maintenance/native-verification.md).
