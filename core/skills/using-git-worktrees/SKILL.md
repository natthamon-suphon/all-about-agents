---
name: using-git-worktrees
description: Use when a requested change needs an isolated Git checkout, or when deciding whether the current repository/worktree already provides safe isolation.
evaluationCases:
  - GW-TRIGGER-requested-isolation
  - GW-NONTRIGGER-current-isolated-worktree
  - GW-PRESSURE-auto-install-commit
---

# Using Git Worktrees

Use a Git worktree only when the requested work needs a separate checkout and
the human has explicitly approved the isolation plan. A worktree gives a
directory and Git state; it does not grant authority to install dependencies,
edit user configuration, commit, push, delete, or publish.

## Skill Gate Protocol

Run this gate before creating, switching, removing, or mutating a worktree:

1. Read the request, repository instructions, approved plan, current branch,
   worktree state, and uncommitted changes.
2. Require recorded, explicit human authority for the isolation and every
   additional mutation. A task description, silence, urgency, or a tool's
   default is not approval. If authority is absent, stop and ask.
3. Detect the native Git environment before choosing a path. Use Git's native
   status/repository queries (for example `git rev-parse --show-toplevel`,
   `--git-dir`, `--is-inside-work-tree`, and branch/HEAD inspection); do not
   infer repository state from directory names or remembered harness behavior.
4. Classify the result as a normal repository, an already-linked worktree, or a
   detached HEAD. Record the detected root, current worktree, branch/HEAD,
   cleanliness, requested target, authority, and the verification command.
5. Prove the target is a new disposable path inside the approved workspace,
   does not already exist, and cannot escape through a symlink/junction. Keep
   the source checkout and unrelated uncommitted work untouched.
6. Select the smallest native Git operation and argument vector. Never build a
   shell command by interpolating request text or paths. If any state, path, or
   authority check is uncertain, do not create a worktree; return to planning.

### State-specific decisions

- **Normal repository:** with recorded authority for isolation, create one
  worktree from an explicitly approved branch or commit and verify its path,
  HEAD, and branch afterward. Do not invent a branch name or silently switch
  the source checkout.
- **Linked worktree:** treat the current checkout as already isolated when its
  `git worktree`/Git metadata confirms that fact. Continue in place unless the
  request explicitly approves a second worktree; never create a nested or
  duplicate checkout by default.
- **Detached HEAD:** require explicit authority for the exact target branch or
  commit before creating a worktree. Do not guess a branch, attach HEAD as a
  side effect, or claim a detached checkout is a named branch.

## Safe operation

After creation, re-run native Git detection in the target and verify the
expected branch/commit, repository root, and worktree path. Keep setup and
cleanup reversible and narrow. Removing a worktree, deleting an empty target,
or changing branch state requires separate explicit authority; report failures
without broad cleanup.

Do not automatically install dependencies or tools. Check the repository's
documented environment and use an already available native runtime; if a
dependency is missing, report it and ask for permission rather than installing
it. Do not automatically create or commit `.gitignore` changes, and do not
make any other commit. Commits, pushes, backups, and configuration changes are
separate user-authorized actions.

## Non-trigger

Do not invoke this skill for ordinary work that is already inside the approved
isolated worktree. Do not create a worktree merely because multiple files,
agents, or commands are involved; isolation is a decision requiring the gate,
not a default workflow step.

## Failure handling

Stop on an unavailable native Git executable, an unproven repository root, an
existing or unsafe target, dirty state that the plan does not cover, detached
HEAD without branch authority, or any failed post-operation verification. Keep
the exact evidence and state the smallest next decision needed from the human.
