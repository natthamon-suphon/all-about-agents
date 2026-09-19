---
name: test-driven-development
description: Use when implementing any feature or bugfix that changes observable behavior, before writing implementation code
evaluationCases:
  - TD-TRIGGER-feature-or-bugfix
  - TD-NONTRIGGER-doc-only-change
  - TD-PRESSURE-keep-prewritten-code
---

# Test-Driven Development (TDD)

## Overview

Write a small behavior test first, watch the intended test fail, implement the
smallest change that makes it pass, and then refactor while it stays green.
The test is a contract at an observable public boundary, not a description of
private implementation details.

**Core principle:** If you did not watch the test fail for the missing or
changed behavior, you do not know that it can catch the problem.

## When to use

Use this skill before writing production code for:

- a new feature or bug fix;
- a behavior-changing refactor; or
- a change to an existing observable contract.

Do not apply a production-code test ceremony to a documentation-only,
comment-only, formatting-only, or configuration-only change when it makes no
runtime behavior change. Review links, syntax, schema, or formatting as
appropriate. Generated output is not an exception when its generator changes
behavior: test the generator or its observable output, and do not hand-edit a
generated file as a substitute for the source change.

## Skill Gate Protocol

1. Read the active request, repository instructions, approved plan, current
   task record, and relevant test and source files.
2. Classify the change. If it is documentation-only, comment-only,
   formatting-only, or configuration-only with no behavior change, skip the
   production RED/GREEN ceremony and run the narrow validation appropriate to
   that artifact. Otherwise continue.
3. Choose the outermost public seam where a caller observes the behavior. A
   trivial, bounded change with an obvious seam does not require a mandatory
   seam-confirmation ceremony: choose it, record the reason, and proceed. Ask
   for context only when the seam ambiguity would materially change scope or
   safety. A plan or task brief may already define the seam.
4. Write one minimal test for one behavior before writing or changing
   production code. Use real code and real inputs at the chosen seam; avoid
   mocks unless the dependency cannot be exercised safely.
5. Run that test and confirm a genuine RED result: the assertion fails because
   the required behavior is missing or wrong. A syntax, import, fixture, or
   environment error is not RED. Fix the test or environment error first.
6. Implement only the smallest production change that satisfies that failing
   test. Do not add speculative options, unrelated refactors, or extra
   behavior.
7. Run the same test and confirm GREEN. Then run the relevant focused suite and
   required checks. Keep exact commands and observed results as evidence.
8. Refactor only after GREEN: remove duplication, improve names, or extract a
   helper without changing behavior. Re-run the tests after every refactor.
9. Repeat one vertical slice at a time. Record RED evidence, GREEN evidence,
   remaining failures, and checks marked `not run`; do not claim an unobserved
   result.

## The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

This rule means a failing test that exercises the behavior at the chosen
seam. A test that only inspects a mock call, a private helper, or a snapshot
of implementation trivia is not evidence for the public contract.

## RED - GREEN - REFACTOR

```text
RED: write one behavior test -> run it -> verify the intended assertion fails
GREEN: write the smallest implementation -> run the same test -> verify pass
REFACTOR: clean up only while all tests remain green -> run them again
```

### RED: write and verify the test

Name the behavior and the production change that would make the test fail.
Prefer a complete, deterministic test using real code. If the test passes
before any implementation edit, it is not a RED result: inspect the assertion,
choose a missing edge or behavior, and run it again. If it errors, correct the
test setup rather than counting the error as failure.

### GREEN: implement minimally

Change only the production path needed by the failing test. Keep the public
interface as small as the requirement permits. Run the test immediately and
then the smallest relevant suite; fix production code when the intended test
fails, not the assertion merely to make the output green.

### REFACTOR: preserve the contract

After GREEN, simplify names or structure without adding behavior. Re-run the
focused test and suite after each cleanup. Continue to preserve the failing
test's boundary and the recorded RED/GREEN evidence.

## Prewritten-code pressure

Code may already be present when a task arrives. That does not grant
permission to delete, reset, overwrite, or otherwise destructively alter it in
order to manufacture a RED result.

1. Preserve the existing implementation and unrelated work.
2. Write the focused behavior test at the public seam anyway.
3. If it passes immediately, prove test sensitivity in a safe isolated way:
   use a minimal failing fixture or a disposable copy/mutation that never
   changes the working tree. Restore or discard only that disposable state.
   Never delete working production code as a test setup step.
4. Record the observed RED result (or state that a safe RED check was not run)
   and why, then run the test GREEN against the preserved implementation.
5. Treat a previous summary, manual click-through, or existing code as
   evidence to inspect, not as a replacement for a repeatable test.

The same rule applies under deadline pressure: retain both RED/GREEN evidence
and make the smallest change at the seam. Do not broaden scope because code
was prewritten.

## Seams and test quality

A seam is the public boundary where the behavior can be observed. Prefer the
outermost boundary that reproduces the caller's real behavior, especially for
regressions. For a trivial bounded change, no mandatory seam ceremony is
required; select the obvious public seam and continue. For a complex or
ambiguous change, use the approved plan or record the selected seam and the
scope reason before writing the test.

Good tests:

- state one behavior in a clear name;
- assert the result a caller needs;
- use deterministic real inputs and real code; and
- fail for the intended missing behavior before implementation.

Avoid tests that only assert call counts, private state, incidental markup, or
mock configuration. If a test is hard to write at the public seam, simplify
the interface or treat the difficulty as design feedback; do not move the
test inside the implementation merely to make it easy.

## Common rationalizations

| Excuse | Correct response |
|---|---|
| “I will test after coding.” | Stop. Write and observe the failing behavior test first. |
| “The change is too small.” | If it changes behavior, use one small seam test. |
| “The existing code already works.” | Preserve it; prove test sensitivity safely, then record GREEN. |
| “I must delete the code to get RED.” | Never delete working code. Use a disposable failing fixture or report RED as not run. |
| “The deadline means the seam can be skipped.” | Choose the obvious seam for a trivial change; urgency does not waive evidence. |
| “A manual check is enough.” | Manual checks are not repeatable RED/GREEN evidence. |
| “A test error is a failing test.” | Fix syntax, imports, fixtures, or environment; only the intended assertion failure is RED. |

## Verification checklist

- [ ] Change classification and safe exception are recorded when applicable.
- [ ] The chosen public seam is named; trivial cases did not stall for a
      mandatory confirmation ceremony.
- [ ] Each behavior test was written before its production change.
- [ ] Each test produced an intended RED result, or a safe limitation is
      explicitly recorded for preserved prewritten code.
- [ ] Minimal implementation produced GREEN, followed by focused checks.
- [ ] Refactoring happened only after GREEN and kept tests green.
- [ ] Unrelated work, secrets, and unrun checks remain preserved and truthful.

If any box cannot be checked, stop and report the missing evidence instead of
claiming the implementation is complete.
