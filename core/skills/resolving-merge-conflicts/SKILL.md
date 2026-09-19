---
name: resolving-merge-conflicts
description: Use when a merge, rebase, cherry-pick, or stash operation has unresolved paths or conflict markers that must be resolved safely
evaluationCases:
  - MC-TRIGGER-active-conflict
  - MC-NONTRIGGER-clean-tree
  - MC-PRESSURE-stage-all-never-abort
---

# Resolving Merge Conflicts

## Overview

Resolve conflicts by reconstructing intended behavior, not by deleting marker
lines or choosing one side wholesale. Preserve unrelated user work, stage only
the exact files you resolved, retain a safe user-selected abort path, and prove
that Git has zero unresolved entries before continuing.

## Skill Gate Protocol

1. **Confirm an active conflict.** Run `git status --short` and
   `git diff --name-only --diff-filter=U`. Use `git ls-files -u` to inspect the
   unresolved index. If all are empty and the working tree is clean, this skill
   is a nontrigger; do not manufacture a merge operation.
2. **Identify the operation and scope.** Determine whether Git reports a merge,
   rebase, cherry-pick, revert, or stash conflict. Record every unresolved path
   and any unrelated pre-existing edits.
3. **Offer the decision boundary.** Explain the conflicted paths and the safe
   continuation and abort choices. If the user chooses to abort, use only the
   operation-matched command and verify the resulting state:

   - merge: `git merge --abort`
   - rebase: `git rebase --abort`
   - cherry-pick: `git cherry-pick --abort`
   - revert: `git revert --abort`

   A user-selected abort is a valid outcome. Never promise that abort is
   available without confirming the active operation; never simulate it with
   reset, checkout, clean, or deletion.
4. **Resolve semantically.** Read the base/current/incoming intent, nearby code,
   tests, and requirements. Combine compatible behavior and preserve public
   contracts. Do not automatically choose "ours" or "theirs", and do not modify
   unrelated files.
5. **Check the file before staging.** Inspect the diff and search the resolved
   paths for conflict markers such as `<<<<<<<`, `=======`, and `>>>>>>>`.
   Treat marker-like strings in fixtures or documentation as possible legitimate
   data and inspect each hit rather than deleting it blindly.
6. **Stage exact resolved paths.** Use `git add -- <resolved-path> [<resolved-path> ...]`.
   Never use broad staging for conflict resolution. Re-run
   `git diff --name-only --diff-filter=U` and `git ls-files -u`; both must report
   zero unresolved entries before continuation.
7. **Verify behavior and continue only with authority.** Run the smallest tests
   covering the reconciled behavior. Show the staged diff and remaining
   unstaged/untracked state. Do not commit, continue the Git operation, push, or
   discard user work unless the active request authorizes that exact action.

## Safe inspection sequence

```text
git status --short
git diff --name-only --diff-filter=U
git ls-files -u
git diff -- <conflicted-path>
git diff --check
```

After editing each path, inspect it and then stage only that path:

```text
git diff -- <resolved-path>
git add -- <resolved-path>
git diff --name-only --diff-filter=U
git ls-files -u
git diff --cached -- <resolved-path>
```

Pass paths as separate argv values or use the current shell's safe literal-path
mechanism. Do not interpolate untrusted filenames into a shell command string.

## Resolution reasoning

For every conflicted hunk, answer:

- What behavior did the base version provide?
- What independent intent does each side add or change?
- Which requirements and tests define the desired combined result?
- Is either side stale because a symbol, schema, or interface moved?
- What regression check proves the reconciliation?

When intent cannot be inferred safely, stop on that hunk and request the missing
product decision. Do not guess away user behavior.

## Marker and index verification

Conflict resolution requires both of these conditions:

1. Git reports no unresolved index entries (`git ls-files -u` is empty and
   `git diff --name-only --diff-filter=U` lists no paths).
2. The resolved source paths contain no unresolved conflict markers. Any
   marker-like text that remains in a test fixture or documentation file is
   reviewed and explicitly justified.

An empty marker search alone is insufficient because a binary or manually
staged path may still be unmerged. A clean index alone is insufficient if marker
text was accidentally staged.

## Pressure handling

If asked to "stage everything and never abort":

- reject broad staging because it can capture unrelated user changes;
- stage only exact resolved files;
- preserve the operation-matched, user-selected abort path until continuation;
- do not use destructive reset/checkout/clean as a shortcut; and
- report unresolved paths, marker checks, tests, and `not run` checks honestly.

## Completion checklist

- [ ] The active Git operation and every unresolved path are identified.
- [ ] Pre-existing unrelated edits are preserved.
- [ ] The user-selected abort path remains safe and operation-matched.
- [ ] Each hunk is resolved from intent and requirements.
- [ ] Only exact resolved paths were staged.
- [ ] Git reports zero unresolved index entries.
- [ ] No unresolved conflict marker remains in resolved source paths.
- [ ] Focused behavior checks ran, or are explicitly `not run` with reasons.
- [ ] No commit, continue, push, discard, or cleanup occurred without authority.
