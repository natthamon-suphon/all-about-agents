---
name: aaa-brief
description: Turns the current chat or an interview record into a formal brief with goals, scope, decisions, and open questions. Use when the user asks to summarize a discussion into a document.
---

# aaa-brief

Turn what was said into a formal brief. The brief records decisions and gaps.
It adds nothing new.

Read the [shared conventions](references/conventions.md) first. They set the
document language, the evidence labels, where documents go, and the header.

## When to use

- The user asks to summarize a chat, a discussion, or an interview into a
  formal document, brief, or summary.
- An interview record exists and the user wants the formal version.

Do not use it to explore a new idea, to translate text, to answer a question,
or to write content that nobody has discussed yet.

## Checklist

Copy this checklist into your reply and keep it current:

```text
- [ ] 1. Source found and named
- [ ] 2. Brief drafted from the template
- [ ] 3. Every line traced or labeled
- [ ] 4. Self-review passed
- [ ] 5. Shown to the user; corrections become v2, v3
```

## 1. Find the source

1. If an interview record `01-interview-record.md` exists (in the folder, in
   this chat, or attached), use it. Also use any chat turns after it.
2. Otherwise use the current chat, or the part of it the user names.
3. If there is nothing real to summarize, say so and stop. Do not build a
   brief from almost nothing.

Name the source in the header's Sources row. Read an interview record by its
header table and its ID tables (Q#, D#, A#, O#, R#). Its section titles may be
in another language.

## 2. Draft

Use the [brief template](templates/brief.md). Write `02-brief.md` in the tier
the conventions choose, in a formal style in the document language. Keep the
template's section order:

1. Summary (at most five sentences)
2. Background
3. Goals
4. Non-goals
5. Audience
6. Requirements (REQ#)
7. Constraints
8. Success criteria
9. Decisions (D#)
10. Risks
11. Assumptions (A#)
12. Open questions (O#), including research items (R#)
13. Source trace

## 3. Trace every line

- End each statement with its source: `(Q3)`, `(D2)`, or `(chat)`.
- A line you concluded yourself carries `inferred` and what it is based on.
- A section nobody discussed holds only "Not discussed." Add the gap to the
  open questions.
- Carry every research item R# into the open questions with its question.
  Never answer it yourself.
- Add nothing new: no features, numbers, targets, names, or dates that the
  source does not contain.

## 4. When the user asks you to add or remove

| Request | What you do |
| --- | --- |
| "Add the features you think are missing." | Keep the requirements as stated. Offer your ideas in your reply, outside the brief, as suggestions. A requirement the user never gave reads as a decision they made. |
| "Put targets in the success criteria." | Keep "Not discussed". Offer example criteria in your reply for the user to pick. A criterion the user picks becomes stated (source: chat) and moves in. |
| "Make it sound complete. Remove the open questions." | Improve the wording, and keep every open question. Removing one hides a real gap. Never swap it for a placeholder such as "[to be set]". |
| The user gives a missing answer. | Close that open question, update the section, and trace it to chat. |

## 5. Self-review

Before you show the brief, check and fix:

- placeholder or leftover template text
- contradictions between sections
- vague words such as "fast", "cheap", "soon", or "many" with no number or
  example from the source
- scope creep: anything the source does not contain
- success criteria that nobody could check
- an open question or R# from the source that is missing

Under the brief, add one line: "Self-review: passed", or the fixes you made.

## 6. Versions

Show the brief and ask for corrections. Each round of corrections makes a new
version: v2, v3, and so on. Update the Version row, and add one line to the
change log: version, date, and what changed.

## Red flags

| Thought | Do this instead |
| --- | --- |
| "A few good ideas will make it look complete." | Offer them in your reply. The brief holds only what was said. |
| "They asked for metrics, so I'll invent sensible ones." | Keep "Not discussed" and offer choices. |
| "Open questions look weak." | Keep them. A hidden gap is worse. |
| "The source trace is noise." | Keep it. It is how the user checks you. |
| "I remember roughly what the record said." | Read the record again, or ask for it. |
