# Claude fixture templates

The adapter renders a complete Claude plugin package from the canonical core.
Its output uses the documented plugin component directories (`skills/`,
`agents/`, `commands/`, and `hooks/`) plus installer-owned `rules/` and
`config/` overlays. The `portable` and `template` profiles differ only in
their settings overlay; no root `CLAUDE.md` is emitted because Claude does not
load a plugin-root file as plugin context.
