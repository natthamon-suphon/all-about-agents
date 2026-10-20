---
name: retro
description: Use when the user explicitly requests a coding-session retrospective or recommendations to improve the agent environment
evaluationCases:
  - RETRO-TRIGGER-environment-retrospective
  - RETRO-NONTRIGGER-explain-test-error
  - RETRO-PRESSURE-more-global-prose
---

# Coding Session Retrospective

Use only for an explicit retrospective or environment-improvement request.
Recommend improvements to the agent's working environment from a scoped
session. An application bug, ordinary review or status question is a
nontrigger and stays with its existing workflow.

## Skill Gate Protocol

1. Identify the requested session and improvement goal. If none is named,
   use the current visible session evidence and state its coverage limits.
   Read only evidence in the named scope. Do not scan all history or guess
   private session locations. If transcript diagnosis needs missing paths
   or detailed event analysis, use `diagnosing-agent-workflows`.
2. Inspect the repository's existing checks, scripts, CI and relevant
   steering documents. Determine whether a check is absent, unwired or
   broken before proposing a replacement.
3. Rank evidence-backed candidates in these categories:
   - **Navigation:** a missing pointer, hidden dependency or repeated search.
   - **Automated checks:** a mistake a deterministic check could catch;
     include absent or broken check wiring.
   - **Coding standards:** separate mechanical patterns from judgment calls.
     A repeated mechanical mistake first gets a deterministic check in the
     existing lint, test or CI system. Do not replace it with more prose.
     Reserve review guidance for judgments a check cannot settle.
   - **Steering bloat:** duplicated, ineffective or misplaced global prose.
     Suggest a scoped reference, review standard or check where appropriate.
   - **Tool economy:** avoidable repeated calls or oversized output. Quantify
     only when the scoped evidence supports a measurement.
   - **Information access:** missing logs or read-only information that
     blocked a decision. Access expansion needs separate authority.
4. Present recommendations in severity order. For each, give the evidence
   location, failure it prevents, smallest fitting change, proposed owner
   and a runnable verification where possible. Distinguish observed impact
   from an inference. If evidence does not support a category, omit it.
5. Stop at recommendations. Do not change live or global settings, install
   tools, edit steering files or implement checks without authority for that
   next action. A retrospective alone authorizes none of those mutations.

## Output

Give the top findings and evidence first, then proposed changes and checks.
State session coverage, assumptions and unavailable evidence. Recommend no
change when existing controls already solve the observed problem. Keep
implementation context small; place genuine review judgments with the
review responsibility instead of loading every agent with more instructions.

Adapted from Matt Pocock's
[retro](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/retro/SKILL.md).
This adaptation retains explicit intent while allowing natural-language
discovery and removes dependencies on uninstalled writing skills.
