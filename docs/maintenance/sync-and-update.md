# Sync and update on another machine

Git is the cross-machine source of truth. A pull updates this repository only.
It does not install files, register a plugin, change trust, or start a native
session. Git actions and native mutations are separate.
Check a clean worktree before a receiving-machine pull. The worktree must be
clean before a receiving-machine pull.

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
`<CODEX_HOME>/AGENTS.md`, and `~/.gemini/GEMINI.md`. Project instruction files
and plugin rules remain the more specific second layer. Read
[global instructions](global-instructions.md) for the complete model.

`GEMINI.md` is the one destination that is never overwritten. When the file
already exists and differs, registration reports `manual-required` and writes
nothing, because a live Gemini home may hold operator sections this package
does not own. On such a machine, keep the rendered file and append everything
from the first heading it does not contain.

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
| `fresh` | every previous render removed first | the root was written by an older repository version, or a render is in doubt |

Both modes run the same remaining pipeline: validate the checkout, report how
it compares with its upstream, render into the package root, commit the Codex
plugin source when it changed, remove the installed plugin from each product,
register each surface, and list what each product reports.

The plugin removal is not optional in either mode, because both products serve
a cached snapshot and a version-keyed cache does not refresh in place. It runs
after the render on purpose: a failed render then leaves the working
installation untouched instead of stranding the product with no plugin.

`fresh` clears only the package root, which is a directory this installer owns
end to end. It never deletes anything inside `CLAUDE_CONFIG_DIR`, `CODEX_HOME`,
or the Gemini home, so personal skills, settings, credentials, and history stay
in place; registration then overwrites only the files the package owns. The run
refuses a package root that is a home directory, a live product root, this
repository, or any directory without a rendered package marker.

The defaults are `~/.all-about-agents/package`, profile `template`, and every
surface. Options: `--package-root`, `--profile`, `--surface`,
`--statusline-name`, and `--format text|json`. When the display name is not
supplied, the name already rendered in the package root is reused.

Manage one package root either as a whole with `--surface all`, or per surface
with a subset, never both. `--surface all` keeps one managed state at the root;
a subset writes a second one inside `<root>/<surface>`, and registration
prefers the nested file. The two then drift apart on the next render and the
surface fails with a hash mismatch. A subset run against a root that is already
managed as a whole is refused with `surface-subset-in-managed-root`.

A reported step is `completed`, `pending` (planned, needs `--apply`),
`skipped` with a reason (for example a plugin that was not installed),
`not-run-unavailable` when a product CLI is off PATH, `blocked`, or `failed`.
A failed or blocked step stops the run, the remaining steps are listed as not
attempted, and the exit code is 1.

An `update` dry-run plans the real render against the existing package root.
When that plan reports `invalid-previous-state` or a rejected action, the step
is `blocked` and names the remedy: a root written by an older repository
version cannot be updated in place, so run `--mode fresh` instead. A `fresh`
dry-run reports the render as `pending` without planning it, because the root
it would be planned against is cleared first. The run never pulls, merges, or commits in this repository; when the
checkout is behind its upstream the report says so and leaves the pull to you.

Registration still ends in manual steps the products own: restart the product,
then confirm the hook under its own review screen. Verify with
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

Claude caches an installed plugin under its version directory. When `version`
in `package.json` changed since the last registration, `claude plugin update`
is not enough: run `claude plugin uninstall all-about-agents@all-about-agents`
and then `claude plugin install all-about-agents@all-about-agents` after the
authorized `register --apply`. When only the marketplace pointer changed,
`claude plugin update` is enough. `WhatsNew.md` lists the version history.

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
