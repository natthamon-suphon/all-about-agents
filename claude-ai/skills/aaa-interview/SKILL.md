---
name: aaa-interview
description: Interviews the user in depth about an idea, plan, or project, one question at a time, and keeps a live interview record. Use when the user wants to discuss, shape, or clarify an idea.
---

# aaa-interview

Interview the user in depth about something they want to do, until you both
share the same picture. Keep a live record of everything they say.

Read the [shared conventions](references/conventions.md) first. They set the
document language, the evidence labels, where documents go, and the header.

## When to use

- The user wants to discuss, shape, explore, or clarify an idea, plan, or
  project.
- The user asks you to interview or question them about it.

Do not use it to summarize a finished chat into a document, to answer a direct
factual question, or for work that is already fully specified.

## Checklist

Copy this checklist into your reply and keep it current:

```text
- [ ] 1. Start: topic, project slug, record created
- [ ] 2. Core topics covered
- [ ] 3. Extra topics for this kind of work covered
- [ ] 4. Record updated after every round
- [ ] 5. Stop rule met, coverage shown, next step offered
```

## 1. Start

- Restate the idea in one line.
- State the project slug you will use, for example "I'll call this project
  `herbal-tea-shop`." The user can correct it. It is not a question.
- Create `01-interview-record.md` from the
  [record template](templates/interview-record.md), in the tier the
  conventions choose.
- Ask the first question.

## 2. Topics

Core topics, for every interview. Go in this order unless the talk leads
somewhere else:

1. Goal and why
2. Who it is for
3. Current situation
4. Desired result and success criteria
5. Scope: in and out
6. Constraints: deadline, budget, tools, rules
7. Resources and dependencies
8. Risks and unknowns
9. Deliverable form

Add the extra topics for this kind of work from the
[topic list](references/topics.md). Mark a topic n/a only when the user agrees
that it does not apply.

## 3. Ask

- Ask exactly one question per message. Never bundle questions.
- When the answer is a choice, give 2-3 concrete options, your recommendation,
  and one short reason.
- When you are exploring, ask an open question.
- Follow one branch to its end before you open the next one. Ask the sharper
  follow-up first.
- Push back on vague answers such as "for everyone", "cheap", or "soon". Ask
  one question that makes the answer concrete.
- If an answer conflicts with an earlier one, name the conflict and ask which
  one holds.
- Never ask for something the user already said or gave you in a file.

## 4. Outside facts

Never guess a fact about the outside world: a price, a fee, a law, a market
size, a technical limit. This holds even when the user asks for a guess.
Instead:

1. Add a research item R# with the exact question.
2. Tell the user it is recorded for research.
3. Continue with the next interview question.

## 5. Record after every round

A round is about three answers, or the end of a topic. After each round,
update the record:

- Q&A log: Q#, the question, the answer in the user's own words (a short
  quote), and your one-line reading of it.
- Decisions D#, assumptions A#, open questions O#, research items R#.
- Coverage table: each topic is clear, open, or n/a.

In the inline tier, print only what changed in each round. Print the full
record at the end of each topic and at the end of the interview.

## 6. Stop rule

Stop when both of these are true:

- every topic is clear, n/a, or open by the user's choice; and
- a formal brief could be written from the record without any guessing.

Then show the coverage table and ask "anything else?" as your one question.
When the user has nothing more, set the record status to complete, and offer
the next step: turn the record into a formal brief, for example with
`/aaa-brief`.

## 7. The user stops early

If the user says stop, enough, or skip the questions, stop at once. Do not ask
another question.

1. Mark every unanswered topic open.
2. Update the record and show the coverage table.
3. Offer to turn what is known into a brief.

Never fill the gaps with your own ideas. A plan, prices, products, or
features that the user did not give are invented content.

## Red flags

| Thought | Do this instead |
| --- | --- |
| "I'll ask three things at once to save time." | Ask the most important one. |
| "They said skip, so I'll write the plan myself." | Record the gaps as open and offer the brief. |
| "A rough number would help them." | Add an R# item. A guess is invented. |
| "This answer is vague, but fine." | Ask one question to make it concrete. |
| "I'll update the record at the end." | Update it after every round. |
