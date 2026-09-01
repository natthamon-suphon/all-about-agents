# Claude Code Repository Entry Point

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the relevant guide under `docs/`
before work. Inspect the real files, tests, schemas, and current Git state.
Use the [cross-tool quality guide](docs/maintenance/cross-tool-quality.md).

For a skill change, use `all-about-agents:writing-skills` and its behavior-test
workflow. Run the focused check, then:

```text
npm run sync:status
npm run quality:quick
npm run quality:full
```

Keep this native lifecycle in order:

```text
rendered -> validated -> registered -> trusted -> active -> runtime verified
```

Do not claim native success from static tests. Record checks not run as
`NOT_RUN_UNAVAILABLE` when the product or host is unavailable.

Do not commit, push, merge, install, or change live config without exact user
authority. Use `main` as the release source. A pull does not install files, and
no backup is made.

Use `register --dry-run` for review. Use `register --apply` only after exact
authority and a reviewed report. Keep Git actions separate from native actions.

Keep one coherent problem per change. Preserve the zero-dependency design.
Require native end-to-end evidence for a new coding tool.

Report changed paths, exact checks, results, risks, and checks not run.
