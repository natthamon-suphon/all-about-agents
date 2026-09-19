---
name: codebase-design
description: Use when designing or restructuring a module interface, deciding where a seam belongs, or judging whether a module is too shallow or hard to test
evaluationCases:
  - CD-TRIGGER-interface-seam-decision
  - CD-NONTRIGGER-local-rename
  - CD-PRESSURE-refactor-everything
---

# Codebase Design

Design deep modules: substantial behavior behind a small interface at a clean
seam, testable through that interface. Optimize for leverage for callers,
locality for maintainers, and evidence-based proportional change.

This is a design reference, not permission to refactor. Use it when a real
interface or seam decision exists. A local rename, formatting edit, or isolated
implementation-only change is a nontrigger unless it changes what callers must
know. Never turn a narrow request into a repository-wide redesign.

## Vocabulary

Use these terms consistently:

- **Module** — anything with an interface and an implementation: a function,
  class, package, process, or tier-spanning slice.
- **Interface** — everything a caller must know to use a module correctly. It
  includes types and entry points plus invariants, ordering constraints, error
  modes, configuration, side effects, concurrency, and performance promises.
- **Implementation** — behavior hidden inside a module. It may contain private
  helpers and internal seams without exposing them to callers.
- **Depth** — leverage at an interface: useful behavior obtained per unit of
  knowledge imposed on callers and tests. It is not a line-count ratio.
- **Seam** — a place where behavior can vary without editing the caller; the
  location at which a module's interface lives.
- **Adapter** — a concrete implementation that satisfies an interface at a
  seam. The word describes its role, not its size or technology.
- **Leverage** — capability callers gain from learning a small interface once.
- **Locality** — concentration of related change, knowledge, defects, and
  verification in one module instead of across many callers.

## Skill Gate Protocol

1. **Confirm the trigger and authority.** State the interface or seam decision.
   If the request is only a local rename or implementation-only edit, keep it
   local and do not invoke an architectural redesign. Design advice does not
   authorize implementation, broad refactoring, dependency changes, or public
   compatibility breaks.
2. **Collect current evidence.** Read the real callers, tests, types, runtime
   paths, data flow, failure handling, and existing adapters. Record which facts
   are verified and which remain assumptions.
3. **Describe the current interface completely.** List entry points and every
   fact a caller must know: invariants, ordering, errors, configuration, side
   effects, concurrency, and performance characteristics. Identify the current
   seam and the behavior hidden behind it.
4. **Locate the pressure.** Show concrete duplication, knowledge spread,
   pass-through layers, testing pain, or change fan-out. Name affected callers
   and evidence; do not label a module shallow from aesthetics or file size.
5. **Compare alternatives.** For a material decision, compare at least two sound
   interface or seam placements, including keeping the current design. For each,
   state what callers learn, what the implementation hides, dependency strategy,
   error modes, compatibility cost, test surface, leverage, and locality.
6. **Choose proportional depth.** Recommend the smallest sound design that fixes
   the evidenced pressure. Prefer one stable interface over pass-through layers,
   but do not create a speculative seam. One production adapter alone is a
   hypothetical seam; a real variation such as production plus test or two
   runtime implementations can justify one.
7. **Define proof before mutation.** Name focused tests through the proposed
   interface, compatibility checks for callers, and migration or rollback needs.
   Stop for a product decision when the evidence cannot determine semantics.

## Depth checks

Use these checks together; none is a standalone score:

- **Deletion test:** if deleting the module removes complexity, it was probably
  a pass-through. If the knowledge reappears across callers, the module was
  earning locality.
- **Caller-knowledge test:** count concepts, ordering rules, error branches, and
  configuration callers must understand—not only methods or parameters.
- **Change-locality test:** trace a representative change. Prefer the design
  that concentrates the change without creating an oversized unrelated module.
- **Test-surface test:** callers and behavior tests should cross the same seam.
  Tests that must reach past the interface indicate the seam may be misplaced.
- **Variation test:** introduce an adapter only for observed variation. Do not
  add ports, factories, or generic fetchers for a hypothetical future.

## Interface design guidance

- Accept necessary dependencies instead of constructing hidden globals.
- Return meaningful results; isolate irreversible side effects behind explicit
  operations and make error modes visible.
- Prefer a few domain-shaped entry points over one generic method whose callers
  must encode dispatch rules.
- Keep internal seams private. Test helpers do not automatically belong in the
  external interface.
- Preserve compatibility unless the approved task explicitly owns migration of
  every caller.
- Measure depth by caller leverage, not implementation size or indirection.

## Dependency and alternative-design references

- For dependency categories and safe deepening, read
  [DEEPENING.md](DEEPENING.md).
- For a high-impact choice where independent alternatives are valuable, read
  [DESIGN-IT-TWICE.md](DESIGN-IT-TWICE.md).

## Decision record

Present one compact record:

1. Decision and scope.
2. Verified evidence and affected callers.
3. Current interface and seam.
4. Alternatives compared on depth, locality, compatibility, and testability.
5. Recommended smallest sound design and why.
6. Risks, assumptions, migration boundary, verification, and checks not run.

## Pressure handling

If asked to “refactor everything while you are here,” reject the expansion
unless repository-wide scope is explicitly authorized and supported by concrete
evidence. Complete the narrow interface decision first. Record broader
candidates separately; do not rename, move, merge, or rewrite unrelated modules
to make a diagram look cleaner.

## Completion checklist

- [ ] A real interface or seam decision triggered the skill.
- [ ] Current callers, behavior, failures, dependencies, and tests were inspected.
- [ ] The full caller-facing interface is described, not only its type signature.
- [ ] At least two sound alternatives were compared for a material decision.
- [ ] Depth, leverage, locality, seam placement, and adapter need are evidenced.
- [ ] The recommendation is proportional and preserves unauthorized scope.
- [ ] Verification and compatibility evidence are explicit and truthful.
