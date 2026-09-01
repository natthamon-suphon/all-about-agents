# Antigravity contract evidence — 2026-08-31

This record lists current public contracts for Antigravity 2.0 Desktop and the
`agy` CLI. It does not prove that a local installation used every feature.
Native Windows results are kept in
[Native Windows evidence](native-windows-2026-08-31.md).

Retrieved: 2026-08-31

## agy CLI

- [Headless mode](https://antigravity.google/docs/cli/headless/) documents
  `-p`, `--model`, `--effort`, and `--dangerously-skip-permissions`. Its model
  list includes `gemini-3.7-flash-high`, and `high` is a valid effort value.
- [CLI plugins and skills](https://antigravity.google/docs/cli/plugins/)
  documents the installed plugin root
  `~/.gemini/antigravity-cli/plugins/<plugin_name>/`. A plugin may contain
  `plugin.json`, `hooks.json`, `skills/`, `agents/`, and `rules/`. The page also
  documents the `agy plugin list`, `install`, `enable`, `disable`, and
  `uninstall` commands.
- [CLI settings](https://antigravity.google/docs/cli/settings) documents the
  settings file `~/.gemini/antigravity-cli/settings.json`. The repository emits
  only a sparse overlay and does not write this file automatically.
- [CLI status line](https://antigravity.google/docs/cli/statusline/) documents
  a `statusLine` command block in that settings file. The CLI sends state JSON
  through stdin and renders the command's stdout in the prompt status line.
- [CLI subagents](https://antigravity.google/docs/cli/subagents) documents
  workspace and global agent discovery, Markdown agents, and the `/agents`
  panel. It links to the shared subagent schema.

## Shared agents and hooks

- [Subagents](https://antigravity.google/docs/subagents) documents plugin agent
  discovery, the supported frontmatter fields, and exact tool examples such as
  `view_file`, `grep_search`, `replace_file_content`, and `run_command`.
- [Hooks](https://antigravity.google/docs/hooks/) documents both Desktop and
  CLI transcript roots, the events `PreToolUse`, `PostToolUse`,
  `PreInvocation`, `PostInvocation`, and `Stop`, command handlers, JSON input
  and output, and the supported tool names.
- The hooks page does not document process failure behavior for a missing
  command, a non-zero exit, timeout, invalid JSON, or invalid output fields.
  The repository therefore keeps Antigravity and `agy` hooks disabled and does
  not claim fail-open or fail-closed behavior.

## Antigravity 2.0 Desktop

- [Desktop plugins](https://antigravity.google/docs/plugins) documents
  workspace plugin roots `.agents/plugins/` and `_agents/plugins/`, the global
  root `~/.gemini/config/plugins/`, and plugin skills, rules, MCP servers, and
  hooks.
- [Subagents](https://antigravity.google/docs/subagents) separately documents
  workspace agents under `.agents/agents/`, global agents under
  `~/.gemini/config/agents/`, and plugin agents under
  `plugins/<plugin_name>/agents/`.
- [Desktop skills](https://antigravity.google/docs/skills) documents workspace
  skills under `.agents/skills/<skill-folder>/` and global skills under
  `~/.gemini/config/skills/<skill-folder>/`.
- [Desktop rules](https://antigravity.google/docs/rules-workflows) documents
  global rules in `~/.gemini/GEMINI.md` and workspace rules in
  `.agents/rules/`.
- No reviewed public page above documents a Desktop settings key for model
  persistence or a native mapping for this repository's `aaa:*` actions. These
  remain manual or unknown. The Windows model display name is native evidence,
  not a public settings contract.
- No reviewed Desktop page documents a native Desktop status line settings
  key. The CLI status line contract must not be copied into Desktop claims.
