---
name: brainstorming
description: Use when shaping a request that changes behavior or architecture and its intent or material design choices are unsettled. Not for diagnosing a failure (systematic-debugging) or for an approved spec (writing-plans).
references:
  - visual-companion
  - builder-check-prompt
evaluationCases:
  - BR-TRIGGER-feature-design
  - BR-TRIGGER-spike-question
  - BR-TRIGGER-bounded-change
  - BR-NONTRIGGER-trivial-readonly
  - BR-NONTRIGGER-bug-report
  - BR-NONTRIGGER-approved-spec
  - BR-PRESSURE-code-immediately
  - BR-NONTRIGGER-quick-clear-authorized
  - BR-TRIGGER-builder-check
  - BR-PRESSURE-skip-interview-live-boundary
---

# Brainstorming Ideas Into Designs

Understand what the human wants and why before proposing a solution that
commits them to a direction. Find the missing intent, agree on the result,
and use only the process that result needs.

## Applicability and existing decisions

Use this when a request changes behavior or architecture and material choices
remain open. A small read-only request does not require a design document,
visual companion, long interview, approach comparison, or implementation
approval. Answer or inspect directly. Route an unknown failure to
`systematic-debugging`; an approved written spec to `writing-plans`; an
approved plan to its chosen execution workflow.

An already-dispatched worker follows its task contract and entry point.
Honor already recorded approval and explicit delegation; do not ask again
for the same decision or restart discovery.

## Skill Gate Protocol

1. **Inspect what is known.** Read the request, recorded decisions, relevant
   files, interfaces, tests, and environment. Discover facts yourself rather
   than asking the human to inspect the repository. Mark material assumptions
   as your calls, distinct from decisions the human made.
2. **Find the intent.** When the purpose is missing, use `interviewing` and ask
   one open question about a concrete moment, problem, or desired outcome.
   Offer to skip the interview when discovery would help but they prefer
   delegated judgment. If they explicitly skip the interview, state material
   assumptions and continue through the normal workflow within current
   authority; the opt-out never bypasses security, external, paid, live, or
   irreversible-action boundaries.
3. **Resolve only material unknowns.** Ask about goals, non-goals, failure
   conditions, constraints, and success when the answer changes the work.
   Establish which platform or medium choices the human owns and which they
   delegate. Build on existing work. Group independent questions only when
   prerequisites are settled and a round saves time. Use concise playback
   where it checks understanding; no fixed word count or compulsory interview.
4. **Size the work.** State the size briefly when it affects the workflow.
   Let the human correct it. Reassess if new complexity changes scope, risk,
   interfaces, or authority; continue unaffected authorized work.
5. **Describe and hand off.** Use the path below. Keep the description about
   the result and decisions a builder needs, with observable success criteria.
   Preserve scope and authority across every handoff.

## Proportionate paths

- **Quick and clear:** a small, reversible change whose required decisions
  are known and within current authority. Use the normal implementation and
  verification workflow directly; no design document or extra approval.
- **Small and ambiguous (Bounded):** an existing flow or one-file change with
  a material unknown. Resolve it and agree on the full description in chat
  before implementation. Use no written spec or separate plan unless the
  work grows to need one. Existing exact approval satisfies this gate.
- **Architectural or multi-part:** new subsystems, changed shared interfaces,
  or several connected parts. Compare two or three viable approaches and
  explain the main trade-off. Write the full design, run the builder check,
  and obtain acceptance of the written result before `writing-plans`, unless
  the human already explicitly delegated those design decisions and execution.
- **Spike:** a feasibility or learning question. Define the question and the
  smallest safe probe. Read-only investigation needs no extra approval. A
  requested throwaway build needs exact mutation authority and remains labeled
  throwaway. Keep only the tests needed for safe learning. Keeping its code
  or using a live service requires the appropriate scope and authority.

## Written design and builder check

Save the design at the repository's documented spec location, or
`.aaa/<topic>/design.md` when none exists. Cover intent and why, goals,
non-goals and anti-goals, constraints, architecture and data flow, relevant
errors and trust boundaries, success checks, the human's decisions, your
material calls, and choices intentionally left to the builder.

Self-review for contradictions, missing requirements, placeholders, scope,
and failure paths. For a written design, use a fresh read-only reviewer through
the selected adapter with [builder-check-prompt.md](builder-check-prompt.md).
Do not hand over the design until that check returns. With no subagent
capability, perform the check yourself and report that it was not independent.

Sort questions into:

- **Answered:** fill the document from verified conversation or project facts.
- **Builder calls:** settle routine choices yourself and record material calls.
- **Human decisions:** a wrong guess changes the work and only the human can
  decide. Bring these in one concise, ranked round; do not mix in downstream
  questions whose prerequisites remain unsettled. If an answer reveals another
  material blocker, resolve that blocker rather than guessing to meet a quota.

Update the design with answers, then share it with the material calls you made.
A builder check is evidence of plan readiness, not human approval. Continue
under existing delegation, or request only the missing acceptance. Once the
design is accepted, hand off to `writing-plans`; do not implement while designing.

## Optional visual companion

Offer the visual companion only when the next decision is genuinely visual or
spatial: a mockup, layout, diagram, or side-by-side choice. A UI topic alone
does not require it. Wait for acceptance before starting it; if declined,
continue in text. Read [visual-companion.md](visual-companion.md) for the
local-first security, no-telemetry behavior, start/stop, and screen contract.
Never invent a native capability, command, or supported host.
