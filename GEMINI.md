# Antigravity Repository Entry Point

Read [CONTRIBUTING.md](CONTRIBUTING.md) and the relevant guide under `docs/`
before work. Inspect the real files, tests, schemas, and current Git state.
Use the [cross-tool quality guide](docs/maintenance/cross-tool-quality.md).

## Skill and agent routing

Use the [skills and agents guide](docs/reference/skills-and-agents.md) to find
the matching route. Check installed descriptions and each skill's trigger.
Read only the relevant guide section, then the actual skill or role instructions.
Preserve existing decisions. Delegate only when useful, authorized, and available.

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

This package keeps one routing contract inlined in the rendered `GEMINI.md`
rather than adding a duplicate `SessionStart` hook. Short routes for every
skill and agent live in the always-on global rule file linked by `GEMINI.md`.
Deployment of global `GEMINI.md` uses a managed-block guard. When its markers
need operator action, registration leaves that file unchanged and reports
`manual-required`. Ask the product whether a `Routing contract` section is
loaded; do not infer it.

Do not commit, push, merge, install, or change live config without exact user
authority. Use `main` as the release source. A pull does not install files, and
no backup is made.

Use `register --dry-run` for review. Use `register --apply` only after exact
authority and a reviewed report. Keep Git actions separate from native actions.

Report changed paths, exact checks, results, risks, and checks not run.
