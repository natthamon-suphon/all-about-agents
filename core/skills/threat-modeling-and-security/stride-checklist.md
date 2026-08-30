# Conditional STRIDE Checklist

Use STRIDE to check coverage after mapping the actual architecture. For each
category record `applicable`, `not applicable`, or `unknown`, plus architecture
evidence, abuse case, existing/proposed control, verification, control owner,
and residual risk. A category name does not itself justify a control.

## Spoofing

- Which actor or system identity can be impersonated at an entry point?
- What architecture evidence establishes identity and credential lifecycle?
- Are authenticity, replay, revocation, and confused-deputy cases applicable?

## Tampering

- Which data or control message can change across a trust boundary or store?
- Where are integrity, canonicalization, concurrency, and write authorization
  enforced in the actual data flow?

## Repudiation

- Which security-relevant actions require accountable evidence?
- Are actor, action, target, decision, time, correlation, retention, redaction,
  and audit-integrity requirements applicable?

## Information disclosure

- Which asset could reach an unauthorized actor, tenant, log, error, cache,
  backup, artifact, network destination, or model/tool context?
- Do collection, access, redaction, retention, deletion, and recovery match the
  data classification and architecture?

## Denial of service

- Which compute, memory, storage, connection, queue, dependency, or operator
  resource can an actor amplify?
- Which workload-specific bounds, timeouts, cancellation, quotas, backpressure,
  degradation, or recovery controls are applicable?

## Elevation of privilege

- Where can an actor cross a privilege or tenant boundary or influence a more
  privileged deputy?
- Are authorization decisions centralized at the correct enforcement point,
  deny by default, and tested across subject/action/resource/tenant combinations?

## Control record

For every applicable threat capture:

- architecture evidence and affected asset;
- abuse case and violated property;
- likelihood, impact, and uncertainty;
- existing control and gap;
- conditional proposed control and why it fits this architecture;
- positive, negative, failure, and recovery verification;
- control owner and due point; and
- residual risk plus acceptance owner.

If evidence is missing, mark the item `unknown`; do not silently convert it into
a universal framework, identity, database, cryptography, or infrastructure rule.

