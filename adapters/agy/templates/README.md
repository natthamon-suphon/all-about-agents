# agy adapter templates

The adapter renders a portable CLI plugin directory with the documented
`plugin.json`, `hooks.json`, `skills/`, `agents/`, and `rules/` components.
Generated settings are a sparse `settings.overlay.json` artifact for review.
Rendering never installs a plugin, writes an installed profile, or executes a
hook. After a reviewed dry-run and exact authority, repository
`register --apply` installs the plugin, checks plugin discovery, and merges the
sparse overlay.

The documented CLI settings destination is
`~/.gemini/antigravity-cli/settings.json`. The generated file is only a sparse
overlay. Rendering does not write it; authorized `register --apply` is the
explicit merge path and preserves unknown settings.

The documented installed plugin root is
`~/.gemini/antigravity-cli/plugins/<plugin_name>/`. Shared Antigravity docs now
publish the agent fields and tool names used by this adapter. The runtime
version and account entitlement still need a check on each machine. Run this
discovery sequence in a disposable target:

1. `agy --help`
2. `agy models`
3. `agy agents`
4. `agy plugin list`
5. `agy plugin install PACKAGE_DIRECTORY` only for an explicitly selected
   disposable package directory.

Model selection is manual and exact: `gemini-3.7-flash-high` with `high`
effort. If `agy models` does not list the requested slug, stop and retry only
with an exact operator-selected slug or with the model option omitted. No
automatic model replacement is performed.

The authoritative headless operation is an argument vector, with each item
passed as a separate process argument. No cross-platform shell command string
is emitted; shell-specific invocation is a manual operator concern.

The template profile records `toolPermission: always-proceed` and the
documented per-run all-tools operation in generated documentation. Emergency
deny rules remain explicit. Hook events and JSON input/output are documented,
but hook-process failure behavior and portable command path resolution are not.
Hooks therefore stay disabled and inert.
