# Native verification

Use this guide after registration. It records what a product actually
observed. Package files and static tests are not native proof.
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

For a receiving machine, use this exact order before the observations below:

```text
pull -> validate -> render -> dry-run -> apply package -> dry-run registration -> explicit registration apply -> restart -> verify loaded instructions
```

Git is the source of truth, but pull does not install or write live
configuration. Package apply and native registration are separate explicit
actions. See [global instructions](global-instructions.md) for the exact
global destinations and the project/plugin second layer.

## Repository and disposable checks

Run these checks from the repository root:

```text
node --test tests/integration/native-registration.test.mjs
node --test tests/static/documentation.test.mjs tests/static/maintenance-docs.test.mjs tests/static/contributor-entrypoints.test.mjs
```

The native harness uses fresh temporary roots. It checks Claude validation,
marketplace registration, plugin discovery, and both statusline profiles. It
checks Codex marketplace and plugin discovery and hook file presence. Codex
hook trust is not run. For Antigravity it checks the package layout that
`agy plugin validate` accepts; Antigravity renders no hooks, so there is no
hook-file or hook-trust check to run.

Run a product validator only against a disposable package root:

```text
claude plugin validate "<PACKAGE_ROOT>" --strict
agy plugin validate "<PACKAGE_ROOT>"
```

`agy plugin validate` is read-only and prints one processed count per
component. A package of this repository must report 28 skills and 7 agents,
with commands, mcpServers, and hooks all skipped.

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
    It creates isolated product roots and includes the Codex local-Git package
    prerequisite. Do not use a generic register command for any surface.

Warning: the next command may mutate a native product root. Use only after an
authorized decision and after reviewing the dry-run report.

11. Apply native registration only with exact authority by following
    [apply registration](native-registration.md#apply-registration).

12. Restart or reload the product.

13. Run the product-specific observation below.

## Product observations

### Antigravity (`agy`)

1. Record `agy --version`.

2. Validate the package with `agy plugin validate "<PACKAGE_ROOT>"`.

3. Run `agy plugin install "<PACKAGE_ROOT>"`. It takes a plain directory and
   needs no Git repository.

4. Record `agy plugin list` and `agy agents`. All seven role names must appear.

5. Check whether the `GEMINI.md` deploy was refused. A no-clobber destination
   that already differs reports `manual-required`, and the routing contract is
   then absent until it is merged by hand. A green registration is not evidence
   that the file was written.

6. Ask the product, from a directory that has **no** `.agents/` folder:

   ```text
   agy -p "Quote the first heading of your global instructions. Do they contain a section titled 'Routing contract'? Name three skills available to you."
   ```

   Inside a workspace that carries its own copy of the package, a correct answer
   cannot say which copy was loaded, so the run proves nothing about the global
   install.

7. Antigravity Desktop has no headless mode. Record it as
   `NOT_RUN_UNAVAILABLE` unless someone opened it and asked the same question.

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

4. Run `codex plugin add all-about-agents@all-about-agents --json`.

5. Record `codex plugin list --available --json`.

6. Restart Codex CLI or Desktop.

7. Open `/hooks` and review or trust changed hook hashes when the product asks.

8. Record `gpt-5.6-sol` with `max` as primary or the explicit `terra-max`
   recovery choice. Do not record automatic fallback.

## Evidence record

For every check, record the machine, operating system, product and version,
branch, commit SHA, exact command or manual action, exit code, status, evidence
path, and checks not run. Redact prompts, responses, credentials, keys, and
private paths before retaining evidence.

Use the exact status vocabulary from the [evaluation method](../evaluations/method.md).
Keep `rendered`, `validated`, `registered`, `trusted`, `active`, and `runtime
verified` as separate fields. A missing check stays `NOT_RUN` or
`NOT_RUN_UNAVAILABLE`; it is never upgraded from a green static test.
