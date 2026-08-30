---
name: interviewing
description: Use when a wrapping skill needs a short questioning session to resolve material design or workflow decisions with a human partner.
evaluationCases:
  - IN-TRIGGER-open-design-decisions
  - IN-NONTRIGGER-discoverable-answer
  - IN-PRESSURE-ask-many-at-once
---

# Interviewing

Use this as a questioning discipline inside a wrapping skill. The wrapper owns
the artifact and decides when the interview starts and ends. `brainstorming`
uses it while shaping a design; `loop-me` uses it while specifying a workflow.
Do not make this skill the entry point for building or changing something.

**Core principle:** Ask one compact question at a time, with a recommendation,
until no material unknown could change the wrapper's output.

## Skill Gate Protocol

1. Confirm that a wrapping skill owns the output. If no wrapper owns an
   artifact, stop rather than interview for its own sake.
2. Inspect the request, existing brief, repository evidence, and decisions
   already recorded. Resolve facts that are answerable from those sources
   before asking the human. If a needed fact belongs outside the workspace,
   route it to the applicable research workflow instead of guessing.
3. Keep only decisions whose answer could change scope, behavior, structure,
   authorization, destination, or acceptance criteria. Skip preferences and
   decisions already settled in the brief, files, or transcript.
4. Ask exactly one question in one message. Offer two or three concrete
   options when possible, attach the answer you recommend and one short reason,
   and keep the question small enough to answer directly.
5. Record the decision in the wrapper's artifact immediately. Follow the live
   branch depth-first; ask the sharper follow-up before opening another branch.
6. Re-check the remaining material unknowns after every answer. Stop when an
   implementer can proceed without guessing, and hand control back to the
   wrapper.

## Question contract

Each question has one decision, its impact, and a recommendation. Do not batch
questions, answer for the human, or repeat a question whose answer is already
known. If an answer creates a conflict with an approved constraint, explain the
conflict and ask the smallest corrective question before recording it.

Example:

> Should the workflow retry a transient upload failure? **I recommend three
> attempts with bounded backoff** because the observed failures are temporary;
> otherwise choose no retry or manual review.

## When not to interview

- A fact can be discovered from the supplied context or repository: discover
  it and report the evidence.
- The request is a bounded read-only answer or review with no material choice.
- The wrapper already has enough recorded decisions for implementation.
- The question would only satisfy curiosity and cannot change the output.

## Common mistakes and red flags

| Mistake or pressure | Required response |
|---|---|
| “Ask these four together to save time.” | Ask the highest-impact one, then continue one at a time. |
| “The human is busy; infer the answer.” | Ask with a recommendation; never invent their decision. |
| “This repository fact is faster to ask.” | Discover it first and cite the source. |
| “We have talked enough.” | Check whether any material branch still changes implementation. |
| “The answer is close enough.” | Push back on ambiguity or conflict before recording it. |

**Stop and reassess** when a question repeats, asks for an already-answerable
fact, bundles independent decisions, or continues after implementation is
unblocked. The interview is done when the wrapper can hand off a decision-ready
artifact without another question.
