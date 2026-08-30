# Performance Profiling & Benchmarking Recipes

Standard commands and patterns for capturing profiles, flamegraphs, and benchmarks across stacks.

---

## 1. Node.js & TypeScript

### Capture CPU Profile:
```bash
# Run application with sampling CPU profiler
node --cpu-prof --cpu-prof-name=app.cpuprofile dist/index.js

# Inspect in Chrome: Open chrome://inspect -> Click "Load" -> Select app.cpuprofile
```

### Capture Heap Snapshot (Memory Leaks):
```javascript
// Programmatic heap snapshot trigger
import v8 from 'v8';
import fs from 'fs';

export function dumpHeap(filename = `heap-${Date.now()}.heapsnapshot`) {
  const snapshotStream = v8.getHeapSnapshot();
  const fileStream = fs.createWriteStream(filename);
  snapshotStream.pipe(fileStream);
  console.log(`Heap snapshot written to ${filename}`);
}
```

### HTTP Load Benchmarking with Autocannon:
```bash
# 100 concurrent connections for 10 seconds
npx autocannon -c 100 -d 10 http://localhost:3000/api/v1/items
```

---

## 2. Python

### CPU Profiling with py-spy (Zero-overhead sampling profiler):
```bash
# Generate interactive SVG flamegraph
py-spy record -o flamegraph.svg --pid <PID>
# Or run script directly:
py-spy record -o flamegraph.svg -- python app.py
```

### Micro-benchmarking with pytest-benchmark:
```bash
pytest tests/test_perf.py --benchmark-only --benchmark-autosave --benchmark-compare
```

---

## 3. Database Query Analysis (PostgreSQL)

```sql
-- Always run with BUFFERS to see memory/disk page hits
EXPLAIN (ANALYZE, BUFFERS, COSTS, VERBOSE)
SELECT u.id, u.email, COUNT(o.id)
FROM users u
LEFT JOIN orders o ON o.user_id = u.id
WHERE u.created_at >= '2026-01-01'
GROUP BY u.id, u.email;
```

**Key Signals in Query Plan:**
* `Seq Scan on large_table` $\rightarrow$ Missing index.
* `Buffers: shared hit=10 read=5000` $\rightarrow$ High disk I/O, needs caching or index filter.
* `Rows Removed by Filter: 1000000` $\rightarrow$ Query reads millions of rows to discard most of them.
