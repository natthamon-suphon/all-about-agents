---
name: session-compaction-resilience
description: Use when sessions exceed 30+ turns, before running multi-task plans, or when preparing for context window compaction - persists working state to disk to prevent context amnesia
---

# Session Compaction Resilience

## Overview

Conversation context memory in AI harnesses does not survive context window compaction. In long sessions or autonomous runs, controllers that lose transient memory repeat completed tasks, overwrite progress, or lose vital design decisions.

**Core principle:** Memory on disk survives; memory in context window rots.

**The Iron Law:**
```
PERSIST DECISIONS, TASK STATE, AND HYPOTHESES TO DISK BEFORE EXCEEDING CONTEXT THRESHOLDS
```

## The State Persistence Protocol

When working on complex, multi-step, or long-running tasks:

### 1. Maintain a Dedicated Progress Ledger
Always maintain `<topic-dir>/progress.md` or `.sdd/progress.md`:
- First line MUST be the plan identity: `# SDD ledger — plan: <plan_path>`
- Record every task completion: `Task <N>: complete (commits <base>..<head>, review clean)`
- Record fix rounds and parked findings: `Task <N>: fix round <R>/5 ...`
- Record out-of-scope and deferred items explicitly.

### 2. Create Periodic State Snapshots (`SNAPSHOT.md`)
Before context reaches high utilization (or every 25 turns in long workflows), create or update `<topic-dir>/SNAPSHOT.md`:

```markdown
# Session State Snapshot — [Topic Name]
**Timestamp:** [ISO-8601]
**Current Goal:** [One sentence on active objective]

## Active Phase & Current Task
- Current Task: Task N (e.g. Task 3: In-memory cache implementation)
- Status: IN_PROGRESS / FIX_ROUND_2

## Key Decisions Made (Immutable)
1. Used Redis streams for event broadcasting (decided in brainstorm session)
2. Retained backward compatibility on /api/v1/users endpoint

## Verified Milestones & Commits
- Task 1: Complete (`a1b2c3d`)
- Task 2: Complete (`e4f5a6b`)

## Blockers & Open Questions
- None. Downstream tasks 4-6 pending Task 3 completion.

## Next Concrete Step
- Execute Step 4 of Task 3: Verify GREEN on `tests/cache.test.ts`.
```

### 3. Recovery After Compaction
If compaction occurs and the controller's memory resets:
1. Do NOT guess what was done.
2. Read `<topic-dir>/SNAPSHOT.md` and `<topic-dir>/progress.md`.
3. Check `git log -n 10 --oneline` and `git status` to reconcile disk state with repository commits.
4. Resume execution at the exact pending task without re-running completed tasks.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "I'll remember where we were in the chat" | Compaction truncates chat history unpredictably. Disk state is immutable. |
| "Writing a snapshot file takes too many tokens" | Re-running a completed task or debugging lost state burns 20x more tokens. |
| "The todo list is sufficient" | Todos lack architectural decisions, verified SHAs, and test evidence. |
