# Antigravity 2.0 Desktop fixture templates

This directory documents the structural package rendered by the adapter. The
documented Desktop Plugins layout under `.agents/plugins/` contains
`plugin.json`, `skills/`, `rules/`, and `hooks.json`.

The Desktop Plugins page omits `agents/`; the Desktop Subagents page
separately documents `agents/<role>.md`. Plugin-agent packaging is therefore
ambiguous and not guaranteed by the Plugins layout. This fixture retains
`agents/` only because the T010 role-template contract requires it; verify
agent discovery manually before relying on it.

Model selection and permission presets remain manual Desktop UI steps. The
adapter does not emit application settings, install a plugin automatically, or
execute a hook command. Desktop launch and acceptance are recorded as `not run`
until a real Desktop session is available.

## Native acceptance (not run)

Product version: `unknown`
Platform: `unknown`

Run this checklist manually in a disposable Antigravity 2.0 Desktop project;
the expected observations are evidence to record, not claims made by this
fixture:

1. `launch-and-discovery` — Launch Desktop and open a project containing
   `.agents/plugins/all-about-agents/plugin.json`; confirm discovery without
   automatic installation or a generated settings file.
2. `skill-and-rule-discovery` — Inspect the plugin; confirm skills, rules,
   `hooks.json`, and `plugin.json` load, and review the ambiguous `agents/`
   documentation split.
3. `agent-tool-safety` — Invoke every role and inspect tools; read-only roles
   must not expose `run_command`, while implementer retains its documented
   command workflow.
4. `model-policy` — Select `Gemini 3.7 Flash Medium`, send a second message,
   and confirm conversation-local stickiness; confirm Flash High is not offered.
5. `permission-deny` — Review the UI preset and manually exercise each
   emergency Deny rule; confirm `Deny > Ask > Allow` blocks matching requests.
6. `hooks-contract` — Inspect `hooks.json`; only with explicit approval,
   verify hook decisions using a disposable handler; confirm this package stays
   disabled and inert.
