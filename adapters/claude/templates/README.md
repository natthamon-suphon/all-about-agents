# Claude fixture templates

The adapter renders a structural Claude plugin fixture from the canonical core.
When canonical sources are unavailable, the fixture is intentionally incomplete
and marked for deferral by hard diagnostics.
Its output uses the documented plugin component directories (`skills/`,
`agents/`, `commands/`, and `hooks/`) plus installer-owned `rules/` and
`config/` overlays. The `portable` and `template` profiles differ only in
their settings overlay; no root `CLAUDE.md` is emitted because Claude does not
load a plugin-root file as plugin context.

The generated package is a self-contained `all-about-agents-dev` local
marketplace. From its root, add the marketplace before installing the named
plugin; neither step is automatic. Hook and statusline entrypoints use exec-form `node` commands;
the manifest preflight rejects hosts without Node.js 22.12.0 or newer. Missing
canonical skill sources are rendered as explicit deferred files and reported
with an owning cycle-05 remediation diagnostic, never as complete generic
skill bodies. Read-only agents declare Claude-native `disallowedTools` for
`Agent`, `Bash`, `Edit`, and `Write`.
