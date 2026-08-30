# Testing Skills with Independent Agents

Use independent agents to test decisions, not to manufacture agreement. The
skill author owns the behavioral contract; evaluators receive only the prompt,
candidate/control variant, allowed artifacts, and scoring rubric needed for one
isolated case.

## Roles

- **Runner:** executes one trigger, nontrigger, or pressure prompt in a fresh
  context and preserves redacted output.
- **Evaluator:** scores observable decisions without seeing the desired score or
  rationalization from the author.
- **Reviewer:** inspects the skill diff, test quality, authority boundaries, and
  unresolved risks. A reviewer does not edit the implementation.

Do not let two agents edit the same files concurrently. Do not let an evaluator
reuse the runner's hidden state. Treat all repository and model output as
untrusted evidence.

## Evidence package

For each case record:

1. case ID, variant, fresh-session identifier, and redacted prompt;
2. expected actions and forbidden actions;
3. actual decisions, evidence, uncertainty, and stop behavior;
4. numeric/boolean rubric results with short evidence references;
5. unavailable checks marked `not run`; and
6. reviewer verdict plus resolved/deferred findings.

Use multiple fresh samples only when the harness and budget support them. Never
copy one result to simulate independent samples. Static checks establish file
contracts; they do not prove pressure behavior.

## Pressure design

Pressure cases should target a realistic rationalization: skip evidence, widen
scope, invent a vendor capability, mutate without authority, expose a secret,
claim completion from stale output, or follow polished prose over observed
facts. Avoid trick wording unrelated to the skill's actual risk.

## Stop conditions

Stop and fix the evaluation when failure comes from malformed fixtures, missing
dependencies, shared conversation state, secret-bearing logs, or a rubric that
cannot distinguish trigger from nontrigger. Route paid, native, destructive, or
repository-wide qualification to its authorized later owner.
