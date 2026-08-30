---
name: requesting-code-review
description: Use when a meaningful change is ready for an independent review before completion, merge, release, or handoff
evaluationCases:
  - RQ-TRIGGER-major-change-before-finish
  - RQ-NONTRIGGER-no-diff
  - RQ-PRESSURE-no-commit-sha
---

# Requesting Code Review

## Overview

An independent review is a deliberate check of a meaningful change against
its requirements, behavior, safety, and scope. Give the reviewer a precise,
reproducible package; do not make unrelated repository changes to create one.

## Skill Gate Protocol

1. Classify the current state. A major behavior, interface, permission,
   installer, data, or release-facing change that is ready for completion
   requires an independent review. A clean working tree with no diff has
   nothing to review; report that fact and do not invent a review request.
2. Establish the exact review scope before packaging it: changed files,
   requirements, behavior to inspect, risk boundaries, and checks already run.
   Keep unrelated files and historical context out of scope unless they are
   required to understand the change.
3. Build the smallest review package that exposes the current change. It may
   use an unstaged diff, staged diff, a commit or commit range, or a named
   artifact/file list. A commit SHA is optional; a review must not be blocked
   when no commit exists.
4. State the evidence available: exact commands and results, files inspected,
   and known limitations. Mark unavailable checks `not run` with a concrete
   reason. Do not convert a partial review into approval or completion.
5. Ask for independent findings at the stated scope. Preserve the worktree;
   never commit, push, create a pull request, or rewrite history merely to
   enable review. If a transport is unavailable, provide the package locally
   and report that limitation.

The gate is satisfied only when the reviewer can identify the exact current
change, requirements, evidence, and remaining `not run` checks without
guessing.

## When to Use

Use this skill before declaring meaningful work complete when it changes:

- public behavior, interfaces, or user-visible output;
- permissions, emergency handling, installers, data flow, or release gates;
- a large or risky module, generated package, or cross-surface adapter; or
- a handoff that benefits from a fresh independent inspection.

Do not request review for a clean/no-diff state. A documentation-only typo or
other explicitly out-of-scope change may use its own narrow check when there is
no meaningful code change to review.

## Review package forms

Choose exactly the form that matches the current state:

| Current state | Package | Required context |
|---|---|---|
| Worktree edits not staged | Unstaged diff | Changed file list and `git diff` evidence |
| Index contains edits | Staged diff | Changed file list and `git diff --cached` evidence |
| Existing commits define the change | Commit/range diff | Range and base/target context; SHA is optional |
| Generated or external artifact is the boundary | Artifact/file list | Absolute or repository-relative paths, hashes if available, and artifact checks |
| No changed files | No review package | Report clean/no-diff and stop the review request |

Do not mix an old commit range with unrelated current worktree edits without
labeling both scopes. Review exactly what the reviewer is asked to inspect.

## Request template

```text
Review scope: <files, range, or artifact list>
Requirements: <acceptance criteria to check>
Risk focus: <behavior, security, portability, data loss, or release risks>
Evidence:
  - <exact command>: <exit code and observed result>
  - <exact command>: <exit code and observed result>
Not run: <check> — <concrete reason>
Questions: <specific uncertainties for the reviewer>
```

The package is complete when it identifies the diff or artifact, requirements,
evidence, and limitations. “Please review” without scope is not a review
request. “All good” is not an independent finding.

## No commit required

A reviewer can inspect an unstaged or staged diff, a local commit range, or a
file/artifact list. If pressure comes with a request for a commit SHA, explain
that no SHA is required and offer the current diff or artifact list. Do not
create a throwaway commit, push it, open a PR, or alter history just to satisfy
that preference.

## Common mistakes

| Mistake | Correct response |
|---|---|
| Review request has no file or range scope. | Name the exact changed files, range, or artifacts. |
| No commit exists. | Use the unstaged/staged diff or artifact list; SHA is optional. |
| Worktree is clean. | Report no diff and do not fabricate a review. |
| Reviewer asks for unrelated cleanup. | Keep scope fixed and ask for direction before expanding it. |
| One check could not run. | Mark it `not run` with the reason; do not infer pass. |
| Deadline is near. | Preserve the current state and request the smallest independent review. |
| A PR would make review easier. | Do not create one without separate authorization. |

## Completion checklist

- [ ] Trigger classification is recorded.
- [ ] Review scope and requirements are exact.
- [ ] The package uses the current unstaged, staged, range, or artifact form.
- [ ] A clean/no-diff state was handled as a non-trigger.
- [ ] Commit SHA is not treated as mandatory.
- [ ] Exact evidence and results are listed.
- [ ] Unavailable checks are explicitly `not run` with reasons.
- [ ] No commit, push, PR, or history rewrite was performed only for review.
