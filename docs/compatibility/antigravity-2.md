# Antigravity 2.0 Desktop compatibility

Antigravity 2.0 Desktop is a manual-integration surface. The repository can
render a portable plugin package, but the adapter does not automatically
install a Desktop plugin, write Desktop settings, or execute hooks. Windows
Desktop 2.11.0 discovery is partially qualified per check; untested behavior
remains `NOT_RUN`. See the [evaluation method](../evaluations/method.md).
The redacted observation record is [Native Windows evidence](../evaluations/native-windows-2026-08-31.md).

## Support summary

| Capability | Current status | Contract |
| --- | --- | --- |
| Skills and rules | Verified on Windows Desktop 2.11.0 | A disposable project loaded 28 plugin skills and the consolidated `rules/AGENTS.md`. |
| Agents/subagents | Verified on Windows Desktop 2.11.0 | All seven packaged `agents/<role>.md` entries appeared after restart; other versions/platforms remain manual. |
| Hooks | Manual/probe-required | The package hook contract is disabled/inert until an operator confirms the Desktop event contract. |
| Plugin registration | Manual | Workspace `.agents/plugins/<plugin>/` and global `~/.gemini/config/plugins/<plugin>/` are documented discovery locations; automatic install is not declared. |
| Commands and statusline | Unknown/unsupported native contract | No Desktop command-file or statusline configuration key is established. |
| Model/effort | Manual, model verified | Gemini 3.7 Flash High is selectable; High is part of the display name and no separate Desktop effort setting or automatic fallback is claimed. |
| Native/session behavior | Partial Windows evidence | Launch, workspace plugin, 28 skills, consolidated rule, seven agents, and model selection passed; role execution, denies, hooks, persistence, Gate 3, IDE, and macOS remain `NOT_RUN`. |

## Model and permission policy

The Windows Desktop 2.11.0 selector exposes **Gemini 3.7 Flash High**.
Selection is manual and the documented persistence boundary is one
conversation. `High` is part of the observed display name; no separate effort
value, settings key, cross-session persistence, or automatic fallback is
emitted.

The template’s full-access intent uses Desktop **Custom** and must be configured
manually for broad access while retaining the emergency denies. **Turbo mode**
is not selected because the 2.11.0 UI describes it as disabling safety
barriers. Emergency denies remain in force:
`rm -rf` commands, `sudo`, writes into `.git/`, and writes into
`/home/user/.ssh` are denied. The portable preset uses the Default UI preset.
The adapter does not emit an application settings overlay, so these controls
cannot be marked automatic from rendered files.

## Discovery and manual registration

The package contains plugin metadata plus skills, a consolidated
`rules/AGENTS.md`, and an agent-role directory. The documented workspace discovery root is
`.agents/plugins/<plugin>/`; the documented global root is
`~/.gemini/config/plugins/<plugin>/`. The agent path is intentionally retained
because the Desktop Plugins and Subagents documentation has not been reconciled;
Windows Desktop 2.11.0 discovered all seven roles, while other versions still
need confirmation.

A safe acceptance sequence is: launch the Desktop product with a disposable
workspace, inspect plugin/skill/rule discovery, inspect the role list without
running a role, manually select Flash High, verify conversation-local
stickiness, and inspect permission ordering (Deny before Ask before Allow).
Inspect hooks only after their event/input/output contract is confirmed. Do
not infer any of these results from a package listing.

The [quarantined Antigravity setup guide](../../quarantine/legacy/setup/setup-guide-antigravity.md)
describes legacy symlink and automated-hook behavior. It is historical evidence,
not a supported setup contract; the current adapter contract above takes precedence.

## Verification limits

Desktop version 2.11.0, Windows host, Flash High selection, workspace plugin,
28 skills, the consolidated plugin rule, and seven agents were observed. Entitlement details, native settings
keys, cross-session persistence, command mapping, statusline behavior, role
tool enforcement, deny behavior, and hook execution are not passes. Follow the
[known limitations](../limitations/known-limitations.md) and keep each unrun
check explicit.
