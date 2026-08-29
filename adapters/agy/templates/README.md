# agy adapter templates

The adapter renders a portable CLI plugin directory with the documented
`plugin.json`, `hooks.json`, `skills/`, `agents/`, and `rules/` components.
Generated settings are a sparse `settings.overlay.json` artifact for manual
review. Rendering never installs a plugin, writes an installed profile, or
executes a hook.

The only documented CLI settings destination candidate is
`~/.gemini/antigravity-cli/settings.json`. Shared configuration paths and the
active merge behavior remain unknown or version-sensitive; this path is not a
direct write target.

The current public records leave the active plugin/settings roots, complete
agent tool vocabulary, runtime version, and account entitlement unknown. The
adapter therefore emits diagnostics and empty agent tool lists until an
operator runs the documented discovery sequence in a disposable target:

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
deny rules remain explicit, and hooks stay disabled and inert.
