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
Claude, Codex, Antigravity, or `agy` copy as the source.

Review these items together:

- `SKILL.md`
- `scripts/`, `references/`, `assets/`, and templates owned by the skill
- `core/inventory.json`
- routing metadata and capability records
- behavior and static tests
- evaluation cases and snapshots affected by the change
- user documentation that names the skill or its command

Use the `all-about-agents:writing-skills` process. A skill is behavior, not only
text. Test what an agent does after reading it.

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
