# Codex product contract evidence - 2026-08-31

Retrieved: 2026-08-31

Observed local CLI: `codex --version` returned
`codex-cli 0.151.0-alpha.7.2` on Windows. The alpha suffix is retained in
records; it is not promoted to a timeless command guarantee.

## Official contract facts

- [Codex hooks](https://developers.openai.com/codex/hooks) documents hook
  events, command and MCP handlers, and plugin-bundled hooks. An enabled
  plugin can load `hooks/hooks.json` from its plugin root.
- The [Codex hooks guide](https://developers.openai.com/codex/hooks) states
  that installing or enabling a plugin does not automatically trust its hooks.
  A user must review and trust the current hook definition before plugin hooks
  run. This repository reports registration, trust, active state, and runtime
  verification separately.
- [Codex plugins](https://developers.openai.com/codex/plugins) documents the
  Codex CLI plugin browser and marketplace-backed plugin installation. The
  guide says to start a new CLI session after installation before using bundled
  skills or tools.
- The current CLI help was captured locally with `codex plugin marketplace add
  --help`, `codex plugin add --help`, and `codex plugin list --help`. For this
  exact CLI version, the help exposes a local marketplace source, the
  `PLUGIN@MARKETPLACE` selector, and `--json` plus `--available` plugin-list
  output. These commands are version-scoped local evidence, not timeless
  product documentation.
- [Codex subagents](https://developers.openai.com/codex/subagents) documents
  the built-in `default`, `worker`, and `explorer` agents. It documents personal
  custom agents under `~/.codex/agents/` and project agents under
  `.codex/agents/`, with one standalone TOML file per agent.
- [Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
  documents global discovery from `CODEX_HOME/AGENTS.md` (or the override) and
  project discovery from `AGENTS.md` / `AGENTS.override.md` from the repository
  root down to the working directory.
- [Codex skills](https://developers.openai.com/codex/skills) documents
  repository skill discovery from `.agents/skills` between the working
  directory and repository root, plus user skills under `$HOME/.agents/skills`.

## Repository decision and affected fields

- Use this dated record as the source for Codex plugin, hook, agent,
  instruction, skill, command, and status line capability records. Each exact
  path above is tied to its official page; do not generalize it to an
  undocumented location.
- Keep Codex hooks as supported at the documented contract level, but do not
  call plugin hooks trusted or active before native registration and trust.
- Keep the direct plugin package and record marketplace registration as an
  explicit native action. A copied package is not registration evidence.
- Keep Codex status line capability unknown because the reviewed official Codex
  contracts do not document a native status line settings key.
- Keep the local CLI version `0.151.0-alpha.7.2` in the capability and
  installer records for this dated observation.

## Unconfirmed

- Native plugin registration, JSON discovery, hook execution, and hook trust
  were not run in this evidence collection.
- Codex Desktop and IDE behavior were not checked separately.
- The alpha CLI may change command flags or output. Re-run the version-scoped
  help checks after an upgrade.
