---
name: zero-downtime-migrations
description: Use when changing a live or long-lived database schema, stored data, index, constraint, or application/data contract while old and new application versions may overlap
evaluationCases:
  - ZM-TRIGGER-live-schema-migration
  - ZM-NONTRIGGER-local-throwaway-db
  - ZM-PRESSURE-postgres-universal
---

# Zero-Downtime Migrations

Design a staged compatibility transition for the system that actually exists.
`Expand -> migrate -> contract` is a portable principle, not a promise that one
DDL statement, batch size, isolation level, online-index option, or down
migration is safe on every database, version, topology, or workload.

A schema reset used only by one developer in an explicitly disposable local
database is a nontrigger unless the task also changes a shared migration,
release workflow, production-like fixture, or compatibility contract.

## Skill Gate Protocol

1. **Confirm scope and authority.** Identify environments, owners, deployment
   path, maintenance/SLO constraints, and allowed read/write checks. Planning a
   migration does not authorize production DDL, data mutation, traffic changes,
   failover, deployment, backup/restore, or destructive cleanup.
2. **Map the real system.** Verify database product and version, schema and
   constraints, table/index size, query and write paths, old/new application
   versions, deploy ordering, connection/pooling behavior, replication/CDC,
   background jobs, caches, dependent consumers, and recovery facilities. Mark
   assumptions and unavailable evidence.
3. **State invariants and compatibility.** Define data correctness, uniqueness,
   authorization/tenant isolation, availability, latency, replication lag, and
   recovery expectations. Build a matrix for every application version that may
   run against the old, expanded, migrated, and contracted states.
4. **Define gates before actions.** For each phase name entry conditions,
   observable success, pause/abort signals, owner, and a tested recovery path.
   Derive numeric thresholds from representative measurements and the service's
   error budget; do not invent universal values.
5. **Expand compatibly.** Prefer additive, nullable or otherwise backward-
   compatible structures and code paths when supported by verified vendor
   behavior. Separate potentially blocking validation/index work when the
   actual engine permits it. Keep old readers and writers safe.
6. **Deploy compatible code.** Introduce tolerant reads and controlled writes.
   If dual writes are necessary, define ordering, retries, idempotency,
   reconciliation, partial-failure handling, and a disable path; do not assume
   two writes are atomic across boundaries.
7. **Migrate data safely.** Make backfill work bounded, resumable, idempotent,
   observable, and rate-adjustable. Derive chunking, concurrency, pacing, and
   transaction scope from measurements of locks, latency, resource use,
   replication lag, and business traffic. Preserve a durable cursor or proof of
   completion and handle rows changed during the backfill.
8. **Verify and cut over.** Compare counts plus domain invariants, sample or
   reconcile values, observe old/new read paths, and test failure recovery. Use
   progressive rollout where available. Keep the old path until measured
   acceptance criteria and the observation window pass.
9. **Contract deliberately.** Prove no supported reader, writer, job, replica,
   integration, or rollback target requires the old contract. Obtain explicit
   destructive-change authority, then remove obsolete code/data in separately
   observable steps with a named owner.
10. **Record evidence and residual risk.** Capture commands and outputs without
    secrets, phase decisions, owners, not-run checks, rollback readiness, open
    assumptions, and the next safe action.

## Phase plan

For each phase record:

| Phase | Compatibility state | Action | Entry evidence | Signals and gates | Recovery | Owner |
|---|---|---|---|---|---|---|
| Expand | Old and new code safe | Add compatible structure/capability | Verified engine and dependency behavior | Lock/runtime/error/lag bounds | Stop or revert compatible app/config change | Named owner |
| Migrate | Both representations coexist | Deploy, backfill, reconcile, cut over | Idempotency and recovery tested | Correctness plus service health | Pause; disable new path; resume or forward repair | Named owner |
| Contract | Only new contract is supported | Remove old path/data | Observation window and dependency proof | Post-change correctness and health | Forward-fix or restore through tested recovery path | Named owner |

Replace every generic cell with project evidence. An unverified cell is a
blocker or explicit risk, not an invitation to guess.

## Recovery model

Separate recovery paths by failure type:

- application/config rollback can return traffic to a still-compatible old path;
- a paused/resumed idempotent backfill handles transient workload failures;
- reconciliation and a forward-fix or forward repair correct partially migrated
  or newly written data;
- database recovery or restore follows an existing, tested operational process;
- destructive schema/data contraction may be irreversible and therefore needs
  stronger proof and explicit authority before execution.

Do not require a destructive down migration. Reversing DDL can lose new writes,
reintroduce invalid states, or be slower/riskier than rolling forward. Prove the
chosen recovery path against the actual failure modes.

## Vendor-specific behavior

Before prescribing syntax or an online/concurrent operation, verify the engine,
version, deployment topology, lock semantics, transaction behavior, replication
effects, cancellation behavior, and current authoritative documentation.
PostgreSQL-oriented examples live in
[postgres-expand-contract-examples.md](postgres-expand-contract-examples.md)
and remain placeholders until those facts are known.

## Verification

Prefer a representative disposable or staging target before any live action.
Verify compatibility matrices, migration ordering, idempotent resume,
concurrent-write handling, reconciliation, pause/abort behavior, observability,
and recovery. A successful command is not enough: observe locks, application
errors, latency, resource pressure, replication/CDC health, and invariant checks.
Report every unavailable or unauthorized check as `not run`.

## Pressure handling

Reject demands for one PostgreSQL recipe, fixed chunk size, universal isolation
level, unconditional online-index syntax, mandatory dual writes, or automatic
down migrations. Ask for version/topology/workload evidence, measure on a safe
representative target, and make the decision conditional.

## Completion checklist

- [ ] Scope, authority, owners, topology, dependencies, and deploy overlap are known.
- [ ] Old/new application and schema compatibility states are explicit.
- [ ] Invariants and measured phase gates precede mutation.
- [ ] Backfill is bounded, resumable, idempotent, observable, and reconciled.
- [ ] Pause, rollback, forward-repair, and recovery paths match real failures.
- [ ] Contract waits for dependency proof, observation, and destructive authority.
- [ ] Evidence, residual risk, assumptions, and not-run checks are recorded.
