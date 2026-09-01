# Claude Code contract evidence - 2026-08-31

Retrieved: 2026-08-31

Observed local CLI: `claude --version` returned `2.1.251 (Claude Code)` on
Windows. This is a local version observation. It is not a native model-call
check.

## Official contract facts

- [Claude Code settings](https://code.claude.com/docs/en/settings) documents
  user settings at `~/.claude/settings.json`, project settings, and the
  `CLAUDE_CONFIG_DIR` override. The settings file can carry model, permission,
  hook, plugin, and environment values.
- [Claude Code hooks](https://code.claude.com/docs/en/hooks) documents
  lifecycle hook events and command handlers. No separate native hook trust
  step was observed for this package flow, so trust stays
  `NOT_RUN_UNAVAILABLE`. Runtime execution remains separate evidence.
- [Claude Code skills](https://code.claude.com/docs/en/skills) documents
  folder-based `SKILL.md` discovery for project and plugin skills.
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
  documents Markdown custom agents and their discovery locations.
- [Claude Code plugins](https://code.claude.com/docs/en/plugins) documents
  plugin manifests and plugin-provided skills, agents, commands, and hooks.
- [Claude Code slash commands](https://code.claude.com/docs/en/slash-commands)
  documents the legacy command surface. Reusable new behavior remains in
  skills in this repository.
- [Claude Code status line](https://code.claude.com/docs/en/statusline)
  documents a `statusLine` settings object with `type: "command"`. Claude
  Code sends a JSON payload to the command through stdin and renders command
  stdout as the status line.

## Repository decision

- Use `docs/evaluations/research-claude-code.md` as the evidence source for
  Claude discovery, hooks, commands, plugin installation, and native status
  line records.
- Set `statusline.native` to supported and stable in the capability record.
  The value records the documented settings shape and JSON stdin/stdout
  contract. A repository renderer is not native runtime proof.
- Keep the native status line command under the configured Claude root. Do not
  use a plugin-only variable in a root settings command.
- Keep the observed product version `2.1.251` in the capability and installer
  records for this dated local observation.

## Unconfirmed

- Authenticated model calls, Fable access, hook execution, and status line
  persistence were not run in this repository session.
- Plugin discovery and strict validation have separate native evidence in the
  dated Windows record. They do not prove every skill or agent was invoked.
- Account, plan, organization, and product-version limits can prevent a
  documented model or feature from being available.
