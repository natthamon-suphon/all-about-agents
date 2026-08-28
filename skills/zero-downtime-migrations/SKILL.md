---
name: zero-downtime-migrations
description: Use when changing database schemas, data models, event payloads, or storage contracts - ensures safe deployment with backward compatibility and zero downtime
---

# Zero-Downtime Migrations

## Overview

Database and data contract changes must never break running instances during rolling deployments. Always separate schema changes from application logic changes using the **Expand/Contract (Parallel Run)** pattern.

**Core principle:** Old code must work with the new database schema, and new code must work with the old database schema.

**The Iron Law:**
```
NEVER RENAME OR DROP A COLUMN IN A SINGLE DEPLOYMENT STEP
```

## The Expand/Contract Pattern

A zero-downtime migration spans multiple distinct deployment phases:

```
Phase 1: EXPAND          Phase 2: DUAL-WRITE      Phase 3: MIGRATE DATA    Phase 4: READ NEW        Phase 5: CONTRACT
┌──────────────┐         ┌──────────────┐         ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│ Add new col  │         │ App writes   │         │ Backfill old │         │ App reads    │         │ Drop old col │
│ as nullable  │ ──────> │ to BOTH cols │ ──────> │ data to new  │ ──────> │ from new col │ ──────> │ and clean up │
│ in database  │         │ (reads old)  │         │ column       │         │ (writes new) │         │ code         │
└──────────────┘         └──────────────┘         └──────────────┘         └──────────────┘         └──────────────┘
```

## Step-by-Step Workflow

### Step 1: Expand (Additive Schema Change)
1. Add the new column, table, or index.
2. **Rule:** New columns MUST be nullable or have a database-level default value. Adding a `NOT NULL` column without a default locks tables and fails existing insert queries.
3. Run migration in production. Old application code continues to function undisturbed.

### Step 2: Dual-Writing & Serialization
1. Update application code to write to both the old field and the new field simultaneously.
2. Continue reading from the old field (the single source of truth for reads during this step).
3. Verify that tests pass with both old and new schema variants.
4. Deploy application update.

### Step 3: Backfill Historical Data
1. Write an idempotent background migration script to backfill existing records from the old column to the new column in small batches (e.g. 500–1000 rows per batch with throttling).
2. Verify row counts and checksum parity between old and new columns.

### Step 4: Switch Reads to New Field
1. Update application code to read from the new field.
2. Continue writing to the new field (and optionally still write to the old field if a rollback window is needed).
3. Deploy application update and monitor error rates and latency.

### Step 5: Contract (Clean Up)
1. Stop writing to the old field in application code. Deploy.
2. Once verified that no application version references the old column, create and run a final database migration to drop the old column/table.

## Checklist for Safe Migrations

- [ ] All new columns are `NULLABLE` or carry safe default values
- [ ] Large table indexes are created concurrently (`CREATE INDEX CONCURRENTLY` in Postgres)
- [ ] Foreign keys on large tables are added with `NOT VALID` first, then validated in a second transaction
- [ ] Migration has a tested rollback script (`down` migration)
- [ ] Backfill is batched and throttled to prevent database CPU/IO saturation

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "The table is small, we can rename directly" | Small tables grow fast. Production lock timeouts cause 500 errors. Always expand/contract. |
| "Nobody uses the old field anymore" | Rolling deployments mean old and new app versions run concurrently for minutes or hours. |
| "A single big UPDATE query is faster than batching" | A single big UPDATE locks the entire table and starves connection pools. Batching is mandatory. |
