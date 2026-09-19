# Design It Twice

Use this reference for a high-impact interface decision after the problem and
constraints are evidenced. The goal is to compare radically different designs,
not to create several cosmetic variations of the first idea.

## 1. Frame one self-contained brief

Record:

- current callers and behavior;
- invariants, ordering, error modes, compatibility, and performance constraints;
- the current seam and implementation hidden behind it;
- dependency categories from [DEEPENING.md](DEEPENING.md);
- observed design pressure and explicit non-goals; and
- files or interfaces in scope plus mutation authority.

## 2. Produce independent alternatives

When parallel subagents are available and authorized, give each the same brief
and vocabulary but a different constraint. Otherwise, design the alternatives
sequentially and keep their reasoning independent.

Produce at least three radically different interfaces for a consequential
decision:

1. minimum interface—one to three entry points with maximum leverage;
2. common-caller interface—the default path is trivial and safe; and
3. variation-first interface—real adapters and failure modes are explicit.

Each design must include:

- entry points and types;
- invariants, ordering, error modes, and side effects;
- caller example;
- implementation hidden behind the seam;
- dependency and adapter strategy;
- migration and compatibility cost; and
- weaknesses and conditions under which the design should be rejected.

## 3. Compare before choosing

Compare designs on:

- **depth**: behavior delivered per unit of caller knowledge;
- **locality**: where representative changes and defects concentrate;
- **seam placement**: whether variation occurs at that location;
- testability through the same interface callers use;
- compatibility and migration risk; and
- proportionality to verified pressure.

Recommend one design, or a justified hybrid, rather than returning an unranked
menu. Keeping the current design is a valid winner when alternatives add only
speculative abstraction.

## 4. Preserve the decision boundary

The comparison produces a recommendation, not implementation authority. Do not
refactor, add dependencies, or change public compatibility until the active
request owns those mutations. Record verification needs.
