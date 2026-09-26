---
name: aaa-tasks
description: Breaks a brief, plan, or goal into small ordered tasks, each with an output and a done check. Use when the user asks to split work into tasks or make a task list.
---

# aaa-tasks

Break work into small tasks. Each task must be small enough that one step of
the run loop can finish it and check it.

Read the [shared conventions](references/conventions.md) first. They set the
document language, the evidence labels, where documents go, and the header.

## When to use

- The user asks to break a brief, plan, or goal into tasks, steps, or a task
  list.

Do not use it to summarize a chat, to answer a question, or to do the work
itself.

## Checklist

Copy this checklist into your reply and keep it current:

```text
- [ ] 1. Source read; one-step check done
- [ ] 2. Header written
- [ ] 3. Tasks written with done checks and flags
- [ ] 4. Unknowns placed; coverage checked
- [ ] 5. Self-review passed; task list shown
```

## 1. Read the source

- Use `02-brief.md` if it exists (in the folder, in this chat, or attached).
  Otherwise use the plan or goal the user gives.
- **One-step check.** If the work is one action (one edit, one answer, one
  message), say so, then do it or offer to do it. Make no task list. This holds
  even when the user asks for a minimum number of tasks: padded tasks hide the
  real work.

## 2. Header

Write the goal, the acceptance criteria, and the non-goals. Copy the
acceptance criteria from the brief's success criteria, with their sources.

## 3. Tasks

Use the task table in the [task list template](templates/tasks.md). Rules:

- **Size.** One task gives one output that the run loop can finish and check
  in one step. If a task is bigger, split it.
- **Vertical.** Each task produces something usable. Avoid "research
  everything" followed by "write everything".
- **Done check.** Something another person could observe: "the form has
  name, age, allergy, and contact fields", "the post is live in the group",
  "the receipts total at most 5,000 baht". Never "done well" or "looks good".
- **Needs approval.** Mark it `yes` and give the reason when the task sends,
  publishes, pays, deletes, signs up, or changes an account or setting, or
  when it needs a decision the source does not make. Example: "yes: sends a
  message".
- **Parallel-safe.** Mark it `yes` only when the task needs no output from an
  unfinished task and changes nothing another task also changes.
- **Depends on.** List the T# it needs. Order the table so that every
  dependency comes first.
- **Status** starts as `pending`.

Keep every done check and every needs approval flag, even when the user asks
you to drop them to save space. Shorten the wording instead, and say in one
line why: they tell the run loop when a task is finished and when it must
stop.

If the user sets a task limit, group related work into fewer tasks and keep
full coverage. If the limit makes that impossible, say which requirement would
be dropped and ask.

## 4. Unknowns and coverage

Never write "TBD", "TODO", "later", or "handle edge cases". Place each unknown
in one of these ways:

- a decision the user must make: a decision task with needs approval `yes:
  decision`;
- an outside fact: a research task that names the question (R#);
- something that cannot be planned yet: a row in "Not yet specified" that
  says what is unknown and what it blocks.

If the user asks for TBD, say in one line why you use these instead.

Then fill the coverage table:

- every REQ# and every success criterion maps to at least one task;
- every open question (O#) and research item (R#) from the source maps to a
  task or to a "Not yet specified" row;
- a task that maps to nothing is out of scope: remove it, or ask.

## 5. Self-review and show

Before you show the list, check that:

- no task or field says TBD, TODO, or later;
- every task has an output and a done check;
- the needs approval and parallel-safe flags are set;
- dependencies come before the tasks that need them;
- coverage is complete, and no task falls outside the source.

Under the list, add one line: "Self-review: passed", or the fixes you made.
Write `03-tasks.md` in the tier the conventions choose. Leave the run log
empty. Then offer the next step: work through the tasks, for example with
`/aaa-run`.

## Red flags

| Thought | Do this instead |
| --- | --- |
| "They want five tasks for one edit." | Say it is one step and do it. |
| "TBD is fine for now." | Use a decision task, a research task, or "Not yet specified". |
| "Done checks clutter the list." | Keep them short, but keep them. |
| "Announcing is harmless, no flag needed." | Sending a message needs approval. |
| "Five tasks max, so I'll drop a requirement." | Group the work, or say what would be dropped and ask. |
