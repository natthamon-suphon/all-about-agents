---
name: systematic-debugging
description: Use when encountering any bug, test failure, unexpected behavior, or performance regression, before proposing fixes - also when asked to "debug this" or "diagnose" something broken, throwing, failing, or slow
---

# Systematic Debugging

## Overview

**Core principle:** ALWAYS find root cause before attempting fixes. Symptom fixes are failure.

**Violating the letter of this process is violating the spirit of debugging.**

## The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

If you haven't completed Phase 1, you cannot propose fixes.

## When to Use

Use for ANY technical issue:
- Test failures
- Bugs in production
- Unexpected behavior
- Performance problems
- Build failures
- Integration issues

**Use this ESPECIALLY when:**
- Under time pressure (emergencies make guessing tempting)
- "Just one quick fix" seems obvious
- You've already tried multiple fixes
- Previous fix didn't work
- You don't fully understand the issue

**Don't skip when:**
- Issue seems simple (simple bugs have root causes too)
- You're in a hurry (rushing guarantees rework)
- Manager wants it fixed NOW (systematic is faster than thrashing)

## The Five Phases

You MUST complete each phase before proceeding to the next.

### Phase 1: Root Cause Investigation

**BEFORE attempting ANY fix:**

1. **Read Error Messages Carefully**
   - Don't skip past errors or warnings
   - They often contain the exact solution
   - Read stack traces completely
   - Note line numbers, file paths, error codes

2. **Build a Feedback Loop, Then Minimise the Repro**

   **This is the gate. Everything after it is mechanical.**

   A feedback loop is **one command you have already run** that goes red on *this* bug and green once it's fixed. Not "I can reproduce it by clicking around" — one command, deterministic, seconds not minutes, runnable unattended.

   Read [feedback-loops.md](feedback-loops.md) for the ten ways to construct one, how to tighten it, what to do with non-deterministic bugs, and the completion checklist. Once it's red, minimise the repro there too: cut inputs, config, and steps one at a time until every remaining element is load-bearing.

   **No red-capable command, no hypotheses.** If you catch yourself reading code to build a theory before that command exists, stop — that's the exact failure this skill prevents. If you genuinely cannot build one, say so explicitly and ask; don't guess.

   **Redact every secret** in any command, output, or artifact you show — write `<REDACTED>` in its place.

3. **Check Recent Changes**
   - What changed that could cause this?
   - Git diff, recent commits
   - New dependencies, config changes
   - Environmental differences

4. **Gather Evidence in Multi-Component Systems**

   **WHEN system has multiple components (CI → build → signing, API → service → database):**

   **BEFORE proposing fixes, add diagnostic instrumentation:**
   ```
   For EACH component boundary:
     - Log what data enters component
     - Log what data exits component
     - Verify environment/config propagation
     - Check state at each layer

   Run once to gather evidence showing WHERE it breaks
   THEN analyze evidence to identify failing component
   THEN investigate that specific component
   ```

   **Example (multi-layer system):**
   ```bash
   # Layer 1: Workflow
   echo "=== Secrets available in workflow: ==="
   echo "IDENTITY: ${IDENTITY:+SET}${IDENTITY:-UNSET}"

   # Layer 2: Build script
   echo "=== Env vars in build script: ==="
   env | grep IDENTITY || echo "IDENTITY not in environment"

   # Layer 3: Signing script
   echo "=== Keychain state: ==="
   security list-keychains
   security find-identity -v

   # Layer 4: Actual signing
   codesign --sign "$IDENTITY" --verbose=4 "$APP"
   ```

   **This reveals:** Which layer fails (secrets → workflow ✓, workflow → build ✗)

5. **Trace Data Flow**

   **WHEN error is deep in call stack:**

   See `root-cause-tracing.md` in this directory for the complete backward tracing technique.

   **Quick version:**
   - Where does bad value originate?
   - What called this with bad value?
   - Keep tracing up until you find the source
   - Fix at source, not at symptom

### Phase 2: Pattern Analysis

**Find the pattern before fixing:**

1. **Find Working Examples**
   - Locate similar working code in same codebase
   - What works that's similar to what's broken?

2. **Compare Against References**
   - If implementing pattern, read reference implementation COMPLETELY
   - Don't skim - read every line
   - Understand the pattern fully before applying

