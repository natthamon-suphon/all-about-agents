# Session prompt for the same quality

Copy the prompt below into a new Claude Code, Codex, Antigravity Desktop, or
`agy` session. Replace the values inside angle brackets.

````text
Work in this repository: <FULL_REPOSITORY_PATH>

Read CONTRIBUTING.md, the native instruction file for this tool, and the
relevant guide under docs/ before acting. Inspect the real files first.
Read docs/maintenance/global-instructions.md for the shared global layer and
the more specific project or plugin layer.

Task: <TASK>
Expected scope: <FILES_OR_COMPONENTS>
Current branch and commit SHA: <BRANCH_AND_SHA>

Follow the canonical source and its companion files. For a behavior change,
create or update a focused RED test, implement the complete change, and make it
GREEN. Run the focused check, npm run quality:quick, and npm run quality:full.
Keep repository, rendered package, disposable-root, and native product evidence
separate. Record unavailable native checks as NOT_RUN_UNAVAILABLE.

This prompt does not grant authority to commit, push, merge, install, or change
live product config. Do those actions only when my task gives exact authority.
Do not create a backup. Preserve unrelated changes.

Keep the cross-machine order separate:

```text
fetch -> sync:status -> pull --ff-only -> quality checks -> doctor -> dry-run
-> install --apply -> register --dry-run -> authorized register --apply
-> restart/reload -> native verification
```

The receiving-machine order is also written as:

```text
pull -> validate -> render -> dry-run -> apply package -> dry-run registration -> explicit registration apply -> restart -> verify loaded instructions
```

Use the registered emoji after each visible skill, agent, subagent, command,
or workflow name. Add a short reason and a 2-to-7 item checklist. Update the
checklist only when a state changes. This prompt improves model guidance; it
does not guarantee a vendor UI presentation.

Do not run `register --apply` from a pull, quality check, doctor, or normal
dry-run. Record `rendered`, `validated`, `registered`, `trusted`, `active`, and
`runtime verified` separately. Record unavailable work as
`NOT_RUN_UNAVAILABLE`.

Before finishing, report:
- what changed and why
- full paths of changed files
- tool, model, and version
- branch and commit SHA
- exact checks, exit codes, and pass counts
- native checks and checks that were not run
- findings, risks, and the next safe action
````

For skill work, also read the [skill development guide](skill-development.md).
For updates from another machine, read the
[sync and update guide](sync-and-update.md). For evidence levels, read the
[cross-tool quality guide](cross-tool-quality.md).
