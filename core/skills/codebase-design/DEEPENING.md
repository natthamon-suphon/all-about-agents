# Deepening Modules Safely

Use this reference after the Skill Gate Protocol in [SKILL.md](SKILL.md) finds
evidence that behavior should move behind a deeper interface. Deepening is a
replacement strategy, not permission to add another forwarding layer.

## Dependency categories

Classify every dependency before placing a seam.

### 1. In-process

Pure computation or in-memory state with no external I/O. Combine behavior when
that improves leverage and locality, then test through the deepened module's
interface. No adapter is required merely to call another local function.

### 2. Local-substitutable

Infrastructure with a faithful local stand-in, such as an embedded database or
disposable filesystem. Keep the external interface domain-shaped and test the
implementation with the stand-in. Do not expose the local stand-in as caller
knowledge.

### 3. Remote but owned

An owned service across a network or process boundary. Define a port at the seam
only when transport actually varies. The deep module owns policy and behavior;
production and in-memory test adapters satisfy the same interface. Keep retries,
timeouts, idempotency, and remote error translation explicit.

### 4. True external

A third-party system outside the team's control. Inject a narrow domain-shaped
port and use a controlled fake or mock adapter in tests. Keep vendor payloads,
authentication mechanics, rate limits, and transient failures inside the
production adapter unless callers genuinely must handle them.

## Seam discipline

- One production adapter alone is a hypothetical seam. Require observed
  variation, normally production plus a meaningful test adapter or two runtime
  implementations.
- Internal seams remain inside the implementation. Do not enlarge the external
  interface because a unit test wants private state.
- Place error translation at the seam so callers receive stable domain errors.
- Pass dependencies as values or constructors; do not hide global creation.
- Reject generic “execute/fetch/request” ports when named operations can express
  invariants and error modes directly.

## Migration sequence

1. Pin current behavior with tests at the intended interface.
2. Define the smallest interface and its invariants, ordering, and errors.
3. Move one coherent behavior path behind it while preserving callers.
4. Replace callers incrementally and verify each compatibility boundary.
5. Remove the obsolete shallow layer only after no caller relies on it.
6. Re-run focused behavior and integration checks; report anything not run.

## Testing strategy: replace, do not layer

Write tests through the deepened interface and assert observable outcomes.
After equivalent interface-level coverage exists, remove obsolete tests that
couple to the former shallow implementation. Do not keep both layers of tests
indefinitely, and do not delete unique edge-case evidence until it is represented
at the new interface.

The migration is complete only when callers and tests use the same seam, old
pass-through knowledge is gone, and failures remain localized.