3. **Identify Differences**
   - What's different between working and broken?
   - List every difference, however small
   - Don't assume "that can't matter"

4. **Understand Dependencies**
   - What other components does this need?
   - What settings, config, environment?
   - What assumptions does it make?

### Phase 3: Hypothesis and Testing

**Scientific method:**

1. **Generate 3-5 Ranked Hypotheses BEFORE Testing Any**
   - Writing down one hypothesis anchors you on the first plausible idea. Generate several, then rank them.
   - Each must be **falsifiable** — state the prediction it makes: "If X is the cause, then changing Y makes the bug disappear / changing Z makes it worse."
   - Can't state the prediction? It's a vibe. Discard or sharpen it.
   - **Show the ranked list to your human partner before testing.** They often re-rank it instantly ("we just deployed a change to #3") or know which ones they've already ruled out. Cheap checkpoint, big time saver — but don't block on it if they're away.

2. **Test Them One at a Time, Minimally**
   - Start at the top of the ranking
   - Make the SMALLEST possible change to test that one hypothesis
   - One variable at a time
   - Don't fix multiple things at once
   - Prefer a debugger or REPL breakpoint over logs — one breakpoint beats ten logs. Never "log everything and grep".
   - **Tag every debug log with a unique prefix**, e.g. `[DEBUG-a4f2]`, so cleanup is a single grep. Untagged logs survive forever; tagged logs die.
   - **Performance regressions:** logs are usually the wrong tool. Establish a baseline measurement (timing harness, profiler, query plan), then bisect. Measure first, fix second.

3. **Verify Before Continuing**
   - Confirmed? → Phase 4
   - Falsified? Cross it off and take the **next hypothesis in the ranking** — don't invent a fresh one while ranked candidates remain untested
   - Whole ranked list exhausted? The evidence you gathered testing it has changed the picture: return to Phase 1 and generate a new ranked list from what you now know
   - DON'T add more fixes on top

4. **When You Don't Know**
   - Say "I don't understand X"
   - Don't pretend to know
   - Ask for help
   - Research more

### Phase 4: Implementation

**Fix the root cause, not the symptom:**

1. **Create Failing Test Case — at a correct seam**

   **First, find the seam.** A correct seam is one where the test exercises the real bug pattern *as it occurs at the call site*. A single-caller unit test for a bug that needs multiple callers, or a test that can't replicate the chain that triggered it, gives false confidence — worse than no test.

   **If a correct seam exists:** turn the minimised repro from Phase 1 into a test there. You MUST have it before fixing — watch it fail, fix, watch it pass. Use `all-about-agents:test-driven-development` for writing it.

   **If no correct seam exists, that itself is the finding.** Say so, fix the bug without the regression test, and carry the missing seam into Phase 5 — the architecture is what's preventing this bug from being locked down.

   Either way, once the fix is in, re-run the Phase 1 loop against the **original, un-minimised** scenario.

2. **Implement Single Fix**
   - Address the root cause identified
   - ONE change at a time
   - No "while I'm here" improvements
   - No bundled refactoring

3. **Verify Fix**
   - Test passes now?
   - No other tests broken?
   - Issue actually resolved?
   - Use the `all-about-agents:verification-before-completion` skill before claiming success

4. **If Fix Doesn't Work**
   - STOP
   - Count: How many fixes have you tried?
   - If < 3: Return to Phase 1, re-analyze with new information
   - **If ≥ 3: STOP and question the architecture (step 5 below)**
   - DON'T attempt Fix #4 without architectural discussion

5. **If 3+ Fixes Failed: Question Architecture**

   **Pattern indicating architectural problem:**
   - Each fix reveals new shared state/coupling/problem in different place
   - Fixes require "massive refactoring" to implement
   - Each fix creates new symptoms elsewhere

   **STOP and question fundamentals:**
   - Is this pattern fundamentally sound?
   - Are we "sticking with it through sheer inertia"?
   - Should we refactor architecture vs. continue fixing symptoms?

   **Discuss with your human partner before attempting more fixes**

   This is NOT a failed hypothesis - this is a wrong architecture.

### Phase 5: Cleanup and Post-Mortem

Required before declaring done:

