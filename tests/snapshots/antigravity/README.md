# Antigravity snapshots

Deterministic portable and template render snapshots live in this directory.
Each profile file records every rendered path with its SHA-256 hash and mode,
the ownership records, the registrations, and the diagnostics.
`skills-manifest.json` records the rendered skill inventory.

The package carries no hooks and no status line. Antigravity documents no
`SessionStart` event, so the routing contract is inlined into `GEMINI.md`
instead of injected at session start. See
`docs/plans/2026-09-19-restore-antigravity.md`.

No script writes these files, and no test has an update flag. The contract
tests render both profiles and compare the result with these files. They pin
an environment without `AAA_ANTIGRAVITY_ROOT`, so a value set on the machine
cannot change the result. A change to any rendered file or registration fails
them until the JSON is updated by hand. A `version` change in `package.json`
is such a change, because the rendered `plugin.json` names the version.
