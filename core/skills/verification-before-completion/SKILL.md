---
name: verification-before-completion
description: Use when about to claim work is complete, fixed, correct, or passing, or before committing, merging, releasing, or handing off results
evaluationCases:
  - VC-TRIGGER-before-success-claim
  - VC-NONTRIGGER-progress-update
  - VC-PRESSURE-old-test-output
---

# Verification Before Completion

## Overview

Evidence comes before claims. A completion, correctness, or passing claim is
an assertion about the current workspace and must be backed by fresh,
scoped command output from this turn.

**Core principle:** Never turn an old observation, an inference, or a partial
check into a current success claim.

## Skill Gate Protocol

1. Classify the statement you are about to make. A progress update such as
   “I am investigating the failing test” is not a completion claim and does not require
   the completion gate. “Fixed”, “complete”, “passes”, “correct”,
   “ready”, or any equivalent implication does require it.
2. Name the exact claim and the smallest command that proves it. Scope the
   command to the changed behavior and its direct contract; do not run an
   unrelated full repository suite just to manufacture evidence.
3. Run that command now, read its complete output and exit status, and compare
   the result with the claim. Record the exact command, exit code, and observed
   counts or result. A prior run, a reviewer statement, a diff, or “it should
   work” is not fresh evidence.
4. Check the changed files and the applicable requirements. Run syntax,
   import, schema, deterministic-render, or focused regression checks when
   those checks are what the claim needs. Never expose secrets while showing
   output; redact credentials, tokens, private values, and sensitive paths.
5. If a relevant check cannot run, say `not run` and give the concrete reason.
   Do not call the work complete, force an unrelated substitute, or silently
   downgrade the requirement. Report partial evidence as partial.

The gate is mandatory even under deadline pressure, after a successful manual
check, or when another agent reports success.

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

Before claiming completion, correctness, a fix, a passing test, or release
readiness, perform the gate in this message. A command that was run earlier in
the conversation is stale until rerun against the current state.

## Gate Function

```text
IDENTIFY: state the exact claim and its proving command
RUN: execute the complete scoped command in the current workspace
READ: inspect all output, exit code, and failure counts
VERIFY: decide whether evidence supports the exact claim
REPORT: include command, result, and any not-run checks
CLAIM: use success language only after the preceding evidence
```

If the command fails, report the failure and investigate it. Do not change the
assertion to fit the output, hide the failure, or stack an unverified fix on
top. If the check passes but does not exercise the claimed behavior, it is
insufficient evidence and the claim remains unverified.

## Fresh and scoped evidence

Fresh means the command ran after the final relevant change and its output is
available for inspection now. Scoped means the command tests the changed
boundary and direct consumers. Examples:

- A bug fix: rerun the original reproducer and the focused regression test.
- A source change: run the relevant syntax/import and behavior checks.
- A generated package: render twice, compare byte-for-byte, and validate its
  schema and ownership hashes.
- A release claim: run the release gate; if native or exhaustive checks are
  unavailable, mark each one `not run` rather than inferring pass.

Do not use a green test from before the last edit, a cached result with no
timestamp or command, a screenshot without its assertion, or a neighboring
test as proof. “All tests pass” requires the exact suite command and its full
zero-failure result; a focused test proves only its focused contract.

## Progress is not completion

Progress updates may describe actions and observed intermediate state:

```text
Progress: the focused test is still failing at the parser boundary; no fix
claim is made. The full suite is not run because it is outside this scope.
```

They must not imply that the work is fixed or ready. Completion reports should
name each fresh proving command and result, then list scoped checks that are
`not run` with reasons. Do not use “nearly done”, “looks good”, “should pass”,
or similar language as a substitute for evidence.

## Pressure and stale output

When someone supplies old green output or says the change is obvious:

1. Preserve the current work and identify what changed since that output.
2. Rerun the smallest command that exercises the current behavior.
3. If it fails, keep the claim unverified and return to diagnosis; do not guess
   a fix or report the old green output as current.
4. If it passes, record the fresh command and result. The old output remains
   historical context, not evidence for this claim.

Never print a complete environment or secret-bearing command to “prove” a
result. Use redacted, bounded diagnostics and report only the metadata needed
to interpret the check.

## Common failures

| Temptation | Correct response |
|---|---|
| “It passed earlier.” | Rerun the exact command after the last relevant change. |
| “The diff is tiny.” | Verify the behavior at its public boundary. |
| “The full suite is too slow.” | Run the smallest direct check and mark broader checks `not run`. |
| “The agent/reviewer said it works.” | Inspect the workspace and run fresh evidence yourself. |
| “The command exited zero.” | Confirm it asserted the claimed behavior and did not skip tests. |
| “I need to finish quickly.” | Pressure does not waive the evidence gate. |

## Completion checklist

- [ ] Exact claim and proving command are named.
- [ ] Command ran freshly after the final relevant change.
- [ ] Full output, exit code, and failure count were read.
- [ ] Scope covers the changed behavior and direct contract.
- [ ] Syntax/import/schema/render checks were run when applicable.
- [ ] Unavailable or unrelated checks are explicitly `not run` with reasons.
- [ ] Secrets and private values are redacted.
- [ ] No completion or success implication was made before the evidence.
