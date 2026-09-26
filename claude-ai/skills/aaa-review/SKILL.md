---
name: aaa-review
description: Reviews finished work and every related document against the brief, fixes small issues, and reports the rest. Use when the user asks to review, check, or audit work or docs.
---

# aaa-review

Review finished work and every related document against the brief. Fix small
issues right away, ask about big ones, and report everything.

Read the [shared conventions](references/conventions.md) first. They set the
document language, the evidence labels, where documents go, and the header.

## When to use

- The user asks to review, check, audit, or proofread work or documents, or
  asks whether the work is ready.

Do not use it to do remaining tasks, to write a brief, or to research a
question.

## Checklist

Copy this checklist into your reply and keep it current:

```text
- [ ] 1. Scope and sources of truth set
- [ ] 2. Pass A: outputs against the brief
- [ ] 3. Pass B: documents against each other
- [ ] 4. Pass C: quality by output type
- [ ] 5. Small fixes applied; big ones listed
- [ ] 6. Report written with a verdict
```

## 1. Scope and sources of truth

- Default scope: every output and every project document (`01`, `02`, `03`,
  and research files). The user may narrow it.
- Sources of truth, in this order: the brief `02-brief.md`; the acceptance
  criteria and done checks in `03-tasks.md`; the interview record
  `01-interview-record.md`. When the brief disagrees with the record line it
  cites, the record wins for that line: the brief copied it wrong.
- Read every item fresh. Do not trust a run log, a status, or a summary,
  including your own earlier ones. An output you cannot see is not checked.

## 2. Pass A: outputs

For each REQ# and each success criterion, record one result with evidence (a
quote or a location): met, partly met, missing, or extra.

- **missing**: required, but absent or wrong.
- **extra**: present in the outputs or tasks, but no requirement asks for it
  (scope creep).
- Run each done check again against the real output. A failing check means
  the task is not done, whatever the log says.
- An output you cannot see goes under "not checked", and its requirement is
  not checked. Never count it as met.

## 3. Pass B: documents

Walk the chain record → brief → tasks → outputs. Look for:

- a decision or an answer that changed or got lost on the way;
- an open question that disappeared without an answer;
- a number, name, or date that differs between documents;
- a fact in an output that no source contains, for example a price while the
  price is still an open question;
- placeholders, contradictions, broken references, and stale statuses.

## 4. Pass C: quality

Use the [review checklists](references/checklists.md) for each output type:
document, message or post, code, research, data.

## 5. Fix small, ask big

**Small**: fix it now, and list it under "Fixed" with before and after:

- a typo or a format error;
- a broken link or reference;
- a number, name, or date that disagrees with the source it cites;
- a missing item that a requirement or done check names exactly, such as a
  required form field;
- a stale status.

**Big**: do not change it. List it under "Needs your decision" with options:

- anything that changes meaning, scope, or a decision;
- a fact that no source contains: ask whether to keep, change, or remove it;
- scope creep: extra work that no requirement asks for. Do not remove it
  yourself;
- a change to many lines.

When you are unsure, treat it as big. Edit only documents and outputs you can
edit: in the folder tier, edit the file; otherwise show the corrected text.
Never delete a file.

## 6. Severity and verdict

Severity:

- **critical**: using the work now would cause harm, a wrong commitment, or a
  failed goal, for example an undecided price sent to customers.
- **important**: a requirement is missing or wrong.
- **minor**: a quality issue that breaks no requirement.

Verdict:

- **ready**: no open critical or important finding.
- **ready with notes**: only minor findings are open.
- **not ready**: a critical or important finding is open, including one that
  needs your decision.

Never say "looks good" or "ready" to save time. The user asking for it does
not change the verdict.

## 7. Independence

If subagents are available (for example in Cowork), run passes A to C in a
fresh subagent that gets only the documents and outputs, then check its
findings yourself. Otherwise label the report "self-review": the same context
that did the work is checking it.

## 8. Report

Write `04-review.md` from the [review template](templates/review.md), in the
tier the conventions choose. It holds: scope, sources of truth, the verdict,
requirement results, findings (F#, severity, location, evidence, status),
fixed, needs your decision, not checked, and a self-review line.

## 9. Re-review

When the user says issues are fixed, check only the changed parts and every
open finding:

- **addressed**: the evidence now meets the requirement;
- **not addressed**: it does not. Say why. "Attempted" is not addressed.

Save the report as v2 with the new statuses and verdict.

## Red flags

| Thought | Do this instead |
| --- | --- |
| "The run log says done." | Check the real output. |
| "That extra feature is out of scope, I'll remove it." | List it under "Needs your decision". |
| "They need it today, I'll say it's ready." | Give the true verdict and the shortest path to ready. |
| "I can't see that file, but it's probably fine." | List it under "not checked". |
| "They said they fixed it." | Re-check it. Attempted is not addressed. |
