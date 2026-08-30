---
name: loop-me
description: Grill me about the workflows I want to build in this workspace, until each one is a spec an implementer could build without asking a question
disable-model-invocation: true
argument-hint: "A workflow to design, or nothing to go find one"
---

# Loop Me

Run a stateful interviewing session whose only output is **workflow** specs. Use `all-about-agents:interviewing` for the questioning discipline — one question at a time, relentless, a recommended answer attached to each — aimed at the vocabulary and goal below. Create, edit, and delete specs as the questioning resolves things.

This skill owns the artifact: workflow specs at `.claude/all-about-agents/<workflow-name>/workflow.md` — one directory per workflow. Do not divert into `all-about-agents:brainstorming` — that skill produces a design doc and hands off to implementation, which is not what this is for.

**Announce at start:** "I'm using the loop-me skill to specify workflows."

## The loop lens

A **loop** is a recurring pattern in your human partner's life: their career, their week, their morning, a single repeated activity. Picturing a life as loops within loops reveals how predictable its activities really are — which is what makes them worth **delegating**. Use the lens to find loops worth specifying, and propose ones they haven't noticed.

A **workflow** is the spec of one loop, made real. You run a workflow on a loop — the loop is its running instantiation. Workflows live at `.claude/all-about-agents/<workflow-name>/workflow.md` and are the source of truth.

## Vocabulary

A shared language, reached for only when a workflow calls for it — never a checklist. **Mandate nothing structural**: a workflow needs no AI, no checkpoint, and no schedule unless the questioning shows it does.

- **Trigger** — what fires each run: an **event** (a new email, a new issue) or a **schedule** (every morning). Event-triggering is usually the more efficient.
- **Checkpoint** — a human-in-the-loop point where your human partner is asked to verify or decide. Some workflows have none and run autonomously; some use no AI at all.
- **Push right** — defer the checkpoint as far as it will go. Do maximal work before involving the human, so they are asked once, late, with everything prepared.
- **Brief** — what a checkpoint presents: a tight, decision-ready summary — what was produced, why, and a link down to the asset itself — never the raw output. They read a brief, not a draft. Speed of review is imperative.

## Definition of done

A workflow spec is done when an implementer agent could build it without asking a single question. Keep questioning until then; nothing is done while a question remains.

## The workspace

- `.claude/all-about-agents/<workflow-name>/workflow.md` — one spec per workflow, each in its own directory. (Each workflow is its own topic — unlike other skills, one loop-me session normally produces several.)
- `.claude/all-about-agents/NOTES.md` — raw notes on your human partner's world: the tools they use, the channels they process, and their own terminology for both. When it is empty or thin, interview them about their world before specifying anything. Sharpen fuzzy terms into canonical ones as they surface, and record them here.
