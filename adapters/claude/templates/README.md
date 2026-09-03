# Claude fixture templates

The adapter renders a structural Claude plugin fixture from the canonical core.
When canonical sources are unavailable, the fixture is intentionally incomplete
and marked for deferral by hard diagnostics.
Its output uses the documented plugin component directories (`skills/`,
`agents/`, `commands/`, and `hooks/`) plus installer-owned `rules/` and
`config/` overlays. It also emits `CLAUDE.md` from the canonical global
instruction source. Registration deploys that file to the selected
`CLAUDE_CONFIG_DIR`; plugin rules remain separate. The `portable` and
`template` profiles differ only in their settings overlay.

The generated package is a self-contained `all-about-agents` local
marketplace. From its root, add the marketplace before installing the named
plugin; neither step is automatic. Hook and statusline entrypoints use exec-form `node` commands;
the manifest preflight rejects hosts without Node.js 22.12.0 or newer. Missing
canonical skill sources are rendered as explicit deferred files and reported
with an owning cycle-05 remediation diagnostic, never as complete generic
skill bodies. Read-only agents declare Claude-native `disallowedTools` for
`Agent`, `Bash`, `Edit`, and `Write`.

## Global presentation

`CLAUDE.md` is the rendered global layer. Project `CLAUDE.md` and plugin rules
are the more specific second layer. Visible names keep their native IDs and
show the registered emoji after the name, one short reason, and a 2-to-7 item
checklist. Example: `Using skill **brainstorming 🧠** — Explore the request.`
This is prompt guidance, not a UI guarantee.

On another machine, use `pull -> validate -> render -> dry-run -> apply
package -> dry-run registration -> explicit registration apply -> restart ->
verify loaded instructions`. A pull does not install or write live config.
