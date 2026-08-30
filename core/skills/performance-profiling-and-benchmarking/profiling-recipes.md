# Adaptable Profiling Recipes

These are illustrative command shapes, not universal benchmark settings. Replace
every placeholder from the workload-specific plan, confirm each tool is already
available, and use a representative production-like but safe environment. Do
not install packages or send load to production without separate authority.

## Common record

For every recipe capture `<COMMIT>`, `<BUILD_MODE>`, `<RUNTIME>`, `<HARDWARE>`,
`<DATASET>`, `<CONCURRENCY>`, `<CACHE_STATE>`, warmup rationale, sampling plan,
raw output path, failures, and acceptance criteria.

## CPU

Node-compatible runtimes, when the built-in profiler is supported:

```text
node --cpu-prof --cpu-prof-name=<PROFILE_PATH> <APPLICATION_ENTRY> <WORKLOAD_ARGS...>
```

Python sampling profiler, when already installed and authorized:

```text
py-spy record --output <PROFILE_PATH> --pid <PID>
```

Choose duration from the representative workload. Check sampling overhead and
whether startup or steady-state behavior is the target.

## Memory

Capture comparable snapshots or allocation profiles at declared workload points:

```text
<RUNTIME_MEMORY_TOOL> <APPLICATION_OR_PID> --output <ARTIFACT_PATH>
```

Compare retained-object paths after equivalent work and collection state. Do not
infer a leak from one high-water mark or from incomparable cache states.

## Database

Use the database's actual-plan facility only on an approved representative
dataset. `EXPLAIN ANALYZE` executes the statement, so the default recipe accepts
a read-only SELECT only. For PostgreSQL-compatible systems, adapt:

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
<PARAMETERIZED_READ_ONLY_SELECT>;
```

Do not substitute `INSERT`, `UPDATE`, `DELETE`, DDL, or a side-effecting function.
For a mutating plan, use non-executing `EXPLAIN` first. Execution requires an
isolated disposable database plus explicit mutation authority; a transaction
and `ROLLBACK` alone may not contain external effects from triggers or functions.

Preserve parameter distribution, row estimates versus actual rows, timing,
buffers, locks, and write/storage trade-offs. Do not paste secrets or production
customer values into artifacts.

## Request or service workload

Use an existing load tool with explicit placeholders:

```text
<LOAD_TOOL> --target <DISPOSABLE_OR_APPROVED_TARGET> --scenario <SCENARIO_FILE> --output <RAW_RESULTS>
```

Select arrival pattern, concurrency, duration, and warmup from the production
workload and capacity question. Record errors, saturation, retries, and server
resources together with latency and throughput.

## Frontend or client

Define a concrete navigation, render, or input scenario:

```text
<CLIENT_PROFILER> --scenario <SCENARIO> --device <DEVICE_PROFILE> --network <NETWORK_PROFILE> --output <TRACE_PATH>
```

Use the same production-like build, device/network model, data, cache state, and
interaction path for baseline and candidate. Retain trace evidence rather than
only a headline score.

## Microbenchmarks

Use only for isolated mechanisms that the end-to-end profile identifies. Keep
setup outside the measured region, consume results to prevent elimination, and
test representative input shapes. A microbenchmark does not prove user-visible
improvement; remeasure the full workload afterward.
