# Antigravity 2.0 Desktop compatibility

Antigravity 2.0 Desktop is a manual-integration surface. The repository can
render a portable plugin package, but the adapter does not automatically
install a Desktop plugin, write Desktop settings, or execute hooks. All native
acceptance is currently `NOT_RUN_UNAVAILABLE`; see the [evaluation method](../evaluations/method.md).

## Support summary

| Capability | Current status | Contract |
| --- | --- | --- |
| Skills and rules | Package render; Desktop discovery manual | Workspace package paths are `.agents/plugins/<plugin>/skills` and `rules`. |
| Agents/subagents | Manual and ambiguous | Public Desktop documentation separates Plugins and Subagents; `agents/<role>.md` packaging needs manual verification. |
| Hooks | Manual/probe-required | The package hook contract is disabled/inert until an operator confirms the Desktop event contract. |
| Plugin registration | Manual | Workspace `.agents/plugins/<plugin>/` and global `~/.gemini/config/plugins/<plugin>/` are documented discovery locations; automatic install is not declared. |
| Commands and statusline | Unknown/unsupported native contract | No Desktop command-file or statusline configuration key is established. |
| Model/effort | Manual | The documented current selection is Gemini 3.7 Flash Medium in the Desktop conversation selector; automatic model fallback is unsupported. |
| Native/session behavior | `NOT_RUN_UNAVAILABLE` | No Antigravity Desktop host/session was available for Gate 2 or Gate 3. |

## Model and permission policy

The only currently documented Desktop model is **Gemini 3.7 Flash Medium**.
Selection is manual through the conversation model selector and is
conversation-local. Desktop effort settings are unsupported; no effort value
is emitted. Gemini 3.7 Flash High is not claimed or substituted for this
surface.

The template’s full-access preset corresponds to the Desktop **Unrestricted**
permission UI and must be selected manually. Emergency denies remain in force:
`rm -rf` commands, `sudo`, writes into `.git/`, and writes into
`/home/user/.ssh` are denied. The portable preset uses the Default UI preset.
The adapter does not emit an application settings overlay, so these controls
cannot be marked automatic from rendered files.

## Discovery and manual registration

The package contains plugin metadata plus skills, rules, and a retained
agent-role directory. The documented workspace discovery root is
`.agents/plugins/<plugin>/`; the documented global root is
`~/.gemini/config/plugins/<plugin>/`. The agent path is intentionally retained
because the Desktop Plugins and Subagents documentation has not been reconciled;
an operator must confirm whether each role is discoverable as an agent.

A safe acceptance sequence is: launch the Desktop product with a disposable
workspace, inspect plugin/skill/rule discovery, inspect the role list without
running a role, manually select Flash Medium, verify conversation-local
stickiness, and inspect permission ordering (Deny before Ask before Allow).
Inspect hooks only after their event/input/output contract is confirmed. Do
not infer any of these results from a package listing.

The [quarantined Antigravity setup guide](../../quarantine/legacy/setup/setup-guide-antigravity.md)
describes legacy symlink and automated-hook behavior. It is historical evidence,
not a supported setup contract; the current adapter contract above takes precedence.

## Verification limits

Desktop version, host platform, entitlement, native settings key, cross-session
model persistence, command mapping, statusline behavior, hook execution, and
agent registration are unknown until a real Desktop observation. They are not
passes. Follow the [known limitations](../limitations/known-limitations.md) and
record unavailable product checks as `NOT_RUN_UNAVAILABLE` rather than
fabricating native evidence.
