# Native verification

Use this guide after registration or after a manual Desktop setup. It records
what a product actually observed. Package files and static tests are not native
proof.
Use `register --dry-run` before any authorized native apply. Use
`register --apply` only after the dry-run is reviewed and authority is recorded.
This guide covers the cross-machine receiving machine check.

The lifecycle is:

```text
rendered -> validated -> registered -> trusted -> active -> runtime verified
```

Record each state separately. Use `PASS` only for an observed operation. Use
`NOT_RUN` when the check was intentionally skipped. Use
`NOT_RUN_UNAVAILABLE` when the product, host, entitlement, session, or
transport is unavailable.

## Repository and disposable checks

Run these checks from the repository root:

```text
node --test tests/integration/native-registration.test.mjs
node --test tests/static/documentation.test.mjs tests/static/maintenance-docs.test.mjs tests/static/contributor-entrypoints.test.mjs
```

The native harness uses fresh temporary roots. It checks Claude validation,
marketplace registration, plugin discovery, and both statusline profiles. It
checks Codex marketplace and plugin discovery and hook file presence. Codex
hook trust is not run. It checks `agy` validation, 28 skills, 7 agents, 1 hook,
both statusline profiles, and the exact model slug. Desktop checks remain
manual.

Run a product validator only against a disposable package root:

```text
claude plugin validate "<PACKAGE_ROOT>" --strict
agy plugin validate "<PACKAGE_ROOT>"
```

A validator result is `validated`. It does not by itself prove `registered`,
`trusted`, `active`, or `runtime verified`.

## Receiving-machine verification

1. Open the repository root.

2. Check the local runtime.

   ```text
   node --version
   ```

3. Check Git state.

   ```text
   npm run sync:status
   ```

4. Run the repository quality checks.

   ```text
   npm run quality:quick
   ```

5. Run the full repository quality check before a handoff.

   ```text
   npm run quality:full
   ```

6. Run `doctor` with a new disposable root.

   ```text
   node scripts/aaa.mjs doctor --surface all --destination-root "<DISPOSABLE_ROOT>" --format json
   ```

7. Inspect the package diff.

   ```text
   node scripts/aaa.mjs diff --surface all --destination-root "<DISPOSABLE_ROOT>" --statusline-name "<YOUR_NAME>" --format json
   ```

8. Plan a dry-run install.

   ```text
   node scripts/aaa.mjs install --surface all --destination-root "<DISPOSABLE_ROOT>" --statusline-name "<YOUR_NAME>" --dry-run --format json
   ```

Warning: the next command writes the disposable root. Read the dry-run report
and confirm the root before applying it.

9. Apply the package only with exact installation authority.

   ```text
   node scripts/aaa.mjs install --surface all --destination-root "<DISPOSABLE_ROOT>" --statusline-name "<YOUR_NAME>" --apply --format json
   ```

10. Follow [dry-run registration](native-registration.md#dry-run-registration).
    It creates isolated Claude/Codex roots and includes the Codex local-Git
    package prerequisite. Do not use a generic register command for Claude or
    Codex.

Warning: the next command may mutate a native product root. Use only after an
authorized decision and after reviewing the dry-run report.

11. Apply native registration only with exact authority by following
    [apply registration](native-registration.md#apply-registration).

12. Restart or reload the product.

13. Run the product-specific observation below.

## Product observations

### Claude Code

1. Record `claude --version`.

2. Validate the package with `claude plugin validate "<PACKAGE_ROOT>" --strict`.

3. Add the local marketplace and install the named plugin with the commands
   in [native registration](native-registration.md).

4. Record `claude plugin list --json` and the enabled package name.

5. Start a fresh session and inspect the generated statusline.

6. Record model, effort, permissions, emergency denies, and hook behavior only
   when the session shows them.

Fable access depends on account, plan, provider, consent, and product version.
Sonnet is a documented server-failure fallback. Neither access nor a fallback
event is proved by package output.

### Codex CLI

1. Record `codex --version`.

2. Set a disposable `CODEX_HOME`.

3. Run `codex plugin marketplace add "<PACKAGE_ROOT>" --json`.

4. Run `codex plugin add all-about-agents@all-about-agents-dev --json`.

5. Record `codex plugin list --available --json`.

6. Restart Codex CLI or Desktop.

7. Open `/hooks` and review or trust changed hook hashes when the product asks.

8. Record `gpt-5.6-sol` with `max` as primary or the explicit `terra-max`
   recovery choice. Do not record automatic fallback.

### `agy` CLI

1. Record `agy --version`.

2. Run `agy models` and confirm `gemini-3.7-flash-high`.

3. Run `agy --help` and confirm `--effort high`.

4. Validate the package with `agy plugin validate "<PACKAGE_ROOT>"`.

5. Run the generated statusline with documented JSON stdin.

6. Inspect the sparse overlay before any settings merge.

7. Use the structured headless argument vector:

   ```text
   agy -p <PROMPT> --model gemini-3.7-flash-high --effort high --dangerously-skip-permissions
   ```

The prompt is one argument. Do not rebuild it as a shell command string.
Full access is per run. Disabled hook templates are not active protection.

### Antigravity Desktop

1. Record the Desktop version and operating system.

2. Open a disposable workspace with the documented plugin path.

3. Reload Desktop and record plugin, rule, skill, and agent discovery.

4. Select `Gemini 3.7 Flash High` and record the conversation-local result.

5. Select `Custom`, keep `Turbo mode` off, and inspect the Deny rules.

6. Exercise each emergency Deny rule only in the disposable workspace.

7. Leave hook templates disabled and inert until failure and blocking behavior
   have a documented product contract.

The Desktop statusline display name is unavailable because no native Desktop
statusline contract is established. Do not infer it from the CLI package.

## Evidence record

For every check, record the machine, operating system, product and version,
branch, commit SHA, exact command or manual action, exit code, status, evidence
path, and checks not run. Redact prompts, responses, credentials, keys, and
private paths before retaining evidence.

Use the exact status vocabulary from the [evaluation method](../evaluations/method.md).
Keep `rendered`, `validated`, `registered`, `trusted`, `active`, and `runtime
verified` as separate fields. A missing check stays `NOT_RUN` or
`NOT_RUN_UNAVAILABLE`; it is never upgraded from a green static test.
