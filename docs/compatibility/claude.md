# Claude Code compatibility

This page describes the repository package and installer contract for Claude
Code. A rendered package is repository/installer evidence; it is not evidence
that a Claude product session executed its components. Windows Claude Code
2.1.248 now has partial native acceptance for strict validation, disposable
marketplace registration, plugin installation, and enabled-plugin discovery;
authenticated session behavior remains `NOT_RUN_UNAVAILABLE` under the
[evaluation method](../evaluations/method.md).

## Support summary

| Capability | Current status | Contract |
| --- | --- | --- |
| Skills, agents, rules, commands, hooks | Automatic package render; plugin-level native discovery observed, component execution not run | The plugin package contains the declared files. Claude conventionally discovers `hooks/hooks.json`; the manifest does not register that standard path a second time. |
| User plugin registration | Manual operator action; observed in a disposable Windows `CLAUDE_CONFIG_DIR` | From the generated package root, run `claude plugin marketplace add .`, then `claude plugin install all-about-agents@all-about-agents-dev`. |
| Statusline | Unsupported as a native contract | Installer-managed statusline files may be emitted, but the adapter records the native statusline configuration shape as unknown. |
| Native validation | Manual; observed on Windows with Claude Code 2.1.248 | `claude plugin validate . --strict` passed, then `plugin list --json` reported the installed plugin enabled without a hook-load error. |
| Product/session behavior | `NOT_RUN_UNAVAILABLE` | The isolated config intentionally contained no credentials, so authenticated model, component invocation, hook execution, fallback, and Gate 3 behavior were not run. |

The package uses plugin-root-relative `skills/`, `agents/`, `commands/`,
`rules/`, and `hooks/` paths. A fresh disposable installation proved that
Claude's loader accepts and enables the plugin without duplicate hook
registration. Individual component discovery and hook execution still require
an authenticated product session; enabled-plugin presence alone does not
upgrade those behaviors to a native pass.

## Profiles, models, and permissions

The `portable` profile is controlled and uses Claude’s surface default. The
`template` profile is the approved full-access profile:

- primary model: `claude-opus-5`;
- effort: `CLAUDE_CODE_EFFORT_LEVEL=max`;
- qualifying server-failure fallback: `claude-sonnet-5`, with the same profile
  max-effort setting;
- advisor: `claude-fable-5` where the experimental capability and user access
  or consent are available;
- permission mode: `bypassPermissions`.

Full access never removes the emergency denies. The portable and template
permission overlays retain denies for `rm -rf /`, `rm -rf ~`, force-push, and
hard-reset operations. Secret handling, containment, and read-only role checks
remain separate release controls. The read-only roles (researcher,
investigator, architect, verifier, reviewer, and security-reviewer) disallow
`Agent`, `Bash`, `Edit`, and `Write` in their declared contract.

The fallback is a qualifying server-failure path, not permission or policy
fallback. Fable is not claimed when access or consent is unavailable.

## Roots, registration, and manual boundaries

Claude CLI and local Claude Desktop share the configured root:

- `CLAUDE_CONFIG_DIR` when explicitly supplied;
- otherwise `~/.claude`.

The repository CLI may render and apply only below an explicit, authorized
disposable destination root. It does not guess a live root. A user who wants
native registration must add the generated package as a local marketplace,
perform the plugin install command above, and run Claude’s strict validation.
`CLAUDE_CONFIG_DIR` is the product discovery
root, not a permission to mutate a live configuration during qualification.

The installer emits candidate settings and statusline overlays under the
package contract. The capability record does not establish a native statusline
configuration key or persistence behavior, so statusline acceptance is manual
and remains unknown until observed.

## Verification limits

Node `22.12.0` is the declared preflight minimum. This page claims only the
observed Windows validation, registration, installation, and enabled-plugin
discovery above. It does not claim hook invocation, skill/agent execution,
model routing, fallback events, Fable access, statusline rendering, or
persistence. Those require authenticated Gate 2 evidence and, for behavior,
fresh Gate 3 sessions.

Use the supported [Windows](../setup/windows.md) or [macOS](../setup/macos.md)
setup guide with a disposable root. The [known limitations](../limitations/known-limitations.md)
track unsupported and unavailable items across surfaces.
