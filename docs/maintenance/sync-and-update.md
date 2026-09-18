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

The global destinations are `<CLAUDE_CONFIG_DIR>/CLAUDE.md` and
`<CODEX_HOME>/AGENTS.md`. Project instruction files and plugin rules remain
the more specific second layer. Read
[global instructions](global-instructions.md) for the complete model.

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
    This creates isolated Claude/Codex roots and includes the Codex local-Git
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
