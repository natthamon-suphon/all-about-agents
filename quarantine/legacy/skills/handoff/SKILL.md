---
name: handoff
description: Compact the current conversation into a handoff another agent can pick up - as a document, or as a live background agent seeded with it
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

# Handoff

Write a handoff summary of the current conversation so a fresh agent can continue the work.

If arguments were passed, treat them as a description of what the next session will focus on, and tailor the summary to that.

## What the summary contains

- **The goal** — what we are trying to achieve, in one or two lines.
- **Where we got to** — what is done, what is in flight, what is blocked and on what.
- **Decisions made and why** — especially the ones that would look arbitrary without the reasoning.
- **Suggested skills** — which skills the next agent should invoke, and when. Be specific: "start with `all-about-agents:systematic-debugging`; the repro is in `tmp/repro.test.ts`."
- **Next concrete step** — the single thing the next agent should do first.

## What it does NOT contain

**Do not duplicate content that already exists as an artifact** — specs, plans, design docs, issues, commits, diffs. Reference them by path, URL, or SHA instead. A handoff that restates the plan goes stale the moment the plan changes.

**Redact every secret.** API keys, tokens, passwords, personally identifiable information — write `<REDACTED>` in their place. The summary may become another agent's prompt, so treat it as something that will be stored and re-read.

## Where it goes

**Default — a document.** Write it to `.claude/all-about-agents/<topic>/handoff.md`, where `<topic>` is the ticket id or slug this session already uses — the same directory as its spec and plan. Create the directory if it does not exist. Tell your human partner the absolute path.

This file lands inside the repository, so the redaction rule above is load-bearing: check the summary for secrets before you write it.

**On Claude Code, if your human partner wants the work to continue immediately**, launch a background agent seeded with the summary as its prompt. Write the summary to a file first and pass it in — a multi-paragraph prompt inlined into a shell argument breaks on the first quote, backtick, or `$`:

```bash
claude --bg --name "Fix login bug" "$(cat ".claude/all-about-agents/login-bug/handoff.md")"
```

It starts in the current working directory and returns immediately. Always pass `--name` with a descriptive name — it sets the display name in the session list and terminal title. Your human partner manages it with `claude agents`.

The summary becomes a prompt the agent acts on directly, so the redaction rule above is not optional here.

Ask which one they want if it isn't obvious from the request. On any other harness, write the document — `--bg` is Claude Code only.