- [ ] Original repro no longer reproduces — re-run the Phase 1 loop and show the output
- [ ] Regression test passes (or the absence of a correct seam is documented)
- [ ] All `[DEBUG-...]` instrumentation removed — grep the prefix to confirm
- [ ] Throwaway harnesses and prototypes deleted, or moved somewhere clearly marked as debug scaffolding
- [ ] The hypothesis that turned out correct is stated in the commit or PR message, so the next debugger learns from it

**Then ask: what would have prevented this bug?**

If the answer is architectural — no good test seam, tangled callers, hidden coupling — write the specifics down and tell your human partner they can run `/improve-codebase-architecture` to survey it properly. That skill is user-invoked only; you cannot start it yourself, and you should not begin refactoring on the back of a bug fix. Make the recommendation **after** the fix is in, not before: you know far more now than when you started.

## Red Flags - STOP and Follow Process

If you catch yourself thinking:
- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "Add multiple changes, run tests"
- "Skip the test, I'll manually verify"
- "It's probably X, let me fix that"
- "I don't fully understand but this might work"
- "Pattern says X but I'll adapt it differently"
- "Here are the main problems: [lists fixes without investigation]"
- Proposing solutions before tracing data flow
- **"One more fix attempt" (when already tried 2+)**
- **Each fix reveals new problem in different place**

**ALL of these mean: STOP. Return to Phase 1.**

**If 3+ fixes failed:** Question the architecture (see Phase 4.5)

## Your Human Partner's Signals You're Doing It Wrong

**Watch for these redirections:**
- "Is that not happening?" - You assumed without verifying
- "Will it show us...?" - You should have added evidence gathering
- "Stop guessing" - You're proposing fixes without understanding
- "Ultra-think this" - Question fundamentals, not just symptoms
- "We're stuck?" (frustrated) - Your approach isn't working

**When you see these:** STOP. Return to Phase 1.

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "Issue is simple, don't need process" | Simple issues have root causes too. Process is fast for simple bugs. |
| "Emergency, no time for process" | Systematic debugging is FASTER than guess-and-check thrashing. |
| "Just try this first, then investigate" | First fix sets the pattern. Do it right from the start. |
| "I'll write test after confirming fix works" | Untested fixes don't stick. Test first proves it. |
| "Multiple fixes at once saves time" | Can't isolate what worked. Causes new bugs. |
| "Reference too long, I'll adapt the pattern" | Partial understanding guarantees bugs. Read it completely. |
| "I see the problem, let me fix it" | Seeing symptoms ≠ understanding root cause. |
| "One more fix attempt" (after 2+ failures) | 3+ failures = architectural problem. Question pattern, don't fix again. |

## Quick Reference

| Phase | Key Activities | Success Criteria |
|-------|---------------|------------------|
| **1. Root Cause** | Read errors, **build a red loop**, minimise, check changes, gather evidence | One command that goes red on this bug |
| **2. Pattern** | Find working examples, compare | Identify differences |
| **3. Hypothesis** | Rank 3-5 falsifiable theories, test one at a time | Confirmed or new hypothesis |
| **4. Implementation** | Create test at a correct seam, fix, verify | Bug resolved, tests pass |
| **5. Cleanup** | Remove tagged instrumentation, post-mortem | Nothing left behind, cause recorded |

## When Process Reveals "No Root Cause"

If systematic investigation reveals issue is truly environmental, timing-dependent, or external:

1. You've completed the process
2. Document what you investigated
3. Implement appropriate handling (retry, timeout, error message)
4. Add monitoring/logging for future investigation

**But:** 95% of "no root cause" cases are incomplete investigation.

## Supporting Techniques

These techniques are part of systematic debugging and available in this directory:

- **`feedback-loops.md`** - Build, tighten, and minimise the one command that goes red on this bug (Phase 1)
- **`scripts/hitl-loop.template.sh`** - Structured human-in-the-loop repro script, for when a human must click
- **`root-cause-tracing.md`** - Trace bugs backward through call stack to find original trigger
- **`defense-in-depth.md`** - Add validation at multiple layers after finding root cause
- **`condition-based-waiting.md`** - Replace arbitrary timeouts with condition polling
- **`find-polluter.sh`** - Identify which other test is polluting shared state
