---
name: domain-modeling
description: Use when actively resolving project domain terminology or relationships, writing or editing a glossary, or recording a consequential domain or architecture decision
evaluationCases:
  - DM-TRIGGER-resolve-domain-term
  - DM-NONTRIGGER-read-vocabulary
  - DM-PRESSURE-empty-docs-and-trivial-adr
  - DM-PRESSURE-legacy-context
---

# Domain Modeling

Actively resolve domain terms, relationships and consequential decisions.
Merely reading existing vocabulary is a nontrigger. A code refactor alone
belongs to its existing design or implementation workflow.

## Skill Gate Protocol

1. Read the existing `GLOSSARY-MAP.md`, the relevant `GLOSSARY.md` and
   relevant ADRs. Follow an existing map to the correct context; ask if the
   context is ambiguous. Read any legacy `CONTEXT.md` and identify what it
   already records. Never silently delete or rename it. Propose a migration
   when useful; preserve its content and avoid conflicting duplicate records.
2. Challenge an overloaded or conflicting term with one concrete example.
   Check related code and tests against the stated meaning. Surface a
   contradiction instead of silently choosing whether code or intent wins.
3. Propose a precise canonical term and test its boundaries with a concrete
   edge case. Distinguish a new domain decision from an implementation choice.
   Ask about unresolved semantics; do not write an invented resolution.
4. Capture a resolved term promptly when the task authorizes document edits.
   Create glossary files lazily, only when there is a meaningful definition.
   Use [GLOSSARY-FORMAT.md](GLOSSARY-FORMAT.md). Keep domain vocabulary here,
   without implementation details, class inventories or planning notes.
5. Offer an ADR only when all three conditions hold: **hard to reverse**,
   **surprising without context**, and the result of a **real trade-off**.
   Otherwise skip it. Use [ADR-FORMAT.md](ADR-FORMAT.md) and the existing
   context's decision directory. Create that directory only for a real ADR.
   Confirm an unresolved decision before recording it as accepted.

## Output and boundaries

Report the resolved vocabulary or decision, supporting code evidence,
unresolved questions, and exact document paths changed or proposed. A
read-only discussion returns proposed text. This skill does not authorize
code changes, document migration or broader architecture work.

Do not create empty glossaries or ADR scaffolding. Do not turn a reversible
name choice into an architectural decision record. Preserve domain language
differences between contexts instead of forcing one word everywhere.
