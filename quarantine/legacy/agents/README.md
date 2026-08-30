# All About Agents — Agent Roles Directory

This directory defines the standard specialist agent roles used across the **All About Agents** ecosystem.

## Available Agent Roles

Each agent is defined in standard **Markdown (`.md`) with YAML Frontmatter** (for native Claude Code, Cursor, Codex, and Agent Skills compatibility) as well as **JSON (`.json`)** for programmatic APIs:

| Agent Name | Definitions | Permissions | Model Tier | Core Purpose & When to Dispatch |
|---|---|---|---|---|
| `implementer` | [`implementer.md`](implementer.md) / [`.json`](implementer.json) | Full R/W | Fast / Balanced (`inherit` / `sonnet` / `flash`) | TDD task execution from plans, vertical slice implementation, self-review. |
| `task-reviewer` | [`task-reviewer.md`](task-reviewer.md) / [`.json`](task-reviewer.json) | Read-Only | High-Reasoning (`pro` / `opus` / `o3`) | Gatekeeper review for spec compliance, code quality, test hygiene. |
| `deep-investigator` | [`deep-investigator.md`](deep-investigator.md) / [`.json`](deep-investigator.json) | Read-Only + Web | High-Reasoning (`pro` / `opus`) | Forensic root-cause analysis, log investigation, call-stack tracing. |
| `security-auditor` | [`security-auditor.md`](security-auditor.md) / [`.json`](security-auditor.json) | Read-Only | High-Reasoning (`pro` / `opus`) | STRIDE threat modeling, secret scanning, CVE & injection checks. |
| `codebase-architect` | [`codebase-architect.md`](codebase-architect.md) / [`.json`](codebase-architect.json) | Read-Only + Diagrams | High-Reasoning (`pro` / `opus`) | Module depth assessment, seam placement, and architecture review. |
| `generalist` | [`generalist.md`](generalist.md) / [`.json`](generalist.json) | Full Access | Balanced (`inherit`) | Fallback worker for miscellaneous and exploratory tasks. |

---

## Agent File Format Standard (.md)

Custom Subagents use YAML frontmatter followed by system instructions:

```markdown
---
name: task-reviewer
description: Reviews task diffs against the brief and global constraints.
tools: Read, Grep, Glob, LS, view_file, grep_search, find_by_name, list_dir
model: pro
---

You are an adversarial task reviewer subagent operating strictly in READ-ONLY mode...
```

---

## Platform Mapping

### Google Antigravity & Gemini CLI
* Discovered via `~/.gemini/config/agents/` and plugin registry.
* Invocable using `invoke_subagent` specifying `TypeName` or role.
* Reactive wakeup resumes the parent agent automatically upon completion without polling.

### Claude Code
* Discovered via `~/.claude/agents/*.md` and `.claude/agents/*.md`.
* Claude Code automatically delegates to agents based on their `description` or when invoked directly.
* Supports agent teams with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`.

### OpenAI Codex
* Configured in `~/.codex/config.toml` under `[features] multi_agent = true`.
* Invocable via `spawn_agent`.
