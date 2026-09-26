---
name: aaa-run
description: Works through a task list one task at a time, checks each result, and keeps status and a run log. Use when the user asks to execute, continue, or resume planned tasks.
---

# aaa-run

Work through a task list one task at a time. Check every result, keep the
status and the run log current, and stop only when there is a real reason.

Read the [shared conventions](references/conventions.md) first. They set the
document language, the evidence labels, where documents go, and which steps
are irreversible.

## When to use

- The user asks to run, execute, continue, or resume the tasks in a task list
  or a brief.

Do not use it to break work into tasks, to review finished work, or to
summarize a chat.

## Checklist

Copy this checklist into your reply and keep it current:

```text
- [ ] 1. Task list found; resume point checked
- [ ] 2. Loop: do, check, and record each task
- [ ] 3. Stopped only for a stop reason
- [ ] 4. Task file saved after every task
- [ ] 5. End report and next step
```

## 1. Find the work

- Use `03-tasks.md` (in the folder, in this chat, or attached).
- With no task file, treat `02-brief.md` as one task T1 whose done check is
  the brief's success criteria. If that task has more than a few outputs,
  suggest breaking it down first, for example with `/aaa-tasks`. Continue if
  the user says so.
- With neither, ask. Never rebuild a task list from memory.

## 2. Resume point

- Start at the first task, in table order, that is `in progress` or
  `pending` and whose dependencies are done.
- Before you rely on a task marked done, check that its output exists in the
  folder, the chat, or an attachment. If it is missing, set the task back to
  `pending`, say so, and redo it if you can. Otherwise ask for the file.
- An output that is not a file, such as a live post or a sent email, counts
  as existing only when a tool shows it or the user confirms it.

## 3. The loop

For each task, in order:

1. Set the status to `in progress`.
2. Do the work and produce the named output. In the folder tier, write the
   file; otherwise put the output in your reply.
3. Run the done check now, against the real output. Say what you checked.
4. Set exactly one status:
   - `done`: the check passed.
   - `done with concerns`: the check passed, but something needs attention.
     Name it.
   - `done — check not run`: the output exists, but the check cannot run
     here (a missing source, a tool you lack, a physical step). Name the
     reason.
   - `blocked`: you cannot produce the output. Name what is missing.
   - `skipped`: only when the user says so.
5. Add one run-log line: date, task, result, output and location, check
   result, notes.
6. Save the task file. In the folder tier, write it; otherwise print the
   changed rows.

Then go straight to the next task. Do not ask "shall I continue?" between
tasks.

Never mark a task `done` because the user asks, because it is close, or
because time is short. The status words are fixed. Do not write "done" with a
caveat in brackets; pick the status that is true.

## 4. Stop only for these reasons

Stop, save the task file, and ask one clear question when:

- a task is flagged `needs approval`;
- a step is irreversible or leaves the chat (deleting, sending, publishing,
  paying), even when its flag says no;
- a decision is needed that the brief and the task list do not answer;
- two documents disagree, for example the brief and the task list;
- a blocker appears: a missing input or file;
- the done check of the same task fails three times.
- the user asked for only some tasks, and those are finished.

At an approval stop, show exactly what will happen: the message text and its
recipients, the files to delete, or the amount to pay. Ask for that one step.
An approval given in advance for "everything" does not replace this stop: one
approval covers one step. After the user approves, do that step, record it,
and continue the loop.

While a task waits for approval, keep it `pending` and write "waiting for
approval" in its run-log line. If no tool here can do the task (for example,
posting in an app you cannot reach), set it `blocked`, name what is missing,
and tell the user they can do it and report back.

## 5. Parallel work

If subagents are available (for example in Cowork), you may give tasks marked
parallel-safe to subagents. Give each one the task row, its inputs, and the
brief. When a result comes back, check its output and run its done check
yourself. Never copy a worker's "done" into the task file without your own
check.

## 6. End

When no runnable task is left, report the counts: done, done with concerns,
done — check not run, blocked, skipped, and pending. List what needs the
user, then suggest the next step: review the work, for example with
`/aaa-review`.

## Red flags

| Thought | Do this instead |
| --- | --- |
| "They approved everything up front, so I can send." | Stop before the send and ask for that one step. |
| "The check can't run, but it's basically done." | Use `done — check not run` and name the reason. |
| "The flag says no approval, so I can delete." | Deleting is irreversible. Stop and ask. |
| "The file says done, so the output must exist." | Check that the output exists first. |
| "I'll ask before each task to be safe." | Keep going. Stop only for a stop reason. |
