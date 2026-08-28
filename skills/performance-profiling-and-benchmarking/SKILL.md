---
name: performance-profiling-and-benchmarking
description: Use when investigating latency, slow queries, high CPU usage, memory leaks, or Core Web Vitals regressions - requires scientific baselines before optimizing
---

# Performance Profiling and Benchmarking

## Overview

Performance optimization without measurement is guesswork. Establish reproducible baseline metrics, isolate the exact bottleneck using profilers, apply targeted improvements, and verify the gain against the baseline.

**Core principle:** Measure first, profile second, optimize third, verify fourth.

**The Iron Law:**
```
NO PERFORMANCE CLAIMS OR OPTIMIZATION COMMITS WITHOUT BEFORE/AFTER BENCHMARK EVIDENCE
```

## The Four-Step Performance Cycle

```
1. MEASURE BASELINE ──────> 2. PROFILE BOTTLENECK ──────> 3. TARGETED FIX ──────> 4. VERIFY DELTA
(Reproducible harness)      (Flamegraph / Heap dump)       (Single variable)       (Statistically sound)
```

### Step 1: Establish a Reproducible Baseline
1. Create or run a deterministic benchmark command or load script (e.g. `k6`, `autocannon`, `pytest-benchmark`, `hyperfine`).
2. Run at least 5 warm iterations to eliminate cold-start noise.
3. Record exact metrics: P50, P95, P99 latency, requests/sec, and memory footprint.
4. If results have high variance (>10%), isolate background processes before continuing.

### Step 2: Profile to Find the Bottleneck
Do NOT guess which function is slow. Run the appropriate diagnostic tool:

* **CPU / Execution Time:** Capture a CPU profile or flamegraph (e.g. `node --cpu-prof`, `py-spy`, `perf`, Chrome DevTools CPU profiler). Locate the widest function bars on the flamegraph.
* **Memory Leaks / Allocations:** Take heap snapshots before and after a workload (e.g. `heapdump`, Chrome DevTools memory allocation timeline). Look for objects with monotonically increasing retained sizes.
* **Database Latency:** Run `EXPLAIN (ANALYZE, BUFFERS)` on SQL queries. Look for sequential scans on large tables, missing composite indexes, or N+1 query patterns.
* **Frontend Performance:** Inspect Core Web Vitals (LCP, INP, CLS) and network waterfall charts for blocking scripts or oversized assets.

### Step 3: Implement Targeted Fix
1. Change ONE variable at a time.
2. Target the hot path identified in the flamegraph:
   - Eliminate redundant iterations or object allocations inside tight loops.
   - Introduce database indexes matching query filter/sort predicates.
   - Implement caching at the right seam with explicit TTL and eviction policies.
   - Batch N+1 database or network requests into single bulk queries.

### Step 4: Verify Delta & Guard Against Regressions
1. Re-run the exact baseline benchmark command under the same conditions.
2. Confirm the metric improvement is statistically meaningful.
3. Run the full unit and regression test suite to ensure the optimization introduced zero behavioral bugs.

## Common Rationalizations

| Excuse | Reality |
|---|---|
| "This function looks slow, let me rewrite it" | Intuition about bottlenecks is wrong 80% of the time. Profile first. |
| "It feels much faster now" | Feelings are not metrics. Show P95 latency numbers before and after. |
| "Adding an index always speeds up queries" | Indexes slow down writes and consume RAM. Verify with `EXPLAIN ANALYZE`. |
| "Premature optimization is fine if it's easy" | Unneeded complexity hurts maintainability. Optimize only verified bottlenecks. |

## Red Flags

- Claiming performance improvements without before/after numbers
- Adding complex caching layers before checking database query plans
- Running benchmarks in debug/development mode instead of production builds
