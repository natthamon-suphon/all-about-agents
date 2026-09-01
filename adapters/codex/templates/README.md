# Codex adapter templates

The adapter renders a deterministic Codex package from the canonical core.
It writes a regular `AGENTS.md` whose first section is the shared canonical
global body, followed by Codex rules, one compact presentation catalog, and
the canonical action-to-workflow mappings. Repository skills live under
`.agents/skills/`, and standalone custom-agent TOML files live under
`.codex/agents/`.

Visible skill, agent, command, and workflow entries use the canonical display
name plus its registered emoji. Each prompt or action includes one short
reason and one bounded checklist. This is model guidance: it keeps the
machine IDs, TOML keys, file paths, and native discovery names unchanged.

Every canonical role is registered in `config.toml` as `[agents.<role>]` with
a relative `config_file` under the delivered `agents/` directory. The package
maps its `.codex/agents/` source directory to that `$CODEX_HOME/agents/`
destination, so the reference resolves after installation. The referenced standalone role file contains
`name`, `description`, `developer_instructions`, and top-level `sandbox_mode`:
`read-only` for six read-only roles and `workspace-write` only
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
Codex does not claim an automatic Sol-to-Terra fallback.

Native workspace controls do not enforce the implementer's narrower task paths;
those paths remain an outer approval boundary.

The generated bootstrap skill links to the factual adapter guide at
`.agents/skills/using-all-about-agents/references/adapter-capability-guidance.md`.

When a canonical skill source is not present yet, its rendered `SKILL.md` is
marked `DEFERRED` and the result reports the owning cycle-05 remediation
diagnostic. This keeps the full public skill inventory visible without
claiming unavailable source content.

The package does not define repository schedules or a Codex-native statusline.
The global `AGENTS.md` output is kept below the repository's 32 KiB Codex
instruction gate and does not copy the shared global body into each skill or
role prompt.

The global layer is `<CODEX_HOME>/AGENTS.md`; project `AGENTS.override.md` or
`AGENTS.md` and plugin rules are the more specific second layer. A visible
name uses its registry emoji after the ID, then a short reason and a 2-to-7
item checklist. This is prompt guidance, not a UI guarantee.

For a receiving machine, use `pull -> validate -> render -> dry-run -> apply
package -> dry-run registration -> explicit registration apply -> restart ->
verify loaded instructions`. Pull alone does not install or write live config.
