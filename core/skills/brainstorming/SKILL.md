---
name: brainstorming
description: You MUST use this before any creative work - creating features, building components, adding functionality, or modifying behavior. Explores user intent, requirements, and design before implementation.
capabilities:
  - schema-validation
references:
  - visual-companion
  - spec-document-reviewer-prompt
evaluationCases:
  - BR-TRIGGER-feature-design
  - BR-TRIGGER-spike-question
  - BR-TRIGGER-bounded-change
  - BR-NONTRIGGER-trivial-readonly
  - BR-PRESSURE-code-immediately
---

# Brainstorming Ideas Into Designs

Turn an underspecified behavior or architecture change into an agreed design
before implementation. Classify how much process the request needs, say the
classification out loud so the human partner can override it, then work
through that path.

## Applicability

Use this skill when the request changes behavior or architecture: a new
feature, component, workflow, API, data model, integration, user-visible
experience, or structural refactor. The request may be phrased as "build,"
"add," "make," or "change."

Do not invoke this skill for a trivial, bounded, read-only request such as a
status/factual answer, listing or inspecting files, a narrow review that does
not change behavior, or reporting existing test output. Complete that request
directly. A trivial request does not require a design document, visual companion, long interview, approach comparison, or implementation approval.

An already-dispatched worker follows its task contract and entry point; it does
not restart this skill's discovery flow.

## Hard gate

For a behavior or architecture change, present your intent and get approval
before the first implementation action. Until the human partner explicitly approves
the design, do not invoke an implementation skill, write or edit production
code, scaffold a project, add a dependency, or run a mutating command. A
read-only context check is allowed before the design. The ceremony scales with
the task; the approval gate never does.

## Three paths

Classify before the first question and announce the path:

- **Spike**: a feasibility question ("can we...", "is it possible...",
  "quick and dirty is fine") whose output is an answer, not code to keep.
  Present the question and what you will try in two or three sentences, get a
  nod, then find out as cheaply as correctness allows. No design document.
  Report findings as a recommendation; anything built stays labeled throwaway.
- **Bounded**: a well-scoped change to a flow that already exists in this
  repository: a new flag, a small endpoint, a one-file fix. Bounded measures
  the repository, not your familiarity; with no existing flow to change, the
  task is not bounded. Ask only the clarifying questions that matter, present a
  short design in chat (a few sentences to a few short paragraphs), and stop
  until the human partner says yes. No spec file, no plan document.
- **Architectural**: a new project, a new subsystem, or a change that
  restructures how components fit together or alters interfaces others depend
  on. Follow the full flow below: questions, approaches, sectioned design,
  written spec, then the planning skill.

When in doubt between two paths, take the heavier one. The ratchet is one-way:
hidden complexity discovered mid-task upgrades the path. Stop, say so, and step
up. Nothing downgrades mid-task.

## Design flow for the architectural path

1. Inspect the current project context: relevant files, instructions, docs,
   interfaces, and recent changes.
2. Clarify purpose, constraints, non-goals, and success criteria. Ask one question at a time and only as many questions as the decision requires.
3. Offer two or three viable approaches with trade-offs and a recommendation.
   Keep the proposal proportional to the change.
4. Present the design in sections covering architecture, components/data flow,
   error handling, and testing. Seek explicit approval before implementation.
5. Use the visual companion only when the next question is genuinely visual or spatial (mockups, layout, diagrams, or side-by-side visual choices), and offer it just in time. Never offer or require it merely because a project has a UI topic. If declined or unnecessary, stay text-only.
6. After approval, write the agreed spec to
   `.claude/all-about-agents/<topic>/design.md` (or the repository's documented
   spec location), self-review it for placeholders, contradictions, ambiguity,
   scope, invariants, and a pre-mortem, then ask the human partner to review the
   written spec.
7. Only after the written spec is accepted, transition to the implementation
   planning skill. The implementation plan owns RED/GREEN work; this skill
   does not silently turn approval into code.

## Quick reference

| Request shape | Path | Artifact | Approval gate |
|---|---|---|---|
| Feasibility question | Spike | Recommendation; throwaway code labeled | Nod before probing |
| Small change to an existing flow | Bounded | Short design in chat | Explicit yes before implementation |
| New project, subsystem, or interface change | Architectural | Written spec, then plan | Explicit yes per section and on the spec |
| Trivial bounded read-only work | None | None | None |
| Already-dispatched worker | Follow assigned contract | Per that contract | Per that contract |

## Red flags

| Thought | Reality |
|---|---|
| "This is too simple to need a design" | Simple means a short design, not no design. Two sentences in chat, then approval. |
| "I'll call it bounded and skip the spec" | Reaching for a label to skip work is the doubt. Take the heavier path. |
| "The design is obvious, I'll start while they read it" | The gate is the approval, not the design's length. Present, then stop until you hear yes. |
| "I understand this kind of app, so it's bounded" | Bounded measures the repository. A new project has no existing flow; it is architectural. |
| "The spike works, so I'll keep the code" | A spike's output is an answer. Keeping the code is a new request; classify it. |
| "It grew, but I'm almost done" | Hidden complexity upgrades the path mid-task. Stop and say so. |
| "They approved the spike, so the follow-up is approved too" | Each task gets its own classification and its own approval. |
| "Approval can happen in the pull request" | Approval comes before the first implementation action, on every path. |

## Common mistakes

- Coding "just to learn": keep discovery read-only, record the uncertainty, and
  return to the gate.
- Asking a long questionnaire: ask the smallest next question and stop when
  the design decision is clear.
- Offering a visual tab upfront: offer only for a real visual decision.
- Inventing native paths, tools, or syntax: name the unavailable capability and
  stop or ask for direction.
