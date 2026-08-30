# Codex CLI and Desktop compatibility

This page covers the deterministic Codex package and installer contract. It
does not turn a package tree into a native Codex claim. Native acceptance is
`NOT_RUN_UNAVAILABLE`; see the [evaluation method](../evaluations/method.md).

## Support summary

| Capability | Current status | Contract |
| --- | --- | --- |
| `AGENTS.md`, skills, role agents, config profiles | Automatic package render under an explicit root | Files are rendered from the repository templates with declared relative paths. |
| Plugin registration | Manual/native confirmation | `.codex-plugin/plugin.json` is packaged; product discovery must be observed in Codex. |
| Claude-style command files | Unsupported | Reusable behavior is delivered as skills; Codex command-plugin mapping is not declared. |
| Hooks | Automatic package render; native execution requires Gate 2 | Lifecycle handlers are declared, but no product run was observed. |
| Statusline and schedules | Unsupported/unknown native contract | No Codex-native statusline or repository schedule is emitted. |
| Native validation | Manual, when Codex is installed | `codex doctor --json --no-color`. |
| Product/session behavior | `NOT_RUN_UNAVAILABLE` | No native Codex CLI/Desktop session was available for Gate 2 or Gate 3. |

## Profiles, models, and permissions

The `portable` profile is controlled: `sandbox_mode=workspace-write` and
`approval_policy=on-request`, with no forced model. The `template` profile is
the approved full-access preset:

- primary model: `gpt-5.6-sol`;
- reasoning effort: `max`;
- `sandbox_mode=danger-full-access`;
- `approval_policy=never`.

The alternate `terra-max.config.toml` selects `gpt-5.6-terra` with max
reasoning. Terra is an explicit operator choice (CLI profile `terra-max` or a
Desktop model picker), not an automatic failure fallback. Automatic model
fallback is unsupported and no such behavior is claimed.

Full access does not disable the emergency-deny contract. The rendered
instructions and hook policy retain denies for destructive erasure, raw-disk
operations, force-push/history rewrite, discarding uncommitted work,
credential or secret access/output, and guardrail bypass. CLI registration and
execution of those controls require native observation; Desktop controls must
be checked manually. Read-only role TOMLs use `sandbox_mode=read-only`; the
implementer role is the scoped `workspace-write` exception.

## Roots, registration, and paths

Codex CLI and Desktop share the configured root:

- `CODEX_HOME` when explicitly supplied;
- otherwise `~/.codex`.

The package contains `AGENTS.md`, `.agents/skills/<skill>/SKILL.md`,
`.codex/agents/<role>.toml`, `config.toml`, and the explicit Terra alternate
profile. Role configuration is declared relative to the delivered `agents/`
directory. The installer’s source-to-destination mapping allows the role
files to resolve from the selected Codex agents root; it does not infer a live
root or silently register a Desktop profile.

Qualification applies only below a selected disposable destination root and
proves containment there. A real operator must confirm native plugin
discovery, role registration, hook behavior, and Desktop profile selection.

## Verification limits

No native `codex doctor` output, model selection, fallback event, Desktop
registration, hook invocation, or persistence observation is retained. The
package also has no native statusline contract, and the narrower implementer
task path is not enforced by Codex’s workspace controls alone; the outer
installer/approval boundary remains authoritative.

See the [evaluation method](../evaluations/method.md) for Gate 2/Gate 3
requirements and [known limitations](../limitations/known-limitations.md) for
cross-surface unavailable checks. Use the supported [Windows](../setup/windows.md)
or [macOS](../setup/macos.md) setup guide with a disposable root.
