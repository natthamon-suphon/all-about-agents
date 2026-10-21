# Companion tooling

Companions stay external to this repository. All About Agents owns workflow
routing and verification. Companion instructions add task-specific guidance.
Explicit user requirements and correctness take priority over style preferences.
Keep each companion's registration, hooks, state and runtime evidence separate.

The repository remains zero-dependency and needs Node.js 22.12 or newer.
Optional companions can have other runtime requirements. An absent companion
is `NOT_RUN_UNAVAILABLE` for its native check, not a repository test failure.

## Global installation policy

Install shared skills, agents, rules, hooks, and settings once per user and
tool on each computer. Use that global installation across projects. Do not
copy the shared setup into every repository or create project rules merely
to activate a companion.

The files in `core/`, `adapters/`, and `installers/` are package sources.
Repository entrypoints and test fixtures describe development of this package;
they do not require a separate companion installation in each project. Use
the [global instruction deployment](../maintenance/global-instructions.md)
and [setup runner](../maintenance/sync-and-update.md#one-command-setup).

When a companion supports only project scope, use an existing supported
global instruction carrier if it covers the behavior. Otherwise report that
global integration as unavailable. Do not silently fall back to project setup.

## Responsibilities and routing

| Tool | Role | Boundary |
| --- | --- | --- |
| `ui-ux-pro-max` | UX, accessibility, tokens, layout and stack guidance | Use for actual interface work; use the real stack and design brief. |
| `frontend-design` | Visual direction, typography and interface craft | Share the same brief/tokens with UI/UX Pro Max; avoid competing design systems. |
| Ponytail | Simpler implementation and complexity review | Preserve requirements, security, accessibility and proof. |
| Caveman | Concise chat output | Preserve code, exact errors, paths and technical facts; persisted documents use normal prose. |
| Context7 | Current library/API documentation | Resolve the library, then query the relevant version and topic; it is not a model selector. |
| RTK | Smaller shell output | Keep check results and exit codes; recover full output when needed. |
| `andrej-karpathy-skills` | Coding discipline | Its canonical skill is `karpathy-guidelines`: state assumptions, make surgical changes and define success checks. |

Route the task first. For UI work, establish one brief and token set before
combining UX guidance and visual craft. For code, apply Ponytail and Karpathy
constraints to the same implementation. Context7 supplies external facts.
Caveman and RTK change presentation, not authority, scope or acceptance checks.
Do not activate UI-building skills merely to audit configuration.

## Installed evidence and collisions

Checked on Windows, 2026-10-19:

- UI/UX Pro Max CLI resolved as `uipro` 2.15.0. The local skill uses Python
  standard-library scripts; select an actual Python executable. On this host
  `python` worked while `python3` resolved to a WindowsApps alias. Do not assume
  that alias is an installed interpreter. On macOS, verify the selected Python.
- Both upstream Ponytail 4.9.0 and curated `engineering-suite-ponytail` 2.0.0
  existed in plugin caches. Cache presence does not prove both are active.
  Their skill names overlap. Use qualified names when the host supports them,
  record the selected distribution, and keep bundled workflow dependencies
  inside that distribution.
- The operator-owned `caveman` Codex plugin 1.0.0 contains `SessionStart`
  hooks and depends on external local activator/skill files. It is a legacy
  local wrapper, not proof that upstream has the same layout or behavior.
- No `frontend-design` or `karpathy-guidelines` skill was found in the targeted
  personal-skills and Codex plugin-cache listings. Other install locations were
  not exhaustively scanned. Their upstream contracts were reviewed; local
  discovery and runtime remain `NOT_RUN_UNAVAILABLE` until installed.

`normal mode` can disable both Caveman and Ponytail. Use `stop caveman` or
`stop ponytail` when changing only one. `caveman-review` compresses review
output; `ponytail-review` finds complexity. Neither replaces correctness or
security review. Several distributions may register similarly named commands;
inspect native discovery instead of deleting a cache by name.

## UI/UX Pro Max and frontend-design

Use the [UI/UX Pro Max upstream guide](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)
and the [Anthropic frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md).
The `ui-ux-pro-max-cli` npm package provides `uipro`. An older `uipro-cli`
package can provide the same binary name, so inspect resolution before install.
That possible collision was not observed on this host.

```text
uipro --version
uipro --help
python --version
```

`uvx` is optional for skills that need a Python entry point. Verify it with
`uvx --version`; follow the [uv guide](https://docs.astral.sh/uv/getting-started/installation/)
when installing it. This does not change the repository's Node requirement.

## Ponytail

Read the selected distribution's instructions and
[upstream](https://github.com/DietrichGebert/ponytail). Ponytail is a separate
plugin, not a dependency of All About Agents. A marketplace cache is not an
active plugin.

Upstream 4.9.0 uses Node lifecycle hooks. Its configuration precedence is
explicit environment, XDG configuration, platform fallback, then `full`.
Windows fallback is `%APPDATA%/ponytail/config.json`; macOS fallback is
`~/.config/ponytail/config.json`. Do not assume the macOS path on Windows.
Claude's `.ponytail-active` file belongs to the Claude config root; Codex uses
its native `PLUGIN_DATA` directory. Neither flag proves another host ran it.

## Caveman

[Caveman installation](https://github.com/JuliusBrussee/caveman/blob/main/INSTALL.md)
supports both skills-only and native hook/plugin distributions. A plain skill
folder does not itself activate a session-start hook. Inspect the installed
package and host version before adding a fallback. Upstream documents different
integration support for Codex, `agy`, Antigravity App and standalone IDE.

Use **one activation carrier per product**. If a static instruction block
already loads the same mode, do not also inject it through a hook. Preserve
operator-owned sections outside All About Agents' managed block. A legacy
local wrapper that reads another product's skill path is not portable merely
because its manifest validates.

Keep your own `GEMINI.md` sections outside the `all-about-agents:begin` and
`all-about-agents:end` markers. Registration replaces only that marked block.
If the block is absent or malformed, it reports `manual-required`, leaves the
file unchanged, and returns exit code 1. Do not shorten or reword the managed
body to make another activation copy fit; keep one carrier instead.

Older Windows Codex builds had command-hook limitations. Keep the exact version
with that evidence; do not generalize the limitation to every current build.
A rendered hook, registered hook, trusted hook and observed execution are
separate states. Do not infer App/IDE activation from CLI support.

## Context7

[Context7 upstream](https://github.com/upstash/context7) offers remote/local MCP
and CLI-plus-skills integrations. Install only the mode wanted on the host.
The current `ctx7` CLI requires Node.js 22.13 or newer; that does not raise this
repository's minimum and is not a requirement for a remote MCP endpoint.

A supported Claude local MCP example is:

```text
claude mcp add --scope user context7 -- npx -y @upstash/context7-mcp@latest
claude mcp list
```

Read the current package guide before installation. Keep authentication in the
native secret store or local environment. Never commit credentials or embed
an API key in a shared command/report. Discovery is not an actual documentation
query; record native connectivity separately.

## RTK

[RTK upstream](https://github.com/rtk-ai/rtk#supported-ai-tools) is an optional
local CLI proxy. Check the exact binary and version:

```text
rtk --version
rtk gain
rtk hook --help
```

RTK 0.50.0 includes a Codex `PreToolUse` hook processor and `rtk init --codex`.
A processor's presence does not prove registration, trust or runtime rewriting.
Where a working host hook rewrites a command, write the plain command. Where
none is active, prefix supported commands manually. Avoid double wrapping.
The current product-owned `RTK.md` guidance and actual hook evidence decide
which path applies. RTK's meta commands run as `rtk` itself.

On RTK 0.50.0, `rtk proxy <command>` provides unfiltered output. Newer upstream
versions may use `bypass` instead; inspect local help before changing a command.
Do not treat a successful `rtk gain` as proof of any one command's rewriting.
A failing `gain` can mean another binary called `rtk` resolves first.
`rtk rg` also requires ripgrep. Use `where.exe rtk` on Windows or `command -v rtk`
on macOS to inspect resolution. Do not rewrite an RTK-owned instruction file
from this repository.

The shared global instructions already include RTK house rules for Claude,
Codex, and Antigravity. No project-level
`.agents/rules/antigravity-rtk-rules.md` is needed. On the reviewed Windows
RTK 0.50.0 host, `rtk init --agent antigravity --global --dry-run` reports
`Antigravity is project-scoped`. Do not run its suggested project-only init
under this global policy. Antigravity receives the shared RTK rules through
its global `GEMINI.md` after authorized registration. Without an observed
working hook, those rules use manual command prefixes. This does not claim
native hook rewriting, and the source file alone does not prove activation.

## Karpathy guidelines

The [current package](https://github.com/multica-ai/andrej-karpathy-skills)
provides [karpathy-guidelines](https://github.com/multica-ai/andrej-karpathy-skills/blob/main/skills/karpathy-guidelines/SKILL.md).
The reviewed Claude manifest is skills-only. Do not invent hooks, agent roles,
or cross-product registration support from that manifest. The
[shared global instructions](../maintenance/global-instructions.md#karpathy-coding-discipline)
summarize its four principles and route coding work to the installed
`karpathy-guidelines` skill when available. The skill stays external and optional;
its full instructions are not copied into each tool's global file. Preserve
required safety checks and leave unrelated code and existing comments alone.
It does not need another global bootstrap loop. Static package checks do not
prove native discovery or behavior; verify those after installation in each tool.

## Verification on Windows and macOS

Confirm discovery and versions in each product. Then test one relevant trigger
and one non-trigger in an authenticated disposable session. Record mode,
permission scope, hook execution and update survival separately. Use
[model policy](../maintenance/model-policy.md) for managed model selection and
[native verification](../maintenance/native-verification.md) for lifecycle proof.
No macOS native companion run was performed during the 2026-10-19 Windows audit.
