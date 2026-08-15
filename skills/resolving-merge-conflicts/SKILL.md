---
name: resolving-merge-conflicts
description: Use when a git merge, rebase, cherry-pick, or stash pop has stopped on conflicts, or when conflict markers are present in the working tree
---

# Resolving Merge Conflicts

Resolve by **intent**, not by whichever hunk looks tidier. Every conflicting line was written for a reason; your job is to find both reasons and honour them.

**Announce at start:** "I'm using the resolving-merge-conflicts skill to work through this merge."

## The Iron Law

```
NEVER --abort. ALWAYS RESOLVE.
```

Aborting throws away the understanding you are about to build. If the merge turns out to be genuinely wrong, say so and let your human partner make that call — don't unilaterally unwind it.

## Step 1: See the current state

Establish what is actually happening before touching a file:

```bash
git status                      # merge or rebase? which files conflict?
git log --oneline --graph -20   # what is being merged into what
git diff --name-only --diff-filter=U
```

Know which side is "ours" and which is "theirs" — during a rebase they are inverted relative to a merge, and getting this backwards silently reverses your resolutions.

## Step 2: Find the primary sources

For each conflict, understand deeply why each change was made and what the original intent was:

- `git log` and `git blame` on both sides of the hunk
- The commit messages that introduced each change
- The PR, issue, or ticket each commit references

Do not resolve a hunk whose two intents you cannot state in one sentence each. If you cannot find the intent, say so and ask.

## Step 3: Resolve each hunk

- **Preserve both intents where possible.** Most conflicts are two independent changes that collided textually, not semantically.
- **Where genuinely incompatible**, pick the one matching the merge's stated goal, and note the trade-off for the final report.
- **Do NOT invent new behaviour.** A merge resolution is not the place for improvements, refactors, or "while I'm here" fixes. If the correct resolution needs new code, flag it as follow-up work.
- Remove every conflict marker. Grep for `<<<<<<<` when you think you're done.

## Step 4: Run the project's checks

Discover the project's automated checks and run them — typically typecheck, then tests, then format. Fix anything the merge broke.

A resolution that compiles but was never tested is unverified. Follow `all-about-agents:verification-before-completion`: no "resolved" claim without fresh output.

## Step 5: Finish the operation

Stage everything and complete the merge or rebase:

```bash
git add -A
git merge --continue     # or: git rebase --continue
```

If rebasing, keep going until every commit is replayed — later commits can conflict too, and the job isn't done at the first `--continue`.

## Report

When finished, tell your human partner: which files conflicted, how each incompatible hunk was decided and why, any trade-off you took, and the output of the checks you ran.
