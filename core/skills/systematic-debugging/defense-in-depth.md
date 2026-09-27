# Defense-in-Depth Validation

## Overview

When you fix a bug caused by invalid data, adding validation at one place feels sufficient. But that single check can be bypassed by different code paths, refactoring, or mocks.

**Core principle:** Fix the root cause first, with its regression test. Then, if other paths can still deliver the bad data, propose extra validation layers as a separate change. Add them only after your human partner approves; they are not part of the bug fix, which stays the smallest change that removes the cause.

## Why Multiple Layers

Single validation: "We fixed the bug"
Multiple layers: "We made the bug impossible"

Different layers catch different cases:
- Entry validation catches most bugs
- Business logic catches edge cases
- Environment guards prevent context-specific dangers
- Temporary, tagged diagnostics help while the other layers are unproven

## The Four Layers

### Layer 1: Entry Point Validation
**Purpose:** Reject obviously invalid input at API boundary

```typescript
function createProject(name: string, workingDirectory: string) {
  if (!workingDirectory || workingDirectory.trim() === '') {
    throw new Error('workingDirectory cannot be empty');
  }
  if (!existsSync(workingDirectory)) {
    throw new Error(`workingDirectory does not exist: ${workingDirectory}`);
  }
  if (!statSync(workingDirectory).isDirectory()) {
    throw new Error(`workingDirectory is not a directory: ${workingDirectory}`);
  }
  // ... proceed
}
```

### Layer 2: Business Logic Validation
**Purpose:** Ensure data makes sense for this operation

```typescript
function initializeWorkspace(projectDir: string, sessionId: string) {
  if (!projectDir) {
    throw new Error('projectDir required for workspace initialization');
  }
  // ... proceed
}
```

### Layer 3: Environment Guards
**Purpose:** Prevent dangerous operations in specific contexts

```typescript
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, sep } from 'node:path';

async function gitInit(directory: string) {
  // In tests, refuse git init outside temp directories
  if (process.env.NODE_ENV === 'test') {
    const target = realpathSync(directory);
    const tempRoot = realpathSync(tmpdir());
    const inside = relative(tempRoot, target);
    if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
      throw new Error(
        `Refusing git init outside temp dir during tests: ${directory}`
      );
    }
  }
  // ... proceed
}
```

Compare real paths with `path.relative`, never with a string prefix. A prefix
check accepts `/tmpX` for `/tmp`, and on macOS `tmpdir()` returns `/var/...`
while the real path is `/private/var/...`.

### Layer 4: Temporary Debug Instrumentation
**Purpose:** Capture context for forensics while the other layers are unproven

```typescript
async function gitInit(directory: string) {
  const stack = new Error().stack;
  logger.debug('[DEBUG-a4f2] About to git init', {
    directory,
    cwd: process.cwd(),
    stack,
  });
  // ... proceed
}
```

Tag it and remove it in Phase 5 cleanup. Keep it only if your human partner
agrees to permanent logging; then drop the `[DEBUG-...]` tag and record why it
stays.

## Applying the Pattern

When you find a bug:

1. **Fix the root cause first** - Phase 4 in `SKILL.md`, with its regression test
2. **Trace the data flow** - Where does bad value originate? Where used?
3. **Map all checkpoints** - List every point data passes through
4. **Propose the layers as a separate change** - For each layer, name what it rejects and which bypass it closes
5. **After approval, add and test each layer** - Try to bypass layer 1, verify layer 2 catches it

## Example from Session

Bug: Empty `projectDir` caused `git init` in source code

**Data flow:**
1. Test setup → empty string
2. `Project.create(name, '')`
3. `WorkspaceManager.createWorkspace('')`
4. `git init` runs in `process.cwd()`

**Layers proposed after the root-cause fix, then approved:**
- Layer 1: `Project.create()` validates not empty/exists/writable
- Layer 2: `WorkspaceManager` validates projectDir not empty
- Layer 3: `WorktreeManager` refuses git init outside tmpdir in tests
- Layer 4: Tagged stack-trace logging before git init, removed in cleanup

## Key Insight

Each layer closes a different bypass:
- Different code paths bypass entry validation
- Mocks bypass business logic checks
- Edge cases on different platforms need environment guards
- Temporary diagnostics reveal structural misuse

That is the case you make when you propose the layers. It is not a reason to
bundle them into the bug fix.
