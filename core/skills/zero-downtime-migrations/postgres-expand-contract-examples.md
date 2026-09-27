# Conditional PostgreSQL Expand/Contract Examples

These are planning patterns, not copy-paste production commands. First verify
the PostgreSQL major/minor version, managed-service restrictions, table/index
size, partitions, traffic shape, transaction and lock behavior, replication or
logical decoding, connection pools, statement timeouts, migration tooling, and
recovery process. Confirm current behavior in authoritative PostgreSQL and
provider documentation for that deployment.

Each section ends with a placeholder sketch. Replace placeholders such as
`<table>`, `<column>`, `<index>`, `<predicate>`, `<measured_chunk_condition>`,
and `<observed_gate>` with verified project values. Derive all pacing,
concurrency, timeout, retry, and observation values from safe representative
measurements and production evidence; never promote an example value into a
universal default.

## Add and backfill a new representation

1. Expand with a compatible column or related table whose initial state old
   application versions can tolerate. Verify whether the proposed DDL rewrites
   the table, scans existing rows, or takes a conflicting lock on the exact
   PostgreSQL version.
2. Deploy code that can safely read the old state and, when required, write or
   derive the new representation. If dual writing, define idempotency,
   ordering, retry, reconciliation, and a disable switch.
3. Backfill a measured slice selected by a stable key or durable cursor. Commit
   and checkpoint according to observed lock duration, WAL volume, latency,
   resource headroom, replica/CDC lag, autovacuum interaction, and traffic—not a
   fixed batch size. Pause when an observed gate is crossed.
4. Revisit rows that changed concurrently and verify domain invariants, not only
   row counts. Make resume safe after process or transaction failure.
5. Cut reads over progressively, observe both correctness and service health,
   then enforce a new constraint only through the version-appropriate validation
   sequence verified for this topology.
6. Contract the old representation only after dependency search, rollout/rollback
   window, replica/consumer proof, and explicit destructive authority.

```sql
-- Expand: first confirm that this statement neither rewrites <table> nor holds
-- a conflicting lock for long on this exact version.
ALTER TABLE <table> ADD COLUMN <new_column> <type> NULL;

-- Backfill one measured slice, record <cursor>, and stop at <observed_gate>.
UPDATE <table>
SET <new_column> = <derived_value>
WHERE <measured_chunk_condition>
  AND <not_migrated_predicate>;
```

## Add or replace an index

- Inspect existing queries, indexes, invalid artifacts, disk/WAL headroom,
  replicas, and transaction age.
- Choose regular or concurrent/online-capable index creation only after verifying
  version-specific transaction restrictions, lock phases, uniqueness failure,
  cancellation cleanup, and migration-runner behavior.
- Observe progress, blocking, latency, disk/WAL, replicas, and application errors.
  Define the pause/cancel decision and the cleanup/resume procedure beforehand.
- Validate query behavior with representative plans and workload evidence. Drop
  the superseded index later, as a separate authorized contract step.

```sql
-- Concurrent build: use only after the transaction-block, lock-phase, and
-- failure-cleanup rules for this version and migration runner are verified.
CREATE INDEX CONCURRENTLY <index> ON <table> (<column>);

-- Contract step, later and separately authorized.
DROP INDEX CONCURRENTLY <old_index>;
```

## Tighten a constraint

- Find and remediate violating rows while writes continue, with an explicit race
  strategy.
- When supported by the verified PostgreSQL version, separate declaration from
  validation to reduce the risk of one large blocking operation; inspect the
  actual lock and scan behavior first.
- Enforce compatible application behavior before relying on the database
  constraint, validate invariants, then remove transitional code only after the
  observation window.

```sql
-- Declare without checking existing rows, then validate as a separate step,
-- only when this version supports that split for this constraint type.
ALTER TABLE <table> ADD CONSTRAINT <constraint> CHECK (<predicate>) NOT VALID;
ALTER TABLE <table> VALIDATE CONSTRAINT <constraint>;
```

## Type or key transition

Prefer a new compatible representation plus controlled synchronization,
backfill, reconciliation, read cutover, and later contraction when an in-place
change could rewrite data, block traffic, change semantics, or exceed recovery
objectives. Verify casting, collation/time-zone/precision semantics, foreign-key
dependencies, generated values, sequences, partitions, and replication/CDC.

```sql
-- New representation next to the old one; old readers keep working.
ALTER TABLE <table> ADD COLUMN <new_column> <new_type> NULL;

-- After synchronized writes and the backfill, reconcile before read cutover.
SELECT count(*) FROM <table>
WHERE <new_column> IS DISTINCT FROM <converted_old_column>;
```

## Recovery evidence

Before any live phase, demonstrate the relevant path on a safe target:

- stop and resume the backfill without duplication or omission;
- disable the new application path while old schema compatibility remains;
- reconcile writes made during transition;
- use a forward repair for partially migrated data;
- identify invalid or partial index/constraint artifacts and their cleanup; and
- invoke the established backup/restore or failover process only with its own
  explicit authority and tested runbook.

```sql
-- After a stop and resume, no row in the finished range is left unmigrated.
SELECT count(*) FROM <table>
WHERE <completed_range_condition> AND <not_migrated_predicate>;

-- Invalid index artifacts left by a failed or cancelled concurrent build.
SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
```

Record commands, sanitized outputs, measurements, owners, residual risks, and
all `not run` checks. Treat every sketch as a placeholder until the version and
deployment evidence confirm its syntax and lock behavior.
