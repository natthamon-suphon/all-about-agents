---
name: research
description: Use when a decision is blocked on a fact you do not have - how a third-party API behaves, what a spec or RFC mandates, what a library actually does - and the answer lives outside this working directory
---

# Research

Delegate reading legwork to a subagent so your own context stays free for the work that depends on the answer.

**Announce at start:** "I'm using the research skill to investigate this against primary sources."

## When to Use

- A decision is blocked on a fact you don't have — how an API behaves, what a spec mandates, what a library actually does.
- The answer lives outside the current working directory: vendor docs, RFCs, another repo's source.
- Someone asks you to "look into" or "find out about" something before building on it.

**Not for:** questions answerable by reading this codebase (just read it), or opinions and design choices (that's `all-about-agents:brainstorming`).

## The Process

### Step 1: Sharpen the question

Write the question down as one sentence a subagent could answer without asking a follow-up. A vague brief returns a vague survey. If two or more independent questions are in play, dispatch one agent per question via `all-about-agents:dispatching-parallel-agents`.

### Step 2: Dispatch the subagent

The subagent inherits none of your session's context — construct exactly what it needs: the question, why it matters, which sources you already trust or have ruled out, and where findings should be written.

Its brief:

1. **Investigate against primary sources** — official documentation, source code, specs, first-party APIs. Not a secondary write-up of them. Follow every claim back to the source that owns it.
2. **Cite every claim** with the URL or file path it came from. A claim without a source does not go in the document.
3. **Say what it could not confirm.** Gaps reported honestly are useful; gaps papered over are not.
4. **Write the findings to a single Markdown file.** Save it where this repo already keeps such notes; match the existing convention. If there is none, use `docs/all-about-agents/research/YYYY-MM-DD-<topic>.md` and say where it went.

### Step 3: Review before you rely on it

Read the returned document before acting on it. Spot-check at least one load-bearing claim against its cited source — a subagent that read the wrong version of a doc fails silently, and the citation is what makes that checkable.

Then report to your human partner: the answer, the file path, and anything the research could not settle.
