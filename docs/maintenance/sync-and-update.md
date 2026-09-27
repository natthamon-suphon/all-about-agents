# Sync and update on another machine

Git is the cross-machine source of truth. A pull updates this repository only.
It does not install files, register a plugin, change trust, or start a native
session. Git actions and native mutations are separate.
Check a clean worktree before a receiving-machine pull.

The lifecycle is:

```text
rendered -> validated -> registered -> trusted -> active -> runtime verified
```

Keep every state tied to its exact command and evidence. Use
`NOT_RUN_UNAVAILABLE` when a product or host is unavailable.

The required receiving-machine order for Windows and macOS is:

```text
pull -> validate -> render -> dry-run -> apply package -> dry-run registration -> explicit registration apply -> restart -> verify loaded instructions
```

Here, `render` means the package is produced by the install command. The
`install --dry-run` step plans it without writing.
Package apply and native registration are separate explicit actions.
Managed global files are separate
from Git pull. An authorized native apply may overwrite them without a backup.

The global destinations are `<CLAUDE_CONFIG_DIR>/CLAUDE.md`,
`<CODEX_HOME>/AGENTS.md`, and `~/.gemini/GEMINI.md`. Claude also gets the core
rules as files in `<CLAUDE_CONFIG_DIR>/rules/all-about-agents/`. Project
instruction files remain the more specific second layer. Read
[global instructions](global-instructions.md) for the complete model.

Two destinations are never overwritten: `~/.gemini/GEMINI.md` and
`<CODEX_HOME>/config.toml`. The product and the operator may keep their own
content there. Registration writes such a file only when it is missing. An
existing file is complete when it already contains the managed body. For
`GEMINI.md` that is the whole rendered body as one block. For `config.toml` it
is every managed table with all its managed lines, plus the managed top-level
keys (a line-based check that assumes one key per line). Otherwise
registration writes nothing to that file, reports it `manual-required` with
the missing parts named, and ends with exit code 1. To fix it, merge the
managed content by hand. In `GEMINI.md`, replace the old managed block with the
whole rendered body, or append the body as one block when no managed block is
there. In `config.toml`, add the missing tables and change the named lines, so
each key still appears only once. Then register again.

## One-command setup

`npm run setup` runs the whole receiving-machine order as one guarded
pipeline. It is the shortest path when an agent session performs the install.
Every step spawns a program with a structured argument list and no command
shell, the run plans by default, and `--apply` is required to mutate.

```text
node scripts/setup.mjs --mode update            # plan only
node scripts/setup.mjs --mode update --apply    # perform the run
```

| Mode | Package root | Use it when |
| --- | --- | --- |
| `update` | kept, then synced with this checkout | the normal refresh after a pull |
| `fresh` | every previous render of the selected surfaces removed first | the root was written by an older repository version, or a render is in doubt |

Both modes run the same remaining pipeline: validate the checkout, report how
it compares with its upstream, render into the package root, and commit the
Codex plugin source when it changed. Then, for one surface at a time
(Antigravity, Claude, Codex), preview the registration with
`register --dry-run`, remove the installed plugin, and register that surface
again. Last, list what each product reports. A plan-only run shows the preview
as `pending`, because it needs the render of an `--apply` run.

The plugin removal is not optional in either mode, because every product serves
a cached snapshot and a version-keyed cache does not refresh in place. It runs
after the render on purpose: a failed render then leaves every working
installation untouched. Each removal sits between a registration preview and
its own registration. A preview that fails, for example because a product root
is not absolute, stops the run before that product loses its plugin. A failed
registration stops the run before the next product loses its plugin.

`fresh` clears only the package root, which is a directory this installer owns
end to end. It deletes only these entries: the root `.all-about-agents/` state
folder, one folder per surface (`antigravity`, `claude`, `codex`), and a Finder
`.DS_Store` file. With a surface subset it deletes only the selected surface
folders and `.DS_Store`; every other surface keeps its render and its
registration. A surface folder counts only when the root holds that state
folder or the surface folder carries its own marker, and a marker that is a
link does not count. Any other entry, for
example a file, a `.git` folder, another repository, or a folder from a retired
surface, refuses the whole clear: the run lists the unknown entries and deletes
nothing. Remove them by hand, or choose another package root.

`update` runs the same entry check before any step, so it never renders into,
or runs `git add` and `git commit` inside, a folder that is not a package root.
A package root that is missing or empty is accepted in both modes; the render
creates it.

