# Claude snapshots

Deterministic portable and template render snapshots live in this directory.

Each profile file records the rendered paths, their SHA-256 hashes, the
settings overlay, the resolved config-root registration, and the full text of
five files. One of them is `hooks/hooks.json`, the native hook configuration.
It starts the `hooks/bootstrap.mjs` handler on the `startup`, `clear`, and
`compact` session sources. That handler is recorded by path and hash only.
`skills-manifest.json` records the rendered skill inventory.

No script writes these files, and no test has an update flag. The contract
tests render both profiles and compare the result with these files. A change
to any rendered file fails them until the JSON is updated by hand. A `version`
change in `package.json` is such a change, because the rendered plugin
manifests carry the version.
