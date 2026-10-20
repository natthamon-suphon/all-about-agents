---
name: writing-plans
description: Use when an explicitly approved design or specification defines a multi-step implementation that needs an executable plan before code changes begin.
evaluationCases:
  - WP-TRIGGER-approved-multistep-spec
  - WP-NONTRIGGER-unapproved-design
  - WP-PRESSURE-auto-commit
  - WP-TRIGGER-delegated-execution
  - WP-PRESSURE-program-transcript
---

# Writing Plans

Turn an approved design or specification into decisions an implementer cannot
recover from the repository alone. Assume they can write idiomatic code once
they know the exact files, interfaces, spec values, and independent assertions.
Keep the plan unambiguous without transcribing the program.

## Skill Gate Protocol

1. Inspect the request, approved spec, recorded approval or explicit delegated
   design authority, repository instructions, existing interfaces, and working
   tree before writing the implementation plan. Preserve uncommitted work.
2. If design approval or delegated authority is missing or contradicted, do
   not write the implementation plan. Return to `brainstorming` for only the
   missing design decision. A draft, silence, or urgency is not approval.
3. Confirm this is multi-step work. A quick, clear reversible change within
   current authority uses the normal implementation workflow without a plan
   document or extra approval. Split genuinely independent projects into
   separate plans whose deliverables work independently.
4. Map exact file paths and responsibilities first. Extend the responsible
   existing layer; use focused modules without speculative scaffolding or
   unrelated restructuring. Include the spec pointer and project-wide
   constraints once, then exact task dependencies and consumed/produced
   interfaces where each worker needs them.
5. Make each task a vertical slice with its own observable deliverable and
   meaningful review boundary. Fold setup, documentation, and configuration
   into the slice that needs them. Each task names the focused test command
   and the expected RED/GREEN result that the executor records as verification
   evidence. Planning runs no tests and writes no implementation.
6. Write the complete plan, self-review it against the spec, and fix gaps
   before handoff. Save at the spec's or repository's documented plan location;
   if neither supplies one, resolve the destination before writing. Use the
   execution handoff below; planning never silently becomes execution.

## Plan contract

Start with this structure; replace placeholders with concrete decisions from
the approved spec and real repository:

```markdown
# Feature Implementation Plan

**Goal:** One observable outcome.
**Architecture:** Responsible components and their data flow.
**Technology constraints:** Existing stack, runtime floors and dependencies.
**Spec:** exact/path/to/approved-design.md
**Scope and authority:** Invariants, non-goals, preconditions and allowed actions.
**Pre-mortem:** Likely failure and the check that catches it.
**Execution method:** The recorded inline or subagent-driven decision, or pending.

## Global Constraints

The exact values copied verbatim from the spec, one requirement per line.
All tasks inherit these requirements. The coordinator and inline executor
read the full plan. A dispatched worker receives a scoped brief with the exact
Spec pointer and applicable Global Constraints. The worker opens only relevant
linked sections as needed. Preserve required native inherited context.

## Review Focus

Rank realistic input classes and failure modes easy to miss, up to five.
For each, name the expected behavior and its owning task/test.
An empty list records that this review found none.

## File map

- exact/path.ext: one responsibility.

### Task N: Observable deliverable

**Files:**
- Create or modify: exact/path.ext and relevant symbol.
- Test: exact/test/path.ext.

**Dependencies:** Earlier task IDs whose outputs this task consumes, or none.
**Interfaces:**
- Consumes: exact signature, parameters and return types from the owning task.
- Produces: exact signature, parameters and return types, errors and authority assumptions.

- [ ] Write the named failing test with independently derived assertions and exact spec values.
- [ ] Run the exact focused test command; expected: FAIL for the missing behavior.
- [ ] Implement the exact signature in the owning file using the named decision.
- [ ] Run the exact command; expected: PASS for the named assertions.
- [ ] Run the named relevant regression/error/security check and record its expected result.
```

A test step contains the test name and concrete assertions independent of the
implementation, with literal expected values; include assertion code when it
makes the contract precise. Keep one behavior per test at the public seam.
A code step names the exact signature, owning file, spec values and decision
the implementer cannot make alone. Include a body only when a particular
algorithm or exact copy is itself the decision. A verification step gives the
command and output that means it passed. Reference another task's Interfaces
block instead of copying that task's implementation.

Review Focus is coverage work: add a check for every listed condition to its
owning task. Never leave a listed risk with only a reassuring sentence.

## Self-review

Check against the spec after the complete plan is written:

- **Coverage:** every requirement maps to a task, including failure behavior,
  authority, compatibility, and exact spec values.
- **Buildability:** steps settle one real decision each; remove placeholders
  such as `TBD`, `TODO`, “handle edge cases,” or unnamed tests and commands.
- **Consistency:** exact interfaces, property names, dependency edges, and
  task ownership agree across producers and consumers.
- **Review Focus:** each input class has an owning test, including reasonable
  malformed, absent, conflicting, and boundary inputs where relevant.
- **Proportion:** replace redundant bodies with signatures, assertions, and
  decisions; retain an algorithm only when the interface and tests leave a
  material choice. Compare plan length with spec and implementation complexity.

This is the author's self-review, not a compulsory independent document gate.
Preserve any independent review explicitly required by the task contract.

## Authority and execution handoff

The plan grants no new authority. Include a commit only when explicit user
authority covers that exact Git action. Keep installation, live config,
external actions, push, history rewrite, and discard outside the plan unless
separately authorized with exact targets. Keep emergency denies unchanged.

Link the saved plan and state the next workflow. If the human already supplied
an execution method, preserve it. If they explicitly delegated plan writing
and execution, do not ask for plan approval again; finish planning and then
hand off under that delegation. Otherwise request only the missing review or
execution decision, without reopening settled design choices.

When no method is selected, explain both and recommend one from task coupling,
risk, and available native capabilities:

- **Inline:** `executing-plans`; this session implements tasks in order with
  independent review at the end, where available.
- **Subagent-driven:** `subagent-driven-development`; fresh bounded workers
  and task reviews, followed by final branch review. Verify native capability
  through the selected adapter; report unavailability without inventing it.
