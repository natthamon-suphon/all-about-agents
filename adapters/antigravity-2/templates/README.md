# Antigravity 2.0 Desktop fixture templates

This directory documents the structural package rendered by the adapter. The
documented Desktop Plugins layout under `.agents/plugins/` contains
`plugin.json`, `skills/`, `rules/`, and `hooks.json`.

The Desktop Plugins page omits `agents/`; the Desktop Subagents page
separately documents `agents/<role>.md`. A native Windows Desktop 2.11.0
project session nevertheless discovered all seven packaged agents. Reverify
that behavior on other versions and platforms.

## Global instructions

The package root contains `GEMINI.md`, rendered from the shared canonical
global instruction source. Desktop uses the documented global destination
`~/.gemini/GEMINI.md`. Copy that one file manually after reviewing the package;
this adapter does not guess or write a Desktop settings file. The package root
file is rendered evidence, not proof that a Desktop session loaded it.

The consolidated plugin rule contains the presentation catalog once. Skills
and agents keep their native names and frontmatter, and add a display label,
reason, and small checklist for visible invocation.

Model selection and permission presets remain manual Desktop UI steps. The
adapter does not emit application settings, install a plugin automatically, or
execute a hook command. Hook events and JSON input/output are documented, but
hook-process failure behavior and plugin-root command resolution are not.
Native evidence is recorded per check; partial
discovery does not qualify untested hook, permission, or role behavior.

## Native acceptance (partial)

Product version: `2.11.0`
Platform: `win32`

Run this checklist manually in a disposable Antigravity 2.0 Desktop project;
the expected observations are evidence to record, not claims made by this
fixture:

1. `launch-and-discovery` — Launch Desktop and open a project containing
   `.agents/plugins/all-about-agents/plugin.json`; confirm discovery without
   automatic installation or a generated settings file.
2. `skill-and-rule-discovery` — Inspect the plugin; confirm 28 skills, the
   consolidated `rules/AGENTS.md`, `plugin.json`, and seven agents load. Confirm
   `hooks.json` is present, disabled, and inert; do not claim it loaded. Skills,
   the consolidated rule, and all seven agents passed in a disposable Windows
   Desktop 2.11.0 project.
3. `agent-tool-safety` — Invoke every role and inspect tools; read-only roles
   must not expose `run_command`, while implementer retains its documented
   command workflow.
4. `model-policy` — Select `Gemini 3.7 Flash High`, send a second message,
   and confirm conversation-local stickiness; do not infer a separate effort
   setting or cross-session persistence.
5. `permission-deny` — Select `Custom`, grant only the approved broad access,
   keep `Turbo mode` off, and manually exercise each
   emergency Deny rule; confirm `Deny > Ask > Allow` blocks matching requests.
6. `hooks-contract` — Inspect `hooks.json`; only with explicit approval,
   verify hook decisions using a disposable handler; confirm this package stays
   disabled and inert.

The global layer is `~/.gemini/GEMINI.md`. Workspace `.agents/rules/` and
plugin rules are the more specific second layer. Visible names keep native IDs
and add a registry emoji, a short reason, and a 2-to-7 item checklist. This is
prompt guidance, not a UI guarantee. A receiving machine follows:
`pull -> validate -> render -> dry-run -> apply package -> dry-run
registration -> explicit registration apply -> restart -> verify loaded
instructions`. Pull alone does not install the package.