It never deletes anything inside `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, or the
Gemini home, so personal skills, settings, credentials, and history stay in
place; registration then overwrites only the files the package owns. The run
refuses a package root that is a home directory, or that is, contains, or sits
inside a live product root (`~/.claude`, `~/.codex`, `~/.gemini`, or the root
named by `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, or `AAA_ANTIGRAVITY_ROOT`) or this
repository. The comparison uses real paths, so a link does not hide a product
root, and ignores letter case, so `~/.Claude` is the same as `~/.claude`.

`--mode fresh|update` is required. The defaults are
`~/.all-about-agents/package`, profile `template`, and every surface. Options:
`--package-root`, `--profile`, `--surface`, `--statusline-name`,
`--dry-run | --apply`, and `--format text|json`. When the display name is not
supplied, the name already rendered in the package root is reused.

Manage one package root either as a whole with `--surface all`, or per surface
with a subset, never both. `--surface all` keeps one managed state at the root;
a subset writes a second one inside `<root>/<surface>`, and registration
prefers the nested file. The two then drift apart on the next render and the
surface fails with a hash mismatch. A subset run against a root that is already
managed as a whole is refused with `surface-subset-in-managed-root`. An
`update` with `--surface all` against a root that already holds a
`<root>/<surface>/.all-about-agents/state.json` is refused with
`whole-root-in-surface-managed-root`; a `fresh` run clears those nested states
first, so it may switch the root to whole-root management.

A reported step is `completed`, `pending` (planned, needs `--apply`),
`skipped` with a reason (for example a plugin that was not installed),
`not-run-unavailable` when a product CLI is off PATH, `manual-required`,
`blocked`, or `failed`.
A registration whose report names `native-executable-unavailable` is
`not-run-unavailable` too, and the run goes on to the next surface. That
registration may already have written files, for example `GEMINI.md`, before it
reached the missing CLI; the step reason then counts the completed actions.
When that registration had already reported a `manual-required` action before
it stopped, for example a `GEMINI.md` it refused to write, the step is
`manual-required` instead: its reason lists each manual step and then says
which product CLI was missing, and the run ends `manual-required` with exit 1.
A missing product CLI alone is not a failure: the run can still end `complete`
with exit 0. The last lines of the text report then name the surfaces that were
not run (`Not run: ...`) and ask you to restart only the products that
registered. When no surface registered, the last line says so and asks you to
install the missing program.
A registration that ends `manual-required` with error `manual-step-required`
or `installed-copy-not-confirmed` has set up its product but left a step to
you. That step is `manual-required`, its reason lists each manual step id with
its reason, and the run goes on to the next surface. The whole run then ends
with status `manual-required` and exit code 1: do the listed steps, then rerun.
Any other failed or blocked step stops the run, the remaining steps are listed
as not attempted, and the exit code is 1.

When no step fails, is blocked, or needs a manual step, the run status is
`dry-run` for a plan-only run and `complete` for an applied one; both exit 0. `manual-required`, `blocked`, and `failed` exit 1. A refused
package root ends `failed` with exit 1 before any step runs. A missing or
invalid argument, such as no `--mode`, exits 2.

An `update` dry-run plans the real render against the existing package root.
When that plan reports `invalid-previous-state` or a rejected action, the step
is `blocked` and names the remedy: a root written by an older repository
version cannot be updated in place, so run `--mode fresh` instead. A `fresh`
dry-run reports the render as `pending` without planning it, because the root
it would be planned against is cleared first. The run never pulls, merges, or
commits in this repository; when the checkout is behind its upstream the report
says so and leaves the pull to you.

Registration still ends in manual steps the products own: restart each product
that registered, then confirm the hook under its own review screen. Verify with
`claude plugin list`, `codex plugin list`, `agy plugin list`, and
`npm run test:model`.

## Source machine (author machine)

Use this order:

```text
edit -> quality:skill -> quality:quick -> quality:full -> review -> authorized commit/push
```

1. Enter the repository root.

2. Fetch remote metadata.

   ```text
   git fetch origin
   ```

3. Check the repository state.

   ```text
   npm run sync:status
   ```

4. Check the worktree.

   ```text
   git status --short
   ```

5. Check the current branch.

   ```text
   git branch --show-current
   ```

6. Check the current revision.

   ```text
   git rev-parse HEAD
   ```

7. Edit canonical files.

8. Run the skill check when a skill changed.

   ```text
   npm run quality:skill -- <skill-name>
   ```

9. Run the quick quality check.

   ```text
   npm run quality:quick
   ```

10. Run the full quality check.

   ```text
   npm run quality:full
   ```

11. Review the complete diff.

   ```text
   git diff --check
   git diff --stat
   git diff
   ```

Warning: commit and push are Git writes. Do them only after exact user
authority and a review of the complete diff.

12. Commit the reviewed files.

   ```text
   git add <FILES>
   git commit -m "<MESSAGE>"
   ```

