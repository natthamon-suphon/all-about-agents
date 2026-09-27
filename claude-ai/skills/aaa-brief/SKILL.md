---
name: aaa-brief
description: Turns the current chat or an interview record into a formal brief with goals, scope, decisions, and open questions. Use when the user asks to summarize a discussion into a document or update a brief.
---

# aaa-brief

Turn what was said into a formal brief. The brief records decisions and gaps.
It adds nothing new.

Read the [shared conventions](references/conventions.md) first. They set the
document language, the evidence labels, where documents go, and the header.

## When to use

- The user asks to summarize a chat, a discussion, or an interview into a
  formal document or brief.
- An interview record exists and the user wants the formal version.

Do not use it to explore a new idea, to translate text, to answer a question,
to summarize an article, a web page, or a file, to give a short recap in
your reply, or to write content that nobody has discussed yet.

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

If `02-brief.md` already exists and the user asks to update it, start from
its latest version, not from scratch. A correction or a new research answer
makes the next version (see sections 4 and 6).

1. If an interview record `01-interview-record.md` exists (in the folder, in
   this chat, or attached), use it. Also use any chat turns after it.
2. Otherwise use the current chat, or the part of it the user names.
3. If there is nothing real to summarize, say so and stop. Do not build a
   brief from almost nothing.
4. Also look for research reports `research-<topic>.md` of this project, in
   the same places. Read each one's Answers row.

Name every source in the header's Sources row, including research reports
and attached files by name. Read an interview record by its header table,
its Topic line, its ID tables (Q0 and up, D#, A#, O#, R#), and its Other
facts given table (fact, source). Its section titles may be in another
language.

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
9. Decisions (D#): choices made between options, each with the reason given
   (or "reason not given")
10. Risks
11. Assumptions (A#)
12. Open questions (O#), including research items (R#)
13. Source trace

## 3. Trace every line

- End each statement with its source: `(Q3)`, `(D2)`, `(chat)`, or an
  attached file such as `(prices.txt)`. A fact from the record's Other facts
  given table carries that row's source, for example `(chat, after Q4)`.
- `(chat)` covers only what the user said or accepted. An idea that only you
  suggested is not a source: leave it out, or list it as an open question
  that says it was your suggestion.
- A line you concluded yourself carries `inferred` and what it is based on.
  So does a line that rests only on the record's Reading column: trace to the
  user's words in the Answer column.
- If the source conflicts, use the later statement only when the user clearly
  changed it. Otherwise add an O# that names both. In the section, point to
  that O#, and do not pick one yourself.
- A section nobody discussed holds only "Not discussed." Add the gap to the
  open questions.
- Carry every research item R# into the open questions with its question.
  Never answer it yourself. When a research report's Answers row names that
  R#, carry the report's short answer instead, with its label, into the
  section it affects, traced as `(R2: research-insurance.md)`, and do not
  list the R# as open. If the report's answer is unknown, keep the R# open
  and name the report.
- Add nothing new: no features, numbers, targets, names, or dates that the
  source does not contain.
- Put each fact in one section only. A stated fact is a requirement, a
  constraint, or background. It becomes a decision only when the user chose
  it over another option. Resources and dependencies go to Constraints or
  Background; the deliverable form goes to Requirements.

## 4. When the user asks you to add or remove

| Request | What you do |
| --- | --- |
| "Add the features you think are missing." | Keep the requirements as stated. Offer your ideas in your reply, outside the brief, as suggestions. A requirement the user never gave reads as a decision they made. |
| "Put targets in the success criteria." | Keep "Not discussed". Offer example criteria in your reply for the user to pick. A criterion the user picks becomes stated (source: chat) and moves in. |
| "Make it sound complete. Remove the open questions." | Improve the wording, and keep every open question. Removing one hides a real gap. Never swap it for a placeholder such as "[to be set]". |
| The user gives a missing answer. | Close that open question, update the section, and trace it to chat. |
| A new research report answers an R# of this brief. | Make the next version (see Versions). Carry the answer as in step 3, take the R# out of the open questions, add the report to Sources, and name it in the change-log row. Change nothing else. |

## 5. Self-review

Before you show the brief, check and fix:

- placeholder or leftover template text
- contradictions between sections
- scope creep: anything the source does not contain
- an open question or R# from the source that is missing

Then check these, and never fix them by adding a number, a date, or a target:

- vague words such as "fast", "cheap", "soon", or "many" with no number or
  example from the source: keep the user's words, and add an open question
  that asks for the number;
- success criteria that nobody could check: keep them, write "Not discussed"
  under How to check it, and add an open question that asks for the measure.

In your reply, under the brief, add one line: "Self-review: passed", or the
fixes you made.

## 6. Versions

Show the brief and ask for corrections. Each round of corrections makes a new
version: v2, v3, and so on. Update the Version row, and add one line to the
change log: version, date, and what changed. When the user accepts the brief,
or asks for the next step with no more corrections, set its header Status to
`complete`.

Then offer the next step: split the work into tasks, for example with
`/aaa-tasks`, or run it with `/aaa-run`.

## Red flags

| Thought | Do this instead |
| --- | --- |
| "A few good ideas will make it look complete." | Offer them in your reply. The brief holds only what was said. |
| "They asked for metrics, so I'll invent sensible ones." | Keep "Not discussed" and offer choices. |
| "Open questions look weak." | Keep them. A hidden gap is worse. |
| "The source trace is noise." | Keep it. It is how the user checks you. |
| "I remember roughly what the record said." | Read the record again, or ask for it. |
