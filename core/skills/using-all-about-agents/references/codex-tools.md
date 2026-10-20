> Codex only. Every surface ships this file, but it applies only when the
> selected adapter is Codex. Official OpenAI documentation checked 2026-10-20:
> [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents).
> Recheck current Codex documentation when a decision needs a new native fact.

## Session capabilities and delegation

Inspect the current native tool surface and applicable host instructions
before dispatch. Current Codex releases enable subagents by default, but this
does not establish availability in every session or identical App, CLI and
IDE controls. Delegate only within explicit human authority or applicable
project/skill instructions, and use only documented or exposed native actions.

Use an installed CLI probe such as `codex features list` only when diagnosing
that CLI. A separate CLI's absence or flags do not negate a capability already
exposed in the active session. Never infer native tool names from binary strings
or remembered releases. If the needed capability is unavailable, report it and
follow the selected workflow's authorized fallback; do not invent a transport.
Never edit live config without explicit authority for that exact change.

Preserve approved model policy and required inherited context. Follow
`subagent-driven-development` for worker/reviewer fix rounds and
`dispatching-parallel-agents` for independent concurrent work. Use only exposed
worker lifecycle actions: resume when supported, or provide a fresh worker
the bounded brief, report and findings. Do not invent a close or resume call.
Concurrent writers still need separate verified worktrees; read-only workers
may share context without creating a worktree.

## Git-state detection

Inspect Git attachment and worktree identity with read-only, shell-neutral
commands before applying `using-git-worktrees` or
`finishing-a-development-branch`:

```text
git rev-parse --path-format=absolute --git-dir --git-common-dir
git branch --show-current
```

`--path-format` needs Git 2.31 or later
([Git 2.31.0 release notes](https://github.com/git/git/blob/master/Documentation/RelNotes/2.31.0.adoc),
checked 2026-09-27). The first command prints the Git and common Git directories;
different paths indicate a linked worktree. Verify that checkout's identity and
isolation rather than creating a second worktree automatically.

An empty branch name indicates detached HEAD, a Git attachment state. It does
not establish a sandbox restriction, write permission or remote permission.
Inspect actual host controls, repository policy and operation evidence
separately. Git state, available native capability and human action authority
are distinct checks.

## Finishing and native actions

Require explicit Git-action authority for commit, push, history changes and
pull-request creation. Detached HEAD neither grants that authority nor proves
those actions impossible. Preserve unrelated and uncommitted work.

If an authorized operation is blocked, report its observed error and exact
affected step. Use an exposed App action only when its documented behavior and
the human's authority fit the task. Do not guess App control names or assume a
transfer changes Git or filesystem permissions. Keep Git operations separate
from native installation, registration and live configuration changes.
