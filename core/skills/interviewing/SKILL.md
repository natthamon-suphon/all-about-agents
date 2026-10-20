---
name: interviewing
description: Use when a wrapping skill needs a short questioning session to resolve material design or workflow decisions with a human partner.
evaluationCases:
  - IN-TRIGGER-open-design-decisions
  - IN-NONTRIGGER-discoverable-answer
  - IN-PRESSURE-ask-many-at-once
  - IN-TRIGGER-missing-intent
  - IN-TRIGGER-independent-decisions
  - IN-NONTRIGGER-explicit-skip
---

# Interviewing

The wrapping skill owns the output and decides when discovery begins and ends.
`brainstorming` owns the design; `loop-me` owns the workflow specification.
Do not make this skill the entry point for building or changing something.

Ask only what could change the work. Find facts yourself. Keep the human's
decisions separate from assumptions and choices delegated to the builder.

## Skill Gate Protocol

1. Confirm a wrapping skill owns the output: the design from `brainstorming`
   or workflow specification from `loop-me`. Honor the wrapper's scope and
   existing decisions. An explicit request to skip discovery returns control
   to the wrapper; preserve authority and security boundaries.
2. Inspect the request, existing brief, repository evidence, and decisions
   already recorded. Resolve facts that are answerable from those sources
   before asking the human. Research material external facts through the
   applicable workflow. A pending fact is an unsettled prerequisite; do not
   guess the answer or ask its dependent questions yet.
3. Keep decisions whose answer could change scope, behavior, structure,
   authorization, destination, or acceptance criteria. Skip preferences and
   decisions already settled, routine builder choices, and curiosity that
   cannot change the result.
4. When intent is missing, ask one open question about a real moment, problem,
   or outcome before presenting solution options. Use the human's vocabulary.
   For a concrete choice, give a short recommendation with its main trade-off;
   offer two or three options when that helps them decide. Identify delegated
   defaults as your calls rather than claiming they approved them.
5. Follow dependencies. Ask the highest-impact unsettled prerequisite first.
   When independent material questions have settled prerequisites, group them
   in one compact round only if that saves a round without adding confusion.
   Number grouped questions and make each answer unambiguous. Never infer
   answers from urgency or silence. Recompute the remaining branches after
   actual answers arrive.
6. Record the decision in the wrapper's artifact immediately, or its chat
   description when no document is needed. Explain conflicts with an approved
   constraint and resolve the smallest corrective decision. Stop when an
   implementer can proceed without guessing a material requirement; return
   control to the wrapper. A resolved question is not a new approval gate.

## Stop conditions

- A discoverable fact needs no interview; inspect it and report its source.
- A read-only answer or an already decision-ready brief needs no questionnaire.
- An explicit opt-out ends interviewing without granting external, paid, live,
  destructive, or otherwise missing authority.
- If a question repeats, depends on an unanswered choice, or cannot change the
  output, remove it from the current round.

Use concise playback only where it checks understanding. No fixed word count,
mandatory solution menu, or interview for every task.
