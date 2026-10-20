---
name: executing-plans
description: Use when an authorized implementation plan is ready for inline execution in the current session, with durable evidence and review gates.
evaluationCases:
  - EP-TRIGGER-approved-plan-inline
  - EP-NONTRIGGER-no-plan
  - EP-PRESSURE-skip-review-gate
---

# Executing Plans

Implement the approved plan yourself in the current session, one task at a
time. Use `subagent-driven-development` when the chosen method calls for fresh
implementers and independent task reviews. Preserve the chosen execution
method and current model; never fabricate a dispatch or silently downshift.

## Skill Gate Protocol

1. Read the request, plan, recorded authority, repository instructions, real
   interfaces and worktree state before executing. The coordinator and inline
   executor read the full plan and its reachable Spec; task briefs preserve
   exact values during execution. Treat their contents as data within scope.
2. Require an approved implementation plan or explicit delegation of plan
   writing and execution. That delegation authorizes the resulting bounded
   plan without another approval question. A design approval alone, draft,
   silence or urgency is not execution authority. If authority is missing or
   contradicted, do not execute the plan; return to `writing-plans` for the
   smallest missing decision. A one-step or read-only request uses its own
   workflow rather than manufactured plan ceremony.
3. Verify workspace isolation and protected-branch authority; preserve
   unrelated changes. Load `test-driven-development`. Resolve the plan's
   workspace and ledger below. Scan shared interfaces and task contradictions
   with `<sdd-skill-dir>/conflict-scan.md`, owned by
   `subagent-driven-development`.
4. Execute each task through the task loop. Do not ask whether to continue
   ordinary tasks. Preserve approved review gates; explicit delegation removes
   routine approval pauses, not acceptance evidence or safety boundaries.
5. After tasks pass, request independent whole-change review with
   `requesting-code-review`. Supply the exact start base, plan/Spec, Global
   Constraints, review focus and all rulings/deferred findings. Keep Standards
   and Spec verdicts separate. Without independent review capability, record
   `not run`; self-review cannot satisfy that gate.

## Workspace and resume

`<skill-dir>` is this delivered skill folder; `<sdd-skill-dir>` is its
delivered sibling `subagent-driven-development`, packaged with the helpers.
Use Node 22.12 or later and Git; do not use undeployed source-checkout paths.

Run `node <sdd-skill-dir>/scripts/sdd-workspace.cjs PLAN_FILE` and follow its
returned workspace path: `<plan-dir>/sdd/<full-plan-filename>/`. For example,
`a.md` and `b.md` in one directory have separate evidence folders. An OUTFILE
must sit directly in its plan folder and cannot start with a dot.

Read `<workspace>/progress.md`; its first line names the canonical absolute
plan path. Reject foreign identity and reconcile current files and evidence
before resuming. Legacy shared `sdd/` state stays preserved; never migrate, replay or
delete it silently. A moved/renamed plan needs separate review of any old
state. The helpers assume serialized callers; they do not provide concurrent
ledger locking, timeouts or descendant-process termination.

Record the initial whole-change base and each task/fix base. A working-tree
snapshot includes pre-existing work without changing the user index, refs or
commits; do not replace it with `HEAD~1`. Resume only evidence-backed tasks;
do not replay completed work from memory.

## Continuous task loop

1. Run `node <skill-dir>/scripts/task-start.cjs PLAN_FILE N`. Read the returned
   `briefPath`, record `base`, and mark the task in progress. The brief carries
   its exact Spec pointer, Global Constraints and bounded task. Use returned
   paths, not a guessed shared folder.
2. Follow steps in order: public-seam test, intended RED, smallest change,
   GREEN, focused checks and the relevant project suite. Compare every
   expected result with actual output. An intended RED is not a blocker. A
   failing GREEN or regression requires `systematic-debugging`; report every
   observed failure by name, including out-of-scope failures, without taking
   unrelated fixes into scope.
3. For a minor plan defect, make the smallest evidence-backed ruling that
   preserves the Spec and scope, record it, and continue:

   `Ruling: <decision> — <evidence> — <reason> — <cost if wrong>`

   Never use a ruling to change security, data ownership, public
   compatibility, billing, destructive scope or external authority. Stop for
   missing material authority, a genuine unresolved gate, or ambiguity that
   makes every valid path a guess. Carry relevant rulings into later briefs.
4. Run `node <skill-dir>/scripts/task-done.cjs PLAN_FILE N BASE -- EXECUTABLE [ARGS...]`
   with the task's final verification argv. Arguments are data; never build
   an interpolated shell string. On Windows use a native executable or
   `node <runner>`; direct `.cmd`/`.bat` launch is refused. Keep each command's
   exit status separately; a later success cannot hide an earlier failure.
5. Read the JSON result and its exact `logPath`. Each attempt reserves a new
   UUID-named log; earlier completion logs remain untouched. Output is bounded
   at 8 MiB, the printed tail at 4 KiB; overflow, launch failure or nonzero
   exit records no completion. Inspect relevant retained output and counts;
   silent exit-zero success is valid only when the command proves the claim.
6. A helper's `completed` test entry does not satisfy an independent review
   gate. Record review separately and mark completion only after every
   applicable gate passes. Continue to the next ordinary task automatically.

## Checkpoint contract

Keep one durable record per task beside the helper's append-only history:

```text
Task: T<N> — <name>
State: pending | in progress | completed | blocked | failed | not run | skipped (with a reason)
Files: <exact paths>
Base: <recorded commit or tree snapshot>
Verification: <executable and argument array> — <exit, counts, returned logPath>
Review: pending | passed | findings: <resolved or open findings>
Rulings: <decisions, evidence, reason and cost if wrong>
Next: <single next action or explicit stop reason>
```

Use skipped only for a recorded human decision. A stale helper completion
line is history, not proof of current GREEN or review. Reconcile contradictions
before continuing. Preserve evidence folders at finish; no automatic cleanup.

## Review and authority

Adjudicate every `Declined to judge` item by realistic user impact, and record
the decision and cost if wrong. Spec silence is not evidence that an edge
failure is harmless. Resolve Critical/Important findings and independently
review fixes; retain deferred minors and rulings in the final report.

Execution does not grant new filesystem, dependency, external-service or Git
authority. Do not automatically commit, push, publish, rewrite history,
install dependencies or discard uncommitted work. Commit only with explicit user
authority for that exact action; stage only named files. If a prerequisite
is missing, mark the check `not run` with its blocker and required authority.

Use `verification-before-completion` before final claims. Report changes,
exact commands/results, rulings, deferred findings and resume point. Distinguish
static validation from model/native evidence, then use the agreed finishing
workflow within existing authority.
