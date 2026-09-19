# Contributing to All About Agents

This repository keeps one source for Claude Code and Codex. Keep every change
clear, small, and supported by fresh evidence.

The native lifecycle is:

```text
rendered -> validated -> registered -> trusted -> active -> runtime verified
```

Do not use a later state to describe an earlier check. Record
`NOT_RUN_UNAVAILABLE` when a product or host is unavailable.

## Before You Start

Read the real files, tests, schemas, and the relevant guide under `docs/`.
Confirm that the problem is real and belongs in this repository. Keep the
project free of new dependencies unless an approved design needs one.

Run the local, read-only sync check:

```text
npm run sync:status
```

A change that spans several phases starts from a design spec in
`docs/plans/YYYY-MM-DD-<name>.md`. The owner reviews the spec before phase 1. Each phase
ends with the evidence report the spec defines.

The release source is main and origin/main. `AGENTS.md` and `CLAUDE.md` are
separate regular files. They carry the same minimum protocol. They are not
redirects to one another.

## Change One Skill

Use `all-about-agents:writing-skills` before editing a skill. Read the whole
`SKILL.md` and all companion files that the skill owns. Follow the
[skill development guide](docs/maintenance/skill-development.md).

Use a RED lint test first (the regex contract on the skill text). Make the
smallest sound change, then run:

```text
npm run quality:skill -- <skill-name>
```

Skill text changes agent behavior, and a lint test cannot see that behavior.
Report a skill change as "lint-verified, model run pending" until
`npm run test:model` records a `PASS` for that skill on a machine with an
authenticated `claude` CLI and the current package installed. The suite is
manual and never part of `quality:quick` or `quality:full`.

## Files That Must Change Together

When a skill changes, review its `SKILL.md`, companions, lint tests,
evaluation cases, and inventory record. Do not leave one surface behind.

When an adapter changes, review its capability record, manifest, contract tests,
integration tests, and snapshots. Static render success is not native runtime
success.

When a CLI option or document changes, update every table, local link, and
static documentation test that owns the same fact.

## Quick and Full Checks

Run the smallest focused check first. Then run these portable checks from the
repository root:

```text
npm run quality:quick
npm run quality:full
```

Use `quality:quick` during work. Use `quality:full` before a release or handoff.
Record optional native checks as `NOT_RUN_UNAVAILABLE`.

The text report keeps only the last 8,000 characters of a failing check. Before
you report a `FAIL`, rerun the gate with `--output <PATH>` and read the failing
test names from the JSON report, or run the named test file directly.

Every release bumps `version` in `package.json` and adds a `WhatsNew.md` entry.
Both plugin manifests read the version from `package.json`.

## Git Authority

Do not commit, push, merge, rebase, or rewrite history without exact user
authority. Preserve unrelated work and inspect the complete diff first.

Use `main` as the release branch. Never hide a dirty tree, conflict, detached
HEAD, missing upstream, or diverged branch in an evidence report.

Warning: the following commands write Git history or the remote. Run them only
after user authority and review.

```text
git add <FILES>
git commit -m "<MESSAGE>"
git push origin main
```

## Cross-Machine Update

Follow the [sync and update guide](docs/maintenance/sync-and-update.md).
The author-machine order is:

```text
edit -> quality:skill -> quality:quick -> quality:full -> review -> authorized commit/push
```

Run `quality:skill` when a skill changed. Otherwise record it as not run with
the reason. The receiving-machine order is:

```text
fetch -> sync:status -> pull --ff-only -> quality checks -> doctor -> dry-run
-> install --apply -> register --dry-run -> authorized register --apply
-> restart/reload -> native verification
```

On the receiving machine, inspect state before pulling:

```text
git fetch origin
npm run sync:status
git status --short
git switch main
git pull --ff-only origin main
npm run quality:quick
npm run quality:full
```

A pull updates only this repository. It does not install files, register a
plugin, change trust, or start a native session. No backup is made.

## Live Install Boundary

Repository checks and native installation are separate actions. Never install
or change Claude or Codex live config without exact authority.

Warning: `--apply` writes the selected disposable or approved root. Read its
dry-run report first. The installer may overwrite declared owned files. It does
not change unowned neighbors and creates no backup.

Use the platform setup guides and [native registration](docs/maintenance/native-registration.md)
before an approved install. Use [native verification](docs/maintenance/native-verification.md)
after restart or reload. `register --dry-run` is review-only. Authorized
`register --apply` is the native mutation boundary. It is never run by pull,
quality checks, `doctor`, or normal install dry-run.

Do not infer native discovery, model use, hook execution, trust, or permission
behavior from static tests. Use the [cross-tool quality guide](docs/maintenance/cross-tool-quality.md)
to keep repository, rendered, disposable-root, and native evidence separate.

## Evidence Report

Every handoff or completion report must include:

- what changed and why;
- full repository paths for changed files;
- exact commands, exit codes, pass counts, and important output;
- native checks, platform checks, and checks not run;
- Git branch, SHA, dirty state, and remaining risks.

Do not use words such as “done” or “ready” without current checkable evidence.
For a new coding tool, run a native end-to-end session before claiming runtime
support.
