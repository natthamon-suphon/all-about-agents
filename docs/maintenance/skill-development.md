# Skill development

Use this guide when you add or change a skill. Read the complete skill and all
files that it owns before editing.

Keep the native lifecycle separate from the skill change:

```text
rendered -> validated -> registered -> trusted -> active -> runtime verified
```

Quality checks can prove rendered and validated content. They do not prove a
native tool registered, trusted, active, or runtime verified the skill. Use
[native registration](native-registration.md) and
[native verification](native-verification.md) for those states.

## Canonical source

The canonical source is `core/skills/<skill-name>/`. Do not edit a generated
Antigravity, Claude, or Codex copy as the source.

## New-skill update flow

Use this order when adding a skill:

1. Update the canonical skill content under `core/skills/<skill-name>/`.
2. Update `core/inventory.json` and the `emoji registry` when the skill is
   new or its presentation changes.
3. Add or update the routing cases in `core/evals/skill-routing/<skill>.json` and
   the lint assertions in `tests/lint/skills/<skill>.test.mjs` when the skill
   changes behavior.
4. Render all surfaces and both profiles in disposable roots.
5. Run the focused skill test, then the package and repository tests.
6. Record exact evidence in checkpoints or a handoff.
7. Commit/push only on the author machine after explicit Git authority.

On a receiving machine, pull the approved commit and repeat validation,
rendering, dry-run, package apply, registration dry-run, explicit registration
apply, restart, and native verification in that order. A pull never installs a
skill or changes live configuration.

Review these items together:

- `SKILL.md`
- `scripts/`, `references/`, `assets/`, and templates owned by the skill
- `core/inventory.json`
- routing metadata and capability records
- lint and static tests
- evaluation cases and snapshots affected by the change
- user documentation that names the skill

Use the `all-about-agents:writing-skills` process. A skill is behavior, not only
text. Test what an agent does after reading it.

## Two test layers

`tests/lint/skills/<skill>.test.mjs` is a regex contract on the skill text. It is
fast and runs in every gate, and it proves nothing about what an agent does.
`npm run test:model` runs the routing cases of the skills in
`tests/model/suite.json` through real headless `claude -p` sessions and records
`PASS`, `FAIL`, or `NOT_RUN_UNAVAILABLE` per case under `.aaa/eval-runs/`. It is
manual: it needs an authenticated `claude` CLI and the installed plugin at the
current `package.json` version, or every case is `NOT_RUN_UNAVAILABLE`. Report a
skill change as "lint-verified, model run pending" until the model run has a
`PASS` dated after the change.

The suite scores routing, not presentation. Every case prompt is sent with one
appended instruction: end the answer with a final line `skill: <the
all-about-agents skill you route this to, or none>`. The scorer reads the last
such line. A trigger or pressure case passes when that line names the case's own
skill; a non-trigger case passes when it names anything else, including `none`.
An answer with no such line is `FAIL` with a reason that says the trailer is
missing, so an ignored instruction is never confused with a routing verdict.

Naming a skill in prose is not routing to it. An answer that explains why a skill
stays unused names it without routing to it, and the trailer keeps the two apart.

A skill listed in `routers` in `tests/model/suite.json` is scored differently,
because its job is to dispatch to another skill rather than to do the work. Its
trigger case passes on any route, its non-trigger case requires no route at all,
and its pressure case stays strict. `using-all-about-agents` is the only router.

The question names this package on purpose. A machine may carry skills from
other plugins that fit a prompt better, and a route to one of those is reported
with `(not a skill of this package)` in the reason.

Each case gets 300000 ms; set `AAA_CASE_TIMEOUT_MS` to change it. A case that
outruns the budget is `NOT_RUN_UNAVAILABLE`, never `FAIL`.

## Define behavior cases

Write expected behavior before implementation. Include at least these cases:

- **Trigger case:** the skill must be selected for a clear matching request.
- **Non-trigger case:** the skill must stay unused for a nearby request.
- **Pressure case:** the agent must keep the rule when speed or convenience
  pushes against it.
- **Behavior case:** the agent must produce the required action or artifact,
  not only repeat the skill words.

Add safety and error cases when the skill writes files, runs commands, uses a
network, or changes external state.

## RED, GREEN, review

1. **RED:** add or change a focused test and confirm that it fails for the
   missing behavior.
2. **GREEN:** make the smallest complete change that makes the behavior pass.
3. **Review:** inspect the skill, companions, routing, inventory, tests,
   evaluation cases, and generated surface result together.

Run the focused skill gate:

```text
npm run quality:skill -- <skill-name>
```

Then run the repository gates:

```text
npm run quality:quick
npm run quality:full
git diff --check
git diff
```

## Cross-surface review

Confirm that every supported tool receives the same intent. Vendor syntax may
be different, but safety, scope, trigger rules, and expected behavior must stay
equivalent.

Static and rendered checks cannot prove that a native product discovered or
used the skill. Follow the [cross-tool quality guide](cross-tool-quality.md).
If a product is unavailable, record `NOT_RUN_UNAVAILABLE`.

## Evidence to keep

Record:

- skill name and reason for the change
- branch and commit SHA
- tool, model, harness, and version used for authoring
- RED failure and GREEN result
- focused, quick, and full command results
- native product results and checks not run
- changed files and remaining risks

Do not include prompts, tokens, keys, or private user data in retained evidence.
