# Codex adapter templates

The adapter renders a deterministic Codex package from the canonical core.
It writes a regular `AGENTS.md`, repository skills under `.agents/skills/`,
and standalone custom-agent TOML files under `.codex/agents/`.

The shared `config.toml` overlay uses Sol with Max reasoning. The explicit
`terra-max.config.toml` overlay contains only the documented Terra model and
Max reasoning keys; it is selected manually with the CLI profile mechanism.
Desktop Terra/Max selection remains a manual model-control step.

The generated bootstrap skill links to the factual adapter guide at
`.agents/skills/using-all-about-agents/references/adapter-capability-guidance.md`.

When a canonical skill source is not present yet, its rendered `SKILL.md` is
marked `DEFERRED` and the result reports the owning cycle-05 remediation
diagnostic. This keeps the full public skill inventory visible without
claiming unavailable source content.

The package does not define repository schedules or a Codex-native statusline.
