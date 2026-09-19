---
name: threat-modeling-and-security
description: Use when a change affects authentication, authorization, trust boundaries, sensitive assets, external input, execution, data isolation, availability, or other security-relevant behavior
evaluationCases:
  - TM-TRIGGER-security-boundary-change
  - TM-NONTRIGGER-cosmetic-change
  - TM-PRESSURE-stack-absolutism
---

# Threat Modeling and Security

Model the actual system before selecting controls. Portable security principles
apply across stacks; concrete framework, database, identity, cryptography, and
infrastructure recipes require verified architecture and current authoritative
documentation.

A cosmetic change that does not affect data, behavior, parsing, rendering,
execution, dependencies, permissions, or a trust boundary is a nontrigger.

## Skill Gate Protocol

1. **Confirm scope and authority.** Identify the proposed change, deployment
   context, security objective, and allowed inspection/testing. A threat model
   does not authorize exploitation, destructive testing, production probing,
   secret access, data mutation, dependency changes, or deployment.
2. **Map the architecture.** Record actors, assets, entry points, data flows,
   processes and stores, external dependencies, privilege levels, and every trust
   boundary crossed. Mark verified facts, assumptions, and unavailable evidence.
3. **State security properties.** Define confidentiality, integrity,
   availability, authenticity, authorization, isolation, accountability,
   privacy, and recovery expectations that are applicable to these assets.
4. **Enumerate abuse cases.** Describe attacker capability, precondition, action,
   affected asset, violated property, and observable impact. Use STRIDE from
   [stride-checklist.md](stride-checklist.md) as a coverage lens, not a mandate
   to invent threats that the architecture cannot support.
5. **Prioritize with evidence.** Rate likelihood and impact using the project's
   risk method, state uncertainty, and identify existing controls. Do not assign
   precise probabilities without data.
6. **Select conditional controls.** Tie each proposed control to one abuse case,
   trust boundary, and verified technology constraint. Prefer least privilege,
   deny-by-default authorization, explicit input constraints, safe output
   encoding, resource bounds, isolation, secret minimization, and auditable
   decisions when applicable. Do not prescribe a product or algorithm merely
   because it is familiar.
7. **Define verification.** Name negative/positive tests, authorization and tenant
   matrices, malformed/oversized input cases, failure modes, logging/redaction,
   dependency/configuration review, and recovery checks. Use safe disposable
   targets.
8. **Assign ownership and residual risk.** For every accepted control identify a
   control owner, implementation boundary, evidence, and follow-up. Record
   residual risk, acceptance owner, expiration/review point, and blockers.

## Portable control questions

- Identity: how is an actor authenticated at this trust boundary, and how is
  credential/token lifecycle handled by the actual identity architecture?
- Authorization: which subject may perform which action on which resource and
  tenant, and where is that decision enforced server-side?
- Input and output: what syntax, size, semantics, canonicalization, and context-
  specific encoding are required before data crosses a sensitive sink?
- Secrets and privacy: can collection be reduced, access narrowed, storage and
  logs redacted, rotation supported, and retention/deletion enforced?
- Execution: can untrusted values reach interpreters, queries, templates, file
  paths, network destinations, deserializers, or plugin/tool invocation?
- Availability: which resources are attacker-amplifiable, and what quotas,
  timeouts, backpressure, cancellation, pagination, or circuit behavior applies?
- Integrity and concurrency: what replay, duplicate, race, ordering, or partial-
  failure conditions can violate an invariant?
- Audit and recovery: which security decisions need tamper-resistant evidence,
  alerting, revocation, rollback, or incident recovery?

## Stack-specific controls

Before naming a framework/database control, verify the product, version,
deployment mode, threat, and authoritative guidance. Phrase the result as:

> Because verified architecture fact X enables abuse case Y, apply control Z at
> boundary Q; verify it with test E. If X is false, mark the control not applicable.

Never require one token format, password algorithm, isolation level, rate-limit
store, validation library, or encryption product across every architecture.
Cryptographic choices require current platform guidance and review.

## Output

Provide:

1. Scope, architecture, actors, assets, trust boundaries, and data flows.
2. Ranked abuse cases with likelihood, impact, evidence, and uncertainty.
3. Existing and proposed controls mapped to threats and architecture facts.
4. Verification plan and results, including explicit `not run` checks.
5. Control owner, residual risk, risk-acceptance owner, and follow-ups.

## Pressure handling

If asked to mandate a preferred stack everywhere, reject the absolutism. Confirm
the architecture and threat first. A control without an applicable boundary or
abuse case adds complexity and may create new risk; mark it not applicable or
unverified rather than claiming universal security.

## Completion checklist

- [ ] Actors, assets, entry points, data flows, and trust boundaries are mapped.
- [ ] Abuse cases connect attacker capability to concrete impact.
- [ ] Likelihood and impact state evidence and uncertainty.
- [ ] Controls are conditional on the actual architecture and least privilege.
- [ ] Verification is safe, scoped, and truthful about not-run checks.
- [ ] Every control and residual risk has an owner.
