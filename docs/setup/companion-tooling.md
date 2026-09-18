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

Ponytail changes how an agent decides what to write. It is guidance, not a
guardrail, and it does not replace the emergency deny rules in this repository's
profiles.

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
