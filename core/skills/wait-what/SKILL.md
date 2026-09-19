---
name: wait-what
description: Use when the human explicitly says that the last explanation, answer, or message did not land and needs a clearer re-pitch.
evaluationCases:
  - WW-TRIGGER-user-says-did-not-land
  - WW-NONTRIGGER-first-explanation
  - WW-PRESSURE-language-switch
---

# Wait, What?

Re-pitch one explanation only after an explicit non-landing signal from the
human. This is a recovery skill, not a general instruction to simplify every
answer.

**Core principle:** rebuild the explanation around the missing context, keep
the session's language, and make the idea concrete without defending the
original wording.

## Trigger gate

Activate this skill only when the human explicitly says that the previous
message did not land. Signals include “that did not make sense,” “I do not
follow,” “you lost me,” or “that is not what I meant.” A first explanation, an
ordinary follow-up question, or a request to continue is not a signal. Do not
re-pitch automatically when no explicit non-landing signal exists: no signal
means the assistant does not re-pitch.

## Skill Gate Protocol

1. Inspect the conversation immediately before the signal. Identify what was
   being explained, what the human says did not land, and the language used in
   the current session. Resolve facts from the conversation before asking for
   more information.
2. Confirm that the signal is explicit. If it is only a first explanation or a
   normal question, keep the normal response path and do not invoke this skill.
3. Re-pitch the smallest missing point: give the needed context, use plain
   language in the session language, and anchor it with one concrete example.
   Use the project's own names consistently. Do not silently change the
   requested meaning.
4. Keep the session language. Do not switch to English or force English when
   the conversation is in another language. If the language is genuinely
   unclear, ask one short language question rather than guessing.
5. Do not defend the original phrasing or repeat it louder. Do not apologize.
   Return to the normal conversation after the re-pitch. Invoke this skill again
   only after a new explicit non-landing signal.

## Concrete example

If the session is in Thai and the human says, “ยังไม่เข้าใจว่าขั้นตอนนี้ทำอะไร”
(“I still do not understand what this step does”), re-pitch in Thai. Explain
the missing context and use one concrete comparison, such as “ขั้นตอนนี้เหมือน
การตรวจบัตรก่อนเข้าอาคาร” (“This step is like checking an ID before entering a
building”). Do not force an English explanation just because the word “step”
appeared in the earlier message.

## Red flags

- Re-pitching after a first explanation without an explicit non-landing signal.
- Switching the session to English under time, urgency, or user pressure.
- Adding several unrelated explanations instead of repairing the smallest gap.
- Defending, apologizing for, or merely repeating the original wording.
- Guessing what the human meant or inventing context absent from the session.

When a red flag appears, stop and apply the Skill Gate Protocol again.
