---
name: pr
description: Use when writing or revising a pull request body
evaluationCases:
  - PR-TRIGGER-draft-body
  - PR-NONTRIGGER-review-diff
  - PR-PRESSURE-tiny-change-publish
  - PR-PRESSURE-invent-proof
---

# PR Body

Write the smallest PR body that explains a concrete change to a reviewer.
Draft authority does not authorize opening or publishing a PR. Commit, push,
merge and publication remain separate actions with their own authority.
A correctness review without a request for a PR body is a nontrigger; use
the existing review workflow.

## Skill Gate Protocol

1. Read the repository PR template, actual diff, relevant glossary and
   available verification results. Preserve required template fields and
   domain terms. Do not rerun an implementation or review framework merely
   to write its description.
2. Lead with the trigger, previous behavior and resulting behavior. Use a
   short plain summary for a tiny change. Add a diff sketch, call tree or
   diagram only when it explains something words cannot show clearly.
3. Pair before and after evidence: an observed failure and fix, command
   output, a focused test, or screenshots for a visual change when available.
   Name the exact check and result. Mark missing proof `not run` or
   `unavailable`; never fabricate tests, screenshots or outcomes.
4. State reversibility: a two-way door can be rolled back cheaply; a one-way
   door has irreversible or costly consequences. Name the rollback limit
   when relevant. Describe the blast radius concretely: affected behavior,
   consumers, data or deployment boundary, with meaningful uncertainty.
5. Return the draft body. Include only details a reviewer needs. Do not
   create or update an external PR from a request to write text.

## Default shape

When no repository template applies:

```markdown
## Summary

<Concrete trigger and behavior change. A short sketch only if useful.>

## Evidence

- Before: <observed evidence, or missing proof>
- After: <exact check and result, or not run>

## Merge Danger

- Door: <two-way or one-way; rollback consequence when relevant>
- Blast radius: <specific affected behavior and material risk>
```

For a small change, each field can be one sentence. Retain evidence limits;
do not fill the body with process history. Rewrite the title and body for
the final diff when scope has changed.

See [CREDITS.md](CREDITS.md) for source attribution.
