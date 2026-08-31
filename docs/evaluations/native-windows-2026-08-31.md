# Native Windows evidence — 2026-08-31

This record separates observations from unrun checks. It contains no account
identifier, conversation identifier, prompt body, credential, or live settings
content. The agy/Antigravity observations used
`tests/.tmp/native-retest-20260831/`; the Codex and fresh agy checks used
`tests/.tmp/native-acceptance-20260831-b/`; and the corrected Claude install
used `tests/.tmp/native-acceptance-20260831-c/`. All were disposable roots.

## Environment

| Product | Observed version | Platform | Scope |
| --- | --- | --- | --- |
| Claude Code | 2.1.248 | Windows (`win32`) | Strict validation, disposable marketplace/install, and enabled-plugin discovery |
| Codex CLI | 0.151.0-alpha.7.2 | Windows (`win32`) | Isolated strict config load, Sol base model, and Terra profile parse |
| agy CLI | 1.1.22 | Windows (`win32`) | CLI discovery, headless run, agent selection, and plugin validation |
| Antigravity Desktop | 2.11.0 | Windows (`win32`) | Project plugin discovery and Customizations UI |
| Antigravity IDE | 2.5.5 | Windows | Installed but not tested |

## Claude Code observations

- The first disposable install exposed a native loader defect: the standard
  `hooks/hooks.json` file was discovered automatically and also referenced by
  `.claude-plugin/plugin.json`, producing a duplicate-hooks error that strict
  validation did not report.
- The adapter was corrected to keep the standard hook file while removing only
  the redundant manifest field. The emergency guard and all lifecycle hook
  registrations remain rendered.
- A newly rendered package passed `claude plugin validate --strict`, local
  marketplace registration, and plugin installation. `plugin list --json`
  reported `all-about-agents@all-about-agents-dev` version 1.0.0 enabled with no
  hook-load error.
- Authenticated model, skill, agent, command, and hook execution were not run:
  the disposable `CLAUDE_CONFIG_DIR` intentionally had no credentials, and no
  live credentials were copied.

## Codex CLI observations

- With `CODEX_HOME` set to the disposable rendered package, `codex
  --strict-config doctor --json` reported `config.load: ok`, model
  `gpt-5.6-sol`, approval policy `Never`, and an unrestricted filesystem
  sandbox.
- `codex --profile terra-max mcp list` parsed the Terra/max overlay and exited
  successfully.
- The isolated doctor remained overall `fail` because no credentials were
  present and the non-interactive runner used `TERM=dumb`; authenticated model
  invocation and Desktop behavior were not run.

## agy observations

- `agy --version` returned `1.1.22`.
- `agy models` listed `gemini-3.7-flash-high`.
- `agy --help` exposed `--effort high` and
  `--dangerously-skip-permissions`.
- A headless invocation using Flash High, high effort, and the full-access flag
  completed successfully.
- `agy plugin validate` passed for both the agy package root and the Desktop
  plugin package, reporting 28 skills, seven agents, and one hook.
- `agy --agent architect` was accepted from the disposable workspace.
- `agy agents` exited successfully but printed no agent rows, so list discovery
  is inconclusive rather than pass.

Plugin installation, runtime skill invocation, hook execution, live settings
merge, persistence, and statusline behavior were not run.

## Antigravity Desktop observations before the rule fix

- The About UI reported version 2.11.0.
- The model selector exposed and selected `Gemini 3.7 Flash High`.
- The security preset selector exposed `Default`, `Full machine`, `Turbo mode`,
  and `Custom`. `Unrestricted` was not present.
- After registering the disposable project, restarting Desktop, and starting a
  project-scoped conversation, `/using-all-about-agents` was discoverable.
- Project Customizations listed 41 skills: 13 global plus 28 from
  `Plugin: all-about-agents`.
- The agent selector listed architect, implementer, investigator, researcher,
  reviewer, security-reviewer, and verifier.
- Project Customizations showed only the ancestor repository rule and did not
  load the generated split `rules/<name>.md` files.
- The native session log reported zero loaded named hooks; the generated hook
  contract remained disabled and inert.

The rule result identified the adapter defect: Desktop 2.11.0 bundled
documentation recommends a consolidated plugin `rules/AGENTS.md`.

## Antigravity Desktop observations after the rule fix

- The updated package was applied only to the same disposable project root.
- A later fresh Desktop launch re-opened the same project settings and again
  reported 41 skills (13 global plus 28 plugin), two rules, and seven custom
  agents; the conversation model selector still displayed Flash High.
- Project Customizations listed `Rules 2`: the generated **All About Agents
  Desktop rules** entry and the ancestor repository rule.
- Project Customizations continued to list 41 skills, including 28 from
  `Plugin: all-about-agents`, and all seven packaged custom agents.
- The project conversation selector continued to display
  `Gemini 3.7 Flash High`.
- No live security preset, permission rule, settings file, or global plugin was
  changed during the retest.

This closes the native consolidated-rule discovery check. It does not qualify
the separate behavioral checks listed below.

## Still not run

- Agent tool enforcement and read-only behavior.
- Emergency deny enforcement under the manual `Custom` preset.
- Executable hook decisions and handler resolution.
- Cross-session model/plugin persistence and automatic fallback.
- Gate 3 behavioral evaluation, macOS, and Antigravity IDE behavior.
