# agy adapter templates

The adapter renders a portable CLI plugin directory with the documented
`plugin.json`, `hooks.json`, `skills/`, `agents/`, and `rules/` components.
Generated settings are a sparse `settings.overlay.json` artifact for manual
review. Rendering never installs a plugin, writes an installed profile, or
executes a hook.

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

The template profile records `toolPermission: always-proceed` and the
documented per-run all-tools operation in generated documentation. Emergency
deny rules remain explicit, and hooks stay disabled and inert.
