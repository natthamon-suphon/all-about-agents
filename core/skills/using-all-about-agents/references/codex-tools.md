> Codex only. Every surface ships this file, but it applies only when the
> selected adapter is Codex. The multi-agent facts below were checked
> 2026-09-27 on codex-cli 0.146.0 with `codex features list`. After a Codex
> upgrade, check them again against the installed CLI and the
> current Codex documentation.

## Subagent dispatch requires multi-agent support

Run `codex features list` and read the `multi_agent` row before any subagent
dispatch. As checked 2026-09-27 on codex-cli 0.146.0 with `codex features list`,
`multi_agent` is `stable` and `true` (the value in effect on that
install), and `multi_agent_v2` is
`stable` and `false`. The tool names `spawn_agent`, `wait_agent`,
`close_agent`, `send_input`, `resume_agent`, and `list_agents` were found as
strings in the 0.146.0 binary; no Codex documentation was checked for them.

If the command fails or `multi_agent` is not `true`, stop and ask the human
before changing any config. Never edit `~/.codex/config.toml` without the
human's explicit authority for that exact change.

Custom agents are standalone TOML files, one per agent, under
`~/.codex/agents/` (personal) or `.codex/agents/` (project), beside the
built-in `default`, `worker`, and `explorer` agents
([Codex subagents](https://developers.openai.com/codex/subagents), retrieved
2026-08-31).

Skills like `dispatching-parallel-agents` and `subagent-driven-development`
use these tools. When using subagent-driven-development, close reviewer
subagents when their review returns. Keep each implementer subagent open until
its task's review passes — the fix loop resumes the implementer — then close
it. If your harness cannot send another message to a spawned agent, dispatch
each fix round as a fresh implementer carrying the brief, the report file, and
the findings.

## Environment Detection

Skills that create worktrees or finish branches should detect their
environment with read-only git commands before proceeding. Both commands work
the same in any shell; `--path-format` needs Git 2.31 or later
([Git 2.31.0 release notes](https://github.com/git/git/blob/master/Documentation/RelNotes/2.31.0.adoc),
checked 2026-09-27):

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
uncommitted. Either way, it tells the user to use the App's native controls.
These control names were not checked against the current Codex App or its
documentation; if the App shows other names, use what it shows:

- **"Create branch"** — names the branch, then commit/push/PR via App UI
- **"Hand off to local"** — transfers work to the user's local checkout

The agent can still run tests and output suggested branch names, commit
messages, and PR descriptions for the user to copy.
