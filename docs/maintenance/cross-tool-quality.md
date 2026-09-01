# Cross-tool quality

Use the same evidence levels on every machine and in every coding tool. A pass
at one level does not prove a later level.

The native lifecycle is:

```text
rendered -> validated -> registered -> trusted -> active -> runtime verified
```

Keep each state separate. Use `PASS` only for an observed operation. Use
`NOT_RUN` for an intentional skip and `NOT_RUN_UNAVAILABLE` for an unavailable
product, host, entitlement, session, or transport.

## Repository checks

Repository checks validate source, schemas, rules, inventory, safety contracts,
and documentation.

```text
npm run quality:quick
npm run quality:full
```

Run a focused test before these commands when one component changes. These
checks do not establish native registration, trust, active sessions, or runtime
behavior.

## Eight-step checklist for any tool or session

Copy this checklist into a new Claude Code, Codex, Antigravity Desktop, or
`agy` session. It keeps the same quality on Windows and macOS:

```text
- [ ] 1. Read the repository entrypoint and current global instructions.
- [ ] 2. Run core validation.
- [ ] 3. Run the focused tests for changed files.
- [ ] 4. Render both profiles in a disposable root.
- [ ] 5. Run dry-run and inspect destinations.
- [ ] 6. Run package/presentation integrity checks.
- [ ] 7. Update checkpoints or handoff with exact evidence.
- [ ] 8. Do not call native behavior active unless it was observed.
```

Use the [global instruction guide](global-instructions.md) for the dual-layer
model. Visible names use the registry emoji after the name, then one short
reason, for example `Using skill **brainstorming 🧠** — Explore the request.`
Show a 2-to-7 item checklist before material work and update it only when a
state changes. This is prompt guidance, not a UI guarantee.

## Rendered package checks

Rendered checks validate adapter output, manifests, paths, hashes, and
snapshots. They show what the repository can create. They do not show that a
native product loaded the package.

Review the surface capability record and compatibility page together. Check
the statusline block and display name for Claude and `agy`. Check the explicit
Terra recovery profile for Codex. Check the Desktop hook template remains
disabled and inert.

## Disposable-root checks

Use a new explicit directory that is not a live product profile. Run `doctor`,
`diff`, install dry-run, and an approved disposable apply. Check containment,
overwrite planning, managed state, and a second-run result.

Repeat the exact profile, surface, statusline name, and destination when you
run a post-install diff. A changed render input is not an idempotence result.

Warning: `--apply` writes the selected disposable root. Use it only after
reading the dry-run report. The installer is authoritative for its owned files
and creates no backup. Never use a broad or guessed destination.

## Native product checks

Native checks need the real product, exact version, exact discovery root, and a
fresh session. Record only behavior that was observed.

### Claude Code

Restart or reload after registration or package changes. Confirm plugin
discovery, statusline output, expected skills and agents, model policy,
permission state, and hook state. Record `disableAllHooks` separately from the
emergency deny policy. Run one safe trigger and one non-trigger case only when
an authenticated session is available.

### Codex

Restart Codex CLI or Codex Desktop after config or skill changes. Confirm the
loaded `AGENTS.md`, plugin discovery, skill discovery, role config, selected
model/profile, and permission state. Open `/hooks` and review trust after a new
or changed hook hash. Test CLI and Desktop separately when both are claimed.
Terra is an explicit recovery choice. Do not claim automatic fallback.

### Antigravity Desktop

Reload the workspace or restart Desktop. Confirm the workspace or global plugin
path, 28 skills, rule, 7 agents, model selector, and permissions. Use the
manual emergency Deny checklist. Do not enable hook templates until process
failure and blocking behavior are supported. The Desktop statusline and display
name are unavailable under the current contract.

### `agy`

Start a fresh terminal. Confirm `agy --version`, the documented settings and
plugin roots, package validation or listing, agent selection, exact model slug,
effort, and permission flag. Check the statusline with documented JSON stdin.
Keep the settings artifact as a sparse overlay. Test runtime skill use
separately from package validation. The prompt must stay one structured argv
item.

## Cross-machine handoff

Use [sync and update](sync-and-update.md) for the author-machine and
receiving-machine flows. Use [native registration](native-registration.md) for
the separate product mutation. Use [native verification](native-verification.md)
for lifecycle evidence.

`git pull --ff-only origin main`, quality checks, `doctor`, and normal dry-run
must not run `register --apply`. Native registration needs an explicit
authorized action. Restart or reload before checking `active` or `runtime
verified`.

## Result record

For each result, record:

- machine and operating system;
- tool, model, and version;
- branch and commit SHA;
- exact command or manual action;
- exit code and pass count when available;
- evidence path with secrets removed;
- checks not run;
- findings and next safe action.

Use the status names in the [evaluation method](../evaluations/method.md).
Static tests, package validators, and file listings do not promote a native
state. Use the [session prompt](session-prompt.md) in another AI coding tool.