13. Push the authorized branch.

   ```text
   git push origin main
   ```

Record the branch and commit SHA. Do not publish a native registration claim
from repository checks. No backup is made.

## Receiving machine

Use this order:

```text
fetch -> sync:status -> pull --ff-only -> quality checks -> doctor -> dry-run
-> install --apply -> register --dry-run -> authorized register --apply
-> restart/reload -> native verification
```

A package root last written before this version knows fewer surfaces than this
version renders. That direction is safe: `install --surface all` adds the new
surface namespace and leaves every existing surface byte-identical. A root
written by a 1.x repository is the other direction and still needs the manual
step below.

A package root last written by a 1.x repository lists surfaces this version no
longer renders. The installer cannot read that managed state, reports
`invalid-previous-state` in the plan, and will not prune the 1.x files (for
example `claude/commands/*.md`). Before rendering 2.x into such a root, remove the
old surface directories and the root `.all-about-agents/` directory, keep the root
path itself so the registered marketplace pointer stays valid, then render again.
`node scripts/setup.mjs --mode fresh` does this clear for you only when the root
holds no folder of a retired surface. Otherwise it lists the unknown entries and
deletes nothing.

Claude caches an installed plugin under its version directory, and an install
with an unchanged `version` does not refresh that copy. After
`claude plugin list --json`, the authorized `register --apply` runs the
`claude-plugin-cache-check` step, which compares that copy with the package.
When they differ or cannot be compared, it reports
`manual-required` and lists
`claude plugin uninstall all-about-agents@all-about-agents --scope user --keep-data`
and then `claude plugin install all-about-agents@all-about-agents --scope user`.
Run them with the same `CLAUDE_CONFIG_DIR`, then run `register --apply` again.
`npm run setup` removes the installed plugin before each registration for this
reason. `WhatsNew.md` lists the version history.

1. Enter the repository root.

2. Check Node.js.

   ```text
   node --version
   ```

3. Fetch remote metadata.

   ```text
   git fetch origin
   ```

4. Check local Git state.

   ```text
   npm run sync:status
   ```

5. Check for local changes.

   ```text
   git status --short
   ```

Stop if the worktree is not clean. Preserve and review local work before any
branch change or pull. Do not discard it.

6. Switch to the release branch.

   ```text
   git switch main
   ```

7. Pull with fast-forward only.

   ```text
   git pull --ff-only origin main
   ```

8. Check the local revision.

   ```text
   git rev-parse HEAD
   ```

9. Check the remote revision.

   ```text
   git rev-parse origin/main
   ```

The two SHAs must match. A pull does not install or register a native package.

10. Run the quick quality check.

   ```text
   npm run quality:quick
   ```

11. Run the full quality check.

   ```text
   npm run quality:full
   ```

12. Run `doctor` on a new disposable root.

   ```text
   node scripts/aaa.mjs doctor --surface all --destination-root "<DISPOSABLE_ROOT>" --format json
   ```

13. Inspect the non-mutating diff.

   ```text
   node scripts/aaa.mjs diff --surface all --destination-root "<DISPOSABLE_ROOT>" --statusline-name "<YOUR_NAME>" --format json
   ```

14. Plan the package install.

   ```text
   node scripts/aaa.mjs install --surface all --destination-root "<DISPOSABLE_ROOT>" --statusline-name "<YOUR_NAME>" --dry-run --format json
   ```

Warning: the next command writes installer-owned files below the explicit
disposable root. Read the dry-run report first. The installer creates no backup.

15. Apply the package only with exact installation authority.

   ```text
   node scripts/aaa.mjs install --surface all --destination-root "<DISPOSABLE_ROOT>" --statusline-name "<YOUR_NAME>" --apply --format json
   ```

16. Follow [dry-run registration](native-registration.md#dry-run-registration).
    This creates isolated product roots and includes the Codex local-Git
    package prerequisite. Do not use a generic register command for Claude or
    Codex.

Warning: the next command can write a product root or run native registration.
Use it only with exact authority and a reviewed dry-run report.

17. After exact authorization, follow
    [apply registration](native-registration.md#apply-registration).

18. Restart or reload the product.

19. Run [native verification](native-verification.md).

Use [native registration](native-registration.md) for the fixed Claude and
Codex actions. Missing products, credentials, or macOS are
`NOT_RUN_UNAVAILABLE`.
Trust that is available but not exercised is `NOT_RUN`.

## Stop conditions

Stop and report evidence when the branch, SHA, worktree, validation, quality,
destination root, or product prerequisite is wrong. Do not turn an unavailable
native check into a pass. Do not run `register --apply` from `git pull`, a
quality check, `doctor`, or normal dry-run.
