# Antigravity 2.0 Desktop compatibility

Antigravity 2.0 Desktop is a manual integration surface. The observed runtime
is Windows Desktop `2.11.0`. A disposable project discovered the package,
28 skills, the consolidated rule, and 7 agents. Hooks, permissions, role
tools, persistence, and macOS remain `NOT_RUN`.

## Lifecycle and support

Use these states in order:

```text
rendered -> validated -> registered -> trusted -> active -> runtime verified
```

The adapter can render a package. Repository structure checks may pass, but the
native Desktop `validated` state is `NOT_RUN` until a product validator is
observed. Desktop `registered`, `trusted`, `active`, and `runtime verified`
states require manual product observation. A package listing does not prove a
loaded session.

| Capability | Current evidence | Boundary |
| --- | --- | --- |
| Plugin, skills, rules, and agents | Disposable Windows Desktop discovery passed for 28 skills, the consolidated rule, and 7 agents | Other versions and platforms need a new check. |
| Registration | Manual workspace or global plugin discovery | The adapter does not install a Desktop plugin. |
| Hooks | Disabled and inert template | No command handler is active. Failure and blocking behavior are unknown. |
| Statusline display name | Desktop has no documented native statusline contract | Statusline setup and display-name persistence are unavailable. |
| Model and effort | `Gemini 3.7 Flash High` was selectable; High is part of the display name | No separate effort key or automatic fallback is claimed. |

## Model and permission policy

The shared global file is rendered from
`core/instructions/global-operating-rules.md` and is copied manually to
`~/.gemini/GEMINI.md`. Project `.agents/rules/` and plugin rules are the more
specific second layer. `agy` also reads this same global destination.

Visible skills, agents, commands, and workflows keep their machine IDs and
show a registry emoji after the name, a short reason, and a 2-to-7 item
checklist. This is prompt guidance, not a UI guarantee.

Select `Gemini 3.7 Flash High` in the conversation model selector. The
observed selection is conversation-local. Do not infer cross-session
persistence or a separate effort setting.

The `portable` preset uses Desktop `Default`. The `template` preset uses
Desktop `Custom` for broad access. Keep `Turbo mode` off. Retain these
emergency Deny rules:

- `command(rm -rf)`;
- `command(sudo)`;
- `write_file(.git/)`;
- `write_file(/home/user/.ssh)`.

Custom full access does not prove native Deny enforcement. Exercise each rule
manually only in a disposable workspace and record the product result.

## Discovery and manual registration

The exact rendered source is:

```text
"<PACKAGE_ROOT>/.agents/plugins/all-about-agents/"
```

Copy its contents to exactly one documented destination:

```text
"<WORKSPACE_ROOT>/.agents/plugins/all-about-agents/"
"~/.gemini/config/plugins/all-about-agents/"
```

Do not copy the outer package root or create another nested `.agents/plugins/`
tree. The plugin contains metadata, skills, `rules/AGENTS.md`, disabled hooks,
and agent-role files.

Warning: Desktop registration changes a workspace or product location. Use a
disposable workspace and exact operator approval. The CLI register apply path
is unsupported for Desktop.

1. Open a disposable project.

2. Copy the exact rendered plugin source to one exact destination above.

3. Restart or reload Desktop.

4. Record plugin, rule, skill, and agent discovery.

5. Select the model and permission preset.

6. Exercise the emergency Deny checklist.

The rendered `hooks.json` is disabled and inert, and no command guard is
packaged. Do not call the Deny checklist active protection.
The Desktop statusline display name is unavailable because no native Desktop
statusline contract is established. Do not copy a CLI statusline setting into
Desktop.

## Limits

The Windows Desktop evidence does not cover role tool enforcement, Deny
blocking, hook execution, trust, persistence, IDE behavior, authenticated
requests, or macOS. Record missing checks as `NOT_RUN` or
`NOT_RUN_UNAVAILABLE`.

Use [native registration](../maintenance/native-registration.md),
[native verification](../maintenance/native-verification.md), and the
[cross-tool quality guide](../maintenance/cross-tool-quality.md). See
[known limitations](../limitations/known-limitations.md).
