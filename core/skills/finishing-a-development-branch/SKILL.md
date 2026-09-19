---
name: finishing-a-development-branch
description: Use when implementation is complete, verification has passed, and the human asks to finish or integrate a development branch
evaluationCases:
  - FB-TRIGGER-tests-pass-user-asks-finish
  - FB-NONTRIGGER-incomplete-tests
  - FB-PRESSURE-auto-push-merge
---

# Finishing a Development Branch

Finishing has two separate phases: first produce fresh verification evidence,
then offer optional Git integration. A request to finish does not itself grant
authority to commit, push, open a pull request, merge, discard work, or clean
up a branch or workspace.

## When to use

Use this skill when the implementation is complete, all required tests and
checks have passed, and the human asks what to do with the branch. Do not use
it to bypass incomplete tests, failing tests, or unrun checks, or to turn
urgency into Git authority.

## Skill Gate Protocol

1. Read the active request, repository instructions, approved plan, current
   task record, and relevant branch/worktree state.
2. Confirm both predicates: the human is asking to finish or integrate, and
   implementation verification is complete. If tests are incomplete, failing,
   or unknown, report the evidence and stop before presenting integration
   options.
3. Run the project's complete test suite and the required focused checks. Keep
   the command, exit status, and failure details as evidence. Never rely on an
   earlier session's claim that tests passed.
4. Inspect the current repository state after verification. Establish whether
   this is a normal repository, a named branch worktree, or a detached
   workspace. Preserve unrelated and uncommitted work.
5. Determine the intended base branch from the approved plan or the human.
   Do not guess a base branch before a merge.
6. Separate verification from optional Git integration. Verification changes no
   history and does not imply any integration action.
7. Ask for explicit human authority for each requested operation: commit,
   push, pull request, merge, discard, or cleanup. A request to "finish",
   deadline pressure, a previous summary, or a green test run is not authority.
8. After an authorized integration action, rerun the relevant verification and
   report its result. If verification or integration fails, stop and preserve
   the branch and worktree for investigation.

## Verification phase

Run the full project test suite after implementation. If any test fails, or a
required check was not run, stop and report the exact failure or `not run`
limitation. Do not show a Git integration menu, create a commit, push, open a
pull request, merge, or clean up.

When verification passes, report the fresh evidence first. Include the current
branch/worktree state and any base-branch uncertainty. This is the end of the
verification phase; no Git operation has happened yet.

## Optional Git integration phase

Only after a green verification phase, present a concise choice and wait for
the human's answer. Each action below needs explicit authority for that exact
action:

- Keep the branch and worktree as-is.
- Create a local commit, if the human explicitly authorizes the commit.
- Merge locally, only after the human confirms the exact base branch and
  explicitly authorizes the merge. Verify the merged result before cleanup.
- Push the explicitly named branch and/or open a pull request, only when the
  human explicitly authorizes push and pull-request creation separately.

Never push, merge, or clean up automatically. Never infer commit, push, pull
request, or merge authority from the word "finish" or from an approved plan
that does not explicitly authorize the current operation. Do not delete a
branch or worktree as a side effect of a successful merge. Cleanup or discard
requires a separate explicit request naming the target, and must preserve
recoverable evidence until that request is confirmed.

If the human asks to discard work, identify the exact branch, commits, and
worktree, explain that the action is destructive, and require the exact
confirmation `discard` before doing anything. Without that confirmation, keep
everything in place.

## State-specific reporting

For a normal repository or named branch worktree, report the known base branch
and offer the choices above. For a detached workspace, explain that merging
requires a named branch and do not invent one. If the base branch, remote, or
native integration capability is unknown, record it as `not run` and ask the
human for the missing fact or authority.

## Common mistakes

| Excuse | Reality |
|---|---|
| "Tests passed earlier" | Run fresh verification on the tree about to be integrated. |
| "Finish means push or merge" | Finish is a status request; Git operations require explicit authority. |
| "The deadline means cleanup is harmless" | Urgency changes no permission and does not justify data loss. |
| "The plan or a prior summary authorized it" | Verify current bytes and authority; do not trust summaries as permission. |
| "A successful merge means the worktree can go" | Cleanup is a separate destructive action requiring explicit authority. |

## Red flags - stop

- Tests are incomplete, failing, or only claimed to have passed.
- About to show integration choices before verification evidence.
- About to commit, push, open a pull request, or merge without exact human
  authority.
- About to delete, discard, prune, or clean up without a separate confirmed
  request.
- Base branch or target workspace is guessed rather than confirmed.

When a red flag appears, stop, report the evidence and limitation, and wait
for the one missing verification result or authority decision.
