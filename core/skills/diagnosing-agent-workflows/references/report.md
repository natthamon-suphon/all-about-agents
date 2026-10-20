# Workflow Diagnosis Report

Return this structure in the response, or at a requested approved local path.
Keep sections proportional to the scoped question.

1. **Question and coverage:** expected versus actual behavior; exact session
   identity, verified source paths, selected turns/lines and source sizes.
   List unavailable or ambiguous evidence and rejected candidates if any.
2. **Verdict:** what the checked evidence proves, with `path:line` for every
   finding and confidence. Separate observation, inference and unknown.
3. **Relevant timeline:** actual human requests separately from parent,
   hook and tool events. Match attempts with results; include only relevant
   actions, failures, resumes and verification.
4. **Findings:** one sentence per finding, absolute `path:line`, minimal
   redacted quote of at most 200 characters, impact and confidence.
   Include a plausible competing explanation or the next check when uncertain.
5. **Numbers, when asked:** source fields, counter semantics, arithmetic,
   coverage and missing data. Distinguish per-event from cumulative counters.
   No invented costs, token totals, percentages or prices.
6. **Limits and next check:** unread ranges, in-progress sessions, unavailable
   capabilities and the smallest check that could resolve uncertainty.

Mark environment and skill observations as historical transcript evidence,
current observation or unknown. Current settings are not historical proof.
Do not include a full transcript, secret-bearing excerpt or unsolicited
export. A finding is evidence for triage, not permission to change a skill.

Adapted from Superpowers'
[diagnosis report](https://github.com/obra/superpowers/blob/bb92a77741419a4ab5f06e711a283343f1ada0c3/skills/diagnosing-superpowers/templates/report.md).
