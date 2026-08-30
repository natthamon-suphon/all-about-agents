---
name: loop-me
description: Use when the human explicitly invokes loop-me to turn a recurring workflow into an implementation-ready specification.
requiredSkills:
  - interviewing
evaluationCases:
  - LM-TRIGGER-explicit-workflow-grill
  - LM-NONTRIGGER-normal-feature
  - LM-PRESSURE-endless-questioning
---

# Loop Me

Specify recurring workflows when the human explicitly invokes this skill. The
wrapper owns the workflow specification artifact; this skill owns the
questioning discipline and the readiness contract.

**Core principle:** ask only questions whose answers can change the workflow
specification, then stop as soon as an implementer can build it without
guessing.

## Explicit-invocation-first gate

Loop Me is opt-in. Do not invoke it automatically because a request mentions a
workflow, a recurring task, or a design. A normal feature, build, change, or
architecture request routes to `brainstorming`; normal brainstorming must not
route here automatically. Invoke Loop Me only when the human explicitly names
or invokes `loop-me`, or directly asks to be grilled about a workflow.

## Skill Gate Protocol

1. Inspect the request, existing brief, workspace notes, repository evidence,
   and recorded decisions. Resolve answerable facts before asking anything.
2. Confirm explicit invocation and identify the wrapper-owned workflow
   artifact. Without explicit invocation, the skill check is not required; do
   not ask Loop Me questions.
3. Define the single workflow in scope. Use `interviewing` for the questioning
   discipline: ask exactly one material question per message and attach a
   recommendation with a short reason.
4. Record each decision in the workflow artifact immediately. Never infer an
   answer, hide an unresolved branch, or replace a human decision with a
   guess.
5. Re-check the readiness contract after every answer. Stop immediately when
   the workflow is specification-ready; return the finished artifact to the
   wrapper instead of continuing to interview.

## Specification-ready stop condition

A workflow is specification-ready when every applicable item below is decided
in the artifact and the count of unresolved material questions is zero:

- outcome and non-goals;
- trigger (event, schedule, or explicitly `none`);
- inputs and source of truth;
- ordered actions, owner, and authority boundaries;
- output, destination, and format;
- checkpoints or approvals, or explicitly `none`;
- failure, retry, escalation, and stop behavior; and
- verification evidence and acceptance criteria.

Each item must contain a concrete decision or an explicit `not applicable`;
blank, guessed, or deferred material choices are not ready. This checklist is
the measurable stop rule: once all applicable items are decided and unresolved
questions equal zero, ask no more questions. A request for endless questioning
does not reopen a ready workflow; start a separately scoped workflow only when
the human explicitly asks for one.

## Output contract

Return workflow specifications only. Keep the artifact as the source of truth,
with decisions, boundaries, failure behavior, and acceptance evidence visible
to an implementer. Do not turn the session into a feature design, an
implementation plan, or an unbounded discovery interview.

## Red flags

- Auto-routing here from an ordinary feature or brainstorming request.
- Asking about a fact already present in the supplied evidence.
- Batching questions, omitting a recommendation, or answering for the human.
- Continuing after the readiness checklist is complete.

Stop and apply the gate again when any red flag appears.
