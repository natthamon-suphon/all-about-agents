# Building a Feedback Loop

**Load this reference when:** starting Phase 1 on any bug you cannot already reproduce with one command.

## Why this is the whole game

If you have a **tight** pass/fail signal for the bug — one that goes red on *this* bug — you will find the cause. Bisection, hypothesis-testing, and instrumentation all just consume that signal. If you don't have one, no amount of staring at code will save you.

Spend disproportionate effort here. **Be aggressive. Be creative. Refuse to give up.**

Build the right feedback loop, and the bug is 90% fixed.

## Ways to construct one

Try them in roughly this order — cheapest and tightest first.

1. **Failing test** at whatever seam reaches the bug — unit, integration, e2e.
2. **Curl / HTTP script** against a running dev server.
3. **CLI invocation** with a fixture input, diffing stdout against a known-good snapshot.
4. **Headless browser script** (Playwright / Puppeteer) — drives the UI, asserts on DOM/console/network.
5. **Replay a captured trace.** Save a real network request / payload / event log to disk; replay it through the code path in isolation.
6. **Throwaway harness.** Spin up a minimal subset of the system (one service, mocked deps) that exercises the bug code path with a single function call.
7. **Property / fuzz loop.** If the bug is "sometimes wrong output", run 1000 random inputs and look for the failure mode.
8. **Bisection harness.** If the bug appeared between two known states (commit, dataset, version), automate "boot at state X, check, repeat" so you can `git bisect run` it.
9. **Differential loop.** Run the same input through old-version vs new-version (or two configs) and diff outputs.
10. **Human-in-the-loop bash script.** Last resort. If a human must click, drive *them* with [`scripts/hitl-loop.template.sh`](scripts/hitl-loop.template.sh) so the loop is still structured. Captured output feeds back to you.

## Tighten the loop

Treat the loop as a product. Once you have *a* loop, **tighten** it:

- Can I make it faster? (Cache setup, skip unrelated init, narrow the test scope.)
- Can I make the signal sharper? (Assert on the specific symptom, not "didn't crash".)
- Can I make it more deterministic? (Pin time, seed RNG, isolate filesystem, freeze network.)

A 30-second flaky loop is barely better than no loop; a 2-second deterministic one is tight — a debugging superpower.

## Non-deterministic bugs

The goal is not a clean repro but a **higher reproduction rate**. Loop the trigger 100×, parallelise, add stress, narrow timing windows, inject sleeps. A 50%-flake bug is debuggable; 1% is not — keep raising the rate until it's debuggable.

For flakiness caused by test pollution rather than the code under test, use [`find-polluter.sh`](find-polluter.sh). For arbitrary timeouts masking a race, see [condition-based-waiting.md](condition-based-waiting.md).

## Completion criterion - a tight loop that goes red

Phase 1 is not done until you can name **one command** — a script path, a test invocation, a curl — that you have **already run at least once** (show the invocation and its output), and that is:

- [ ] **Red-capable** — it drives the actual bug code path and asserts the **exact symptom your human partner described**, so it can go red on this bug and green once fixed. Not "runs without erroring" — it must be able to *catch this specific bug*.
- [ ] **Deterministic** — same verdict every run (flaky bugs: a pinned, high reproduction rate, per above).
- [ ] **Fast** — seconds, not minutes.
- [ ] **Agent-runnable** — you can run it unattended; a human enters the loop only via `scripts/hitl-loop.template.sh`.

If you catch yourself reading code to build a theory before this command exists, **stop — jumping straight to a hypothesis is the exact failure this skill prevents.** No red-capable command, no hypotheses.

## Minimise before hypothesising

Once the loop is red, shrink the repro to the **smallest scenario that still goes red**. Cut inputs, callers, config, data, and steps **one at a time**, re-running the loop after each cut — keep only what's load-bearing for the failure.

Why bother: a minimal repro shrinks the hypothesis space (fewer moving parts left to suspect) and becomes the clean regression test in Phase 4.

Done when **every remaining element is load-bearing** — removing any one of them makes the loop go green.

## When you genuinely cannot build a loop

Stop and say so explicitly. List what you tried. Ask your human partner for one of:

- access to whatever environment reproduces it,
- a redacted captured artifact (HAR file, log dump, core dump, screen recording with timestamps), or
- permission to add temporary production instrumentation.

Do **not** proceed to hypothesise without a loop.

## Redaction

This process has you show commands, outputs, and captured artifacts. **Redact every secret first** — write `<REDACTED>` in its place. Build loops against environment variables so the credential stays in the environment rather than in what you show. Captured artifacts carry auth headers: quote only the lines that carry the signal.

If the redacted output is not enough to diagnose the bug, say so and ask.
