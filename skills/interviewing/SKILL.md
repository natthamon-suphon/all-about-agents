---
name: interviewing
description: Use when another skill calls for a questioning session to resolve open decisions with your human partner - NOT the entry point for building or changing anything, which is always brainstorming first
---

# Interviewing

The reusable interview primitive. Other skills wrap it and own the artifact it produces — `all-about-agents:brainstorming` turns the answers into a spec; the user-invoked `/wayfinder` turns them into resolved tickets and `/loop-me` into workflow specs. This skill is only the questioning discipline.

**Core principle:** One question at a time, each with a recommended answer, until no open question would change the output.

## When NOT to Use

**Never reach for this instead of `all-about-agents:brainstorming`.** Any request to build, create, add, change, or design something starts with brainstorming — that skill runs this discipline *and* owns the design doc and the handoff to a plan. Picking this one for "let's build X" skips the gate and produces a conversation nobody can act on.

**Never run it on its own to fill time.** A wrapping skill invokes it and owns the output. If nothing owns the output, you are interviewing for no reason — go do the work.

## The Rules

**One question per message.** Never batch. A wall of questions gets one skimmed reply covering the easy ones; a single question gets a real answer. If a topic has sub-branches, that's several turns, not one message with sub-bullets.

**Attach a recommendation to every question.** State the answer you'd pick and why, in one line. Your human partner can then say "yes" and move on, or correct you — both are fast. A bare question makes them do all the work.

> "Should failed jobs retry automatically? **I'd say yes, 3 attempts with backoff** — the failures we've seen are transient network ones. Or do you want them parked for manual review?"

**Prefer concrete options over open questions.** Two or three named choices beat "what do you think?". Open-ended is fine when you genuinely don't know the option space.

**Never answer your own questions.** You are interviewing a human who speaks for themselves. Inventing their answer and proceeding defeats the entire point — that's the failure this skill exists to prevent. If they're away, stop and say what you're blocked on.

**Follow the live thread depth-first.** When an answer opens a sharper question, ask it next. Switch to breadth-first only when the wrapping skill explicitly asks you to map a whole space rather than resolve one thing.

**Record decisions as they land**, in whatever artifact the wrapping skill owns. A decision that lives only in the transcript is lost at the next compaction.

**Push back when the answer creates a problem.** You know the codebase and the constraints; if their choice conflicts with something already decided, or costs far more than an alternative, say so before moving on. Agreeing with everything makes the interview worthless.

## Definition of Done

No open question remains whose answer would change what gets built. Not "we've talked enough" — every branch resolved.

Before declaring done, ask yourself: could an implementer act on this without coming back to ask anything? If not, you have your next question.

## Red Flags

| Thought | Reality |
|---------|---------|
| "I'll ask these four together to save time" | They'll answer one. Ask one. |
| "I can infer what they'd want here" | Inferring is how you build the wrong thing. Ask. |
| "They're probably busy, I'll assume" | State the assumption *as a question with a recommendation*. |
| "This is enough detail to start" | Enough to start ≠ enough to finish. Check the open branches. |
| "They said yes to everything, we're aligned" | Unchallenged agreement usually means the questions were too soft. |
