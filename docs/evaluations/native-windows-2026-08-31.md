# Native Windows evidence — 2026-08-31

This record separates observations from unrun checks. It contains no account
identifier, conversation identifier, prompt body, credential, or live settings
content. All repository installs used
`tests/.tmp/native-retest-20260831/` as a disposable destination.

## Environment

| Product | Observed version | Platform | Scope |
| --- | --- | --- | --- |
| agy CLI | 1.1.22 | Windows (`win32`) | CLI discovery, headless run, agent selection, and plugin validation |
| Antigravity Desktop | 2.11.0 | Windows (`win32`) | Project plugin discovery and Customizations UI |
| Antigravity IDE | 2.5.5 | Windows | Installed but not tested |

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
