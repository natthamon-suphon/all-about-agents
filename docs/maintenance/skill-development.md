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

For imported or retained upstream guidance, follow [reviewed upstream
updates](upstream-updates.md). Keep one explained disposition per canonical
skill in `core/upstreams.json`; reading an upstream does not install it.

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
fast, and it proves nothing about what an agent does. `quality:skill` runs the
file of one skill, and `quality:full` runs every file through the full suite;
`quality:quick` runs none of them. The full suite also runs
`tests/lint/skill-word-budget.test.mjs`: a `SKILL.md` body must stay under
1,500 words, and the `using-all-about-agents` body under 500.
`npm run test:model` runs the routing cases of the skills in
`tests/model/suite.json` through real headless `claude -p` sessions and records
`PASS`, `FAIL`, or `NOT_RUN_UNAVAILABLE` per case. Each run writes its own
`.aaa/eval-runs/trigger-suite-<UTC timestamp>-<suffix>/result.json`, and
`quality:full` reports the age and the pass, fail, and not-run counts of the
newest one; it reads no other file there. The suite is manual and never runs
paid calls from a quality gate. It needs an authenticated `claude` CLI. The
default `installed` mode checks the current version and cached `SKILL.md`
bytes. `rendered` mode writes a fresh candidate into a disposable directory and
loads it through `--plugin-dir`. It does not install or register that candidate.
Set `AAA_MODEL_MODE=rendered` in the calling process to select that mode.
`AAA_MODEL_PROFILE` selects the expected render profile: `portable` by default,
or `template` for a template install. This selects expected package bytes; it
does not apply model settings. The selected config root also shapes those bytes.

The exported `runSuite` function accepts `mode`, `profile`, `skills`, and
`caseIds` for a scoped manual run. `qualificationOnly: true` runs only one
forced Skill-load probe. That probe is an infrastructure check and never a
natural-trigger PASS. `diagnosticOnly: true` requests no tool calls and records
derived plugin/catalog counts before and after one metadata probe. It never
qualifies a candidate or runs natural cases. Do not use it to bypass an
isolation failure. These modes still make a model call and need task authority.

Each normal run first qualifies the candidate path and Skill completion. A
missing executable, auth, source identity, stable candidate bytes, or required
isolation stops model-call fan-out. Record `NOT_RUN_UNAVAILABLE` and its exact
reason. Keep the natural model run pending until that prerequisite works.

The suite scores route text and native load evidence. Every prompt asks for a
final line `skill: <the all-about-agents skill you route this to, or none>`.
That line alone cannot pass an invocation check. A trigger or pressure PASS
also needs a matching main-conversation Skill call and successful result joined
by tool-use ID. A complete Read of the exact candidate `SKILL.md` can be parsed
in unit fixtures; routing-only native runs expose only `Skill`. They cannot
read private files or test a full workflow. Init skill availability, prose
mentions, failed calls, partial reads, and subagent loads do not prove main
invocation. Malformed, partial, duplicate, and oversized streams fail closed.

A nontrigger checks omission of the target skill. A target Skill/Read attempt
fails even if the trailer says `none`. A valid other package route is allowed.
Unknown package names fail. Pressure cases also check
`forbiddenPressurePhrases`, such as `here is the code`. These are bounded
route/load checks; they do not grade every workflow observable in a case.

A skill listed in `routers` in `tests/model/suite.json` is scored differently,
because its job is to dispatch to another skill rather than to do the work. Its
trigger case needs a route and native load of a real skill of this package.
Its nontrigger case requires no route/load attempt. `EndConversation`
housekeeping is allowed. Its pressure case stays strict.
`using-all-about-agents` is the only router.

Per-run settings disable ordinary hooks, bundled skills, inline skill shell
execution, account connectors, and noncandidate plugin IDs. Empty strict MCP
config, an MCP deny, and `--no-chrome` bound other tools. The process keeps user
settings, auth, model, effort, and inherited emergency deny rules. It does not
copy credentials or change live settings. Native init still must confirm the
candidate path and absence of foreign tools, plugins, and MCP. Managed-policy
interference is a limit to report, not a rule to bypass.

`native-evidence.json` stores only normalized, redacted facts: local before/after
file hashes, candidate path match, model names, tool IDs and completion status,
catalog counts, and errors. It stores no raw init or private plugin list. Missing
native effort stays unavailable. A route/load PASS does not prove installed,
trusted, active, full-workflow, macOS, Desktop, or IDE behavior. Keep those
checks separate. Unit fixtures test the runner, never model behavior.

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

`npm run quality:skill -- <skill-name>` runs two checks. `skill-artifacts` runs
`validate --scope skill`. Among other checks, it fails when the skill has no
matching `core/inventory.json` record, no routing file, or no lint test file.
It also fails when the routing file has no case id that contains `-TRIGGER-`,
no id with `-NONTRIGGER-`, or no id with `-PRESSURE-`. The `evaluationCases`
list in the `SKILL.md` frontmatter must name the same case ids in the same
order.
`skill-lint` runs the lint test file. No gate checks the behavior case.

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
