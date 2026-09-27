> Codex only. Every surface ships this file, but it applies only when the
> selected adapter is Codex. Check the feature flag and tool names below against
> the current Codex documentation before use; this file cites no source for them.

## Subagent dispatch requires multi-agent support

Add to your Codex config (`~/.codex/config.toml`):

```toml
[features]
multi_agent = true
```

This enables `spawn_agent`, `wait_agent`, and `close_agent` for skills like `dispatching-parallel-agents` and `subagent-driven-development`. When using subagent-driven-development, close reviewer subagents when their review returns. Keep each implementer subagent open until its task's review passes — the fix loop resumes the implementer — then close it. If your harness cannot send another message to a spawned agent, dispatch each fix round as a fresh implementer carrying the brief, the report file, and the findings.

## Environment Detection

Skills that create worktrees or finish branches should detect their
environment with read-only git commands before proceeding. Both commands work
the same in any shell; `--path-format` needs Git 2.31 or later:

```text
git rev-parse --path-format=absolute --git-dir --git-common-dir
git branch --show-current
```

- The first command prints two lines. Two different paths → already in a
  linked worktree (skip creation).
- The second command prints nothing → detached HEAD (cannot branch/push/PR
  from sandbox).

See `using-git-worktrees` steps 3-4 and `finishing-a-development-branch`
step 4 for how each skill uses these signals.

## Codex App Finishing

When the sandbox blocks branch/push operations (detached HEAD in an
externally managed worktree), the agent commits only when the user gave
explicit commit authority for this work; otherwise it leaves the changes
uncommitted. Either way, it tells the user to use the App's native controls:

- **"Create branch"** — names the branch, then commit/push/PR via App UI
- **"Hand off to local"** — transfers work to the user's local checkout

The agent can still run tests and output suggested branch names, commit
messages, and PR descriptions for the user to copy.
