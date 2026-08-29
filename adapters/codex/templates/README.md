# Codex adapter templates

The adapter renders a deterministic Codex package from the canonical core.
It writes a regular `AGENTS.md`, repository skills under `.agents/skills/`,
and standalone custom-agent TOML files under `.codex/agents/`.

Every canonical role is registered in `config.toml` as `[agents.<role>]` with
a relative `config_file` under the delivered `agents/` directory. The package
maps its `.codex/agents/` source directory to that `$CODEX_HOME/agents/`
destination, so the reference resolves after installation. The referenced role layer sets top-level
`sandbox_mode`: `read-only` for six read-only roles and `workspace-write` only
for the scoped implementer. Relative paths resolve from the declaring
`config.toml`, as documented by the official
[Codex Configuration Reference](https://developers.openai.com/codex/config-reference/).
The published docs do not show one combined registration example, so native
client acceptance remains a later manual check.

The shared `config.toml` overlay uses Sol with Max reasoning. The explicit
`terra-max.config.toml` overlay contains the same role registrations plus only
the documented Terra model and Max reasoning keys for its global policy; it is
selected manually with the CLI profile mechanism.
Desktop Terra/Max selection remains a manual model-control step.

The generated bootstrap skill links to the factual adapter guide at
`.agents/skills/using-all-about-agents/references/adapter-capability-guidance.md`.

When a canonical skill source is not present yet, its rendered `SKILL.md` is
marked `DEFERRED` and the result reports the owning cycle-05 remediation
diagnostic. This keeps the full public skill inventory visible without
claiming unavailable source content.

The package does not define repository schedules or a Codex-native statusline.
