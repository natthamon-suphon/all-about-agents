# Native registration

This guide starts after a package has been rendered and reviewed. Repository
rendering and native registration are separate actions.
Keep Git and native registration separate.
This is the cross-machine registration guide.

The lifecycle is:

```text
rendered -> validated -> registered -> trusted -> active -> runtime verified
```

`rendered` means the repository created the files. `validated` means local
checks or a product validator accepted them. `registered` means the product
can discover the package. `trusted` means the product accepted native code or
hooks. `active` means a fresh product session loaded the feature. `runtime
verified` means the required native action was observed. A later state cannot be
claimed when an earlier state is missing.

For a receiving machine, use this order:

```text
pull -> validate -> render -> dry-run -> apply package -> dry-run registration -> explicit registration apply -> restart -> verify loaded instructions
```

Git pull changes the repository only. Package apply and native registration
are separate explicit actions. The managed global destinations are
`<CLAUDE_CONFIG_DIR>/CLAUDE.md`, `<CODEX_HOME>/AGENTS.md`, and
`~/.gemini/GEMINI.md` (`<AAA_ANTIGRAVITY_ROOT>/GEMINI.md` when that variable
is set).

An authorized apply may overwrite `CLAUDE.md` and `AGENTS.md` without a backup.
It never overwrites a differing `GEMINI.md`. It must not guess a product root
or replace unknown neighboring files.

## Product binaries must resolve first

The native steps of `register --apply` spawn `agy`, `claude`, and `codex` by
bare name. Rendering and package apply never call them. When a binary does not
resolve, the plan still copies its managed files and then fails the native
commands, which leaves a package that looks installed but that the product
does not know about. Verify discovery with each product's own command before
you register:

```text
agy plugin list
claude plugin list
codex plugin list --available --json
```

Prepend the product's `bin` directory to `PATH` for the registration command
only when the binary is installed outside `PATH`. Resolve that directory on the
machine you are setting up; never reuse a path recorded on another machine.

The registered package root is stored in live product configuration and read on
every launch. Use a durable root, not a temporary directory that the operating
system cleans up. See [Windows setup](../setup/windows.md) and
[macOS setup](../setup/macos.md).

## Before registration

1. Enter the repository root.

2. Check the repository source.

   ```text
   node scripts/aaa.mjs validate --scope all
   ```

3. Render one surface into a new disposable package root. Claude accepts the
   statusline name:

   ```text
   node scripts/aaa.mjs install --surface claude --profile <PROFILE> --destination-root "<PACKAGE_ROOT>" --statusline-name "<YOUR_NAME>" --dry-run --format json
   ```

   Codex does not accept `--statusline-name`:

   ```text
   node scripts/aaa.mjs install --surface codex --profile <PROFILE> --destination-root "<PACKAGE_ROOT>" --dry-run --format json
   ```

4. Read the dry-run report.

Warning: `--apply` writes installer-owned files below `<PACKAGE_ROOT>`.
Use a new disposable root first. The installer may replace any differing
regular file at a declared destination. It preserves unknown neighboring paths
and creates no backup.

5. Apply the package only after the dry-run report is accepted. Use the same
   surface-specific option rule:

   ```text
   node scripts/aaa.mjs install --surface claude --profile <PROFILE> --destination-root "<PACKAGE_ROOT>" --statusline-name "<YOUR_NAME>" --apply --format json
   node scripts/aaa.mjs install --surface codex --profile <PROFILE> --destination-root "<PACKAGE_ROOT>" --apply --format json
   ```

The statusline name is used by Claude only. An interactive install asks
for it. A non-interactive install uses an empty name when the option is absent.
The name is trimmed, limited to 64 Unicode code points, and rejects control
and ANSI characters.

## Dry-run registration

Warning: registration planning reads product-root metadata. It does not prove
that the product will discover or run the package.

1. Set an isolated product root for Claude or Codex. Use the block for your
   shell.

   PowerShell:

   ```powershell
   New-Item -ItemType Directory -Force -LiteralPath "<CLAUDE_PRODUCT_ROOT>" | Out-Null
   New-Item -ItemType Directory -Force -LiteralPath "<CODEX_PRODUCT_ROOT>" | Out-Null
   $env:CLAUDE_CONFIG_DIR = "<CLAUDE_PRODUCT_ROOT>"
   node scripts/aaa.mjs register --surface claude --profile <PROFILE> --package-root "<PACKAGE_ROOT>" --dry-run --format json

   $env:CODEX_HOME = "<CODEX_PRODUCT_ROOT>"
   node scripts/aaa.mjs register --surface codex --profile <PROFILE> --package-root "<PACKAGE_ROOT>" --dry-run --format json
   ```

   POSIX shell on macOS:

   ```sh
   mkdir -p "<CLAUDE_PRODUCT_ROOT>" "<CODEX_PRODUCT_ROOT>"
   export CLAUDE_CONFIG_DIR="<CLAUDE_PRODUCT_ROOT>"
   node scripts/aaa.mjs register --surface claude --profile <PROFILE> --package-root "<PACKAGE_ROOT>" --dry-run --format json

   export CODEX_HOME="<CODEX_PRODUCT_ROOT>"
   node scripts/aaa.mjs register --surface codex --profile <PROFILE> --package-root "<PACKAGE_ROOT>" --dry-run --format json
   ```

The `register` action accepts one surface and one package root. It uses
`CLAUDE_CONFIG_DIR` or `CODEX_HOME`. For Antigravity, the repository variable
`AAA_ANTIGRAVITY_ROOT` moves only the `GEMINI.md` destination; the `agy`
commands still act on the live product, so that variable does not make
`register --apply` a safe preview. The CLI does not accept a guessed
`--product-root` option.

Registration checks package consistency, not package origin or signature. It
checks the supplied managed state, requested surface, requested profile, and
owned file hashes before any write or native command. For a package rendered by
`install --surface all`, register one surface at a time and pass its matching
child package, such as `<ROOT>/claude`. Registration reads the namespaced state
from `<ROOT>/.all-about-agents/state.json`. Missing, mismatched, or changed
state fails closed. Review the Git source and commit before you trust a package.

## Native actions by product

### Antigravity (`agy`)

The plan deploys one file into the Gemini home and then registers the plugin:

```text
agy plugin validate "<PACKAGE_ROOT>"
agy plugin install "<PACKAGE_ROOT>"
agy plugin list
```

`agy plugin install` takes a plain directory. Unlike Codex it does not clone the
source, so `<PACKAGE_ROOT>` needs no Git repository.

`GEMINI.md` is the only deployed file, and it is **not** overwritten. It carries
`guard: "no-clobber"`. A live `~/.gemini/GEMINI.md` can hold always-on sections
this package does not own, and the Antigravity render is not a superset of them
the way `CLAUDE.md` is. So an existing file is complete when it already contains
the managed body as one contiguous block, after line endings and trailing
whitespace are normalized; your own sections before or after it stay. When the
body is missing or one of its lines was edited, the action reports
`manual-required`, writes nothing, and the report ends `manual-required` with
exit code 1 and error code `manual-step-required`. Merge the managed body by
hand.

No hooks and no status line are registered. No session-start event can be
named for this surface with current evidence, so the routing contract is
inlined into `GEMINI.md` instead of injected. See
[the product contract evidence](../evaluations/research-antigravity.md).

`agy plugin list` output is `registered` evidence. There is no separate trust
step. For `active` and `runtime verified`, start a fresh session **from a
directory that has no `.agents/` folder**; inside a workspace that carries its
own copy of the package, a correct answer cannot say which copy was loaded.

Antigravity Desktop is not registered by this plan. Copy `plugin.json`,
`skills/`, and `agents/` into `<workspace>/.agents/plugins/all-about-agents/`
and verify by asking Desktop directly; it has no headless mode.

The installed plugin is a copy and does not follow later renders. Re-run
registration after every package update.

### Claude Code

The fixed registration plan first overwrites these approved files in
`CLAUDE_CONFIG_DIR`:

```text
CLAUDE.md
all-about-agents/statusline.json
statusline/statusline.mjs
statusline/track-tool.mjs
statusline/statusline.ps1
statusline/statusline.sh
```

`CLAUDE.md` has no guard: the rendered file replaces the existing one.

`settings.json` is not one of them. It is a shared product file that the user
and other tools also write, so the plan merges into it instead of replacing it.
Objects merge key by key: keys the package declares win, and every other key
in the existing file is preserved. An array the package declares replaces the
existing array, except `permissions.allow` and `permissions.deny`. For those
two lists the plan keeps every existing rule in its order and appends each
package rule that is not already present, so your own rules survive and the
emergency denies are added once. A rule that a later package drops stays in
the file until you remove it. When your `permissions.allow` or
`permissions.deny` is not an array of non-empty strings, the plan writes
nothing to `settings.json` and the step reports `manual-required`; fix the
list by hand, then register again. Before the merge, only `statusLine.command`
in the rendered source is rebased to the selected `CLAUDE_CONFIG_DIR`; the
other rendered-source fields stay unchanged.

The POSIX runtime files keep executable mode. A file whose bytes already match
but whose mode differs is written again to restore the mode. The approved files
listed above are overwritten without a backup, as required by this repository
policy.

The plan also copies the rendered rules into
`<CLAUDE_CONFIG_DIR>/rules/all-about-agents/`: one `<rule>.md` file for each
core rule, and `presentation.md`, the presentation catalog. The Claude Code
memory documentation says: "All `.md` files are discovered recursively, so you
can organize rules into subdirectories"
([Claude Code memory](https://code.claude.com/docs/en/memory.md); quote
verified by the coordinator on 2026-09-27, not fetched by this repository's
checks). So this package owns that one subfolder and never writes a file
directly in `<CLAUDE_CONFIG_DIR>/rules/`, where the user and other tools keep
their own rules:

- A missing rule file is written.
- A differing rule file in `rules/all-about-agents/` is overwritten without a
  backup, because the folder belongs to this package. A package update
  therefore replaces its old rules.
- An identical rule file is left as it is.
- Any other entry in `rules/all-about-agents/`, such as a rule that a later
  package no longer renders, is never deleted. One `manual-required` step,
  `claude-rules-extra-files`, names it. Claude Code still loads such a `.md`
  file, so review and remove it by hand.
- When `rules` or `rules/all-about-agents` is a symlink, junction, or not a
  folder, or a rule file there is a link or not a regular file, no rule file is
  written. One `manual-required` step, `claude-rules-deploy`, names it, and the
  rest of the registration still runs.

A package without `rules/all-about-agents/presentation.md` fails before any
write with `package-source-unowned`. Whether a session loads these rules is an
`active` check, not a registration result.

It then performs these native actions:

```text
claude plugin marketplace add "<PACKAGE_ROOT>" --scope user
claude plugin install all-about-agents@all-about-agents --scope user
claude plugin list --json
```

Claude loads the plugin from a cache folder keyed by the plugin version, not
from `<PACKAGE_ROOT>`. An install with an unchanged version does not refresh
that copy, so a removed or changed skill can stay loaded. After the list
command, the plan runs `claude-plugin-cache-check`. It reads `installPath` from
the `claude plugin list --json` output. That folder must sit below
`<CLAUDE_CONFIG_DIR>/plugins/cache`. The check compares it with the package:

- Every managed file must be present and equal.
- Every other file is drift, except these runtime files: anything under
  `.in_use/` (Claude in-use markers), anything under `hooks/audit/` and
  `hooks/checkpoints/` (logs the package hooks write), and
  `.all-about-agents/state.json`.
- A symlink is never followed. A linked folder counts as drift, and a managed
  file whose real folder is outside the copy counts as drift and is not read.

When the copy differs, cannot be read, or the output names no comparable copy,
the check reports `manual-required` and lists these commands:

```text
claude plugin uninstall all-about-agents@all-about-agents --scope user --keep-data
claude plugin install all-about-agents@all-about-agents --scope user
```

Run them with the same `CLAUDE_CONFIG_DIR`, then run `register --apply` again.

You can also run the product validator from the package root:

```text
claude plugin validate . --strict
```

The validator result is `validated`. Marketplace and plugin output is
`registered` evidence only when discovery is observed. Restart Claude Code or
reload the plugin before checking `active` or `runtime verified`. The generated
settings include the native statusline command and the install-time display
name. An authenticated session is needed for a model or hook claim.

### Codex CLI

Codex clones a local marketplace source. If `<PACKAGE_ROOT>` is a newly
rendered folder and is not already a Git repository, prepare only that folder.

Warning: the following Git commands write metadata only inside the reviewed
`<PACKAGE_ROOT>`. Never run them on an unreviewed existing repository.

```text
git -C "<PACKAGE_ROOT>" init
git -C "<PACKAGE_ROOT>" add -A
git -C "<PACKAGE_ROOT>" -c user.name=all-about-agents -c user.email=all-about-agents@invalid.example commit -m "Prepare local Codex plugin source"
```

The registration plan first overwrites `AGENTS.md`, the template-only
`terra-max.config.toml`, and all seven `agents/*.toml` files in `CODEX_HOME`.
It then runs the native commands, so a later config copy cannot erase
product-written plugin metadata.

`config.toml` is handled differently. Codex writes its own `[marketplaces.*]`
and `[plugins.*]` tables there, and users add MCP servers and sandbox settings,
so the plan refuses to replace an existing file. When `config.toml` is absent
the managed file is written. When it exists and differs, the step reports
`manual-required` only when the file lacks managed content. The check splits
the managed file into tables: each `[header]` line with its key lines, plus the
top-level keys before the first header. It compares lines exactly after
trimming whitespace and skips blank lines. The file is complete when every
managed table is present with all of its key lines, in any order; Codex's own
`[marketplaces.*]`, `[plugins.*]`, and `[features]` tables and your extra tables
or keys may stay. Otherwise the reason names the missing or changed tables, for
example `[agents.reviewer]` or `top-level keys`: copy them across by hand. This
is a line check, not a TOML parser, and this repository has no TOML writer, so
it never merges that file for you. A refusal ends the report as
`manual-required` with exit code 1 and error code `manual-step-required`.

The native commands use the current structured CLI forms:

```text
codex plugin marketplace add "<PACKAGE_ROOT>" --json
codex plugin add all-about-agents@all-about-agents --json
codex plugin list --available --json
```

Codex serves a Git clone of `<PACKAGE_ROOT>`, so a new render reaches Codex
only through a new commit in that folder. After the native commands, the plan
runs `codex-plugin-source-check` in `<PACKAGE_ROOT>`. It writes nothing. It
removes inherited `GIT_*` variables from the git environment and passes
`-c core.fsmonitor=false` to each git call, so no fsmonitor hook runs. The
`codex plugin` commands also run without inherited `GIT_*` variables, so the
clone Codex makes cannot be redirected by a `GIT_DIR` set in a git hook.

1. `git rev-parse --show-prefix` must print an empty prefix. The package root
   must be its own Git repository, not a folder inside a larger repository.
   When it is not, the check reports `manual-required` with no commands.
   Prepare the folder with the Git commands at the start of this section.
2. `git --no-optional-locks status --porcelain --untracked-files=all -- .`
   must print nothing. When the working tree differs from `HEAD`, the check
   reports `manual-required` and lists these commands:

```text
git -C '<PACKAGE_ROOT>' status --short
git -C '<PACKAGE_ROOT>' add -A
git -C '<PACKAGE_ROOT>' -c user.name=all-about-agents -c user.email=all-about-agents@invalid.example commit -m "Update local Codex plugin source"
codex plugin remove all-about-agents@all-about-agents --json
codex plugin add all-about-agents@all-about-agents --json
```

Registration never commits for you. Read the `git status --short` output
before `git add -A`, run the commands with the same `CODEX_HOME`, then run
`register --apply` again. The check cannot see a commit that Codex has not
cloned yet, so run the remove and add commands after every new commit.

`plugin list --available --json` must show the registered package. That result
is `registered`; it is not proof that hooks are `trusted`, `active`, or
`runtime verified`.

After a new or changed hook package, inspect `/hooks` in Codex. Trust is a
separate product action when Codex requests it. Do not call a hook automatic.
Use `gpt-5.6-sol` with `max` as the primary template policy. Select the
`terra-max` profile or `gpt-5.6-terra` with `max` only as an explicit recovery
choice. No automatic model fallback is claimed.

## Apply registration

Warning: `register --apply` runs native registration actions and may write a
product root. It is a separate mutation from package install. Run it only
after exact user authority, an exact disposable or approved product root, and
a reviewed dry-run report.

1. Set the isolated product root in PowerShell, then register Claude or Codex.

   ```powershell
   New-Item -ItemType Directory -Force -LiteralPath "<CLAUDE_PRODUCT_ROOT>" | Out-Null
   New-Item -ItemType Directory -Force -LiteralPath "<CODEX_PRODUCT_ROOT>" | Out-Null
   $env:CLAUDE_CONFIG_DIR = "<CLAUDE_PRODUCT_ROOT>"
   node scripts/aaa.mjs register --surface claude --profile <PROFILE> --package-root "<PACKAGE_ROOT>" --apply --format json

   $env:CODEX_HOME = "<CODEX_PRODUCT_ROOT>"
   node scripts/aaa.mjs register --surface codex --profile <PROFILE> --package-root "<PACKAGE_ROOT>" --apply --format json
   ```

2. On macOS, set the isolated product root in a POSIX shell, then
   register Claude or Codex.

   ```sh
   mkdir -p "<CLAUDE_PRODUCT_ROOT>" "<CODEX_PRODUCT_ROOT>"
   export CLAUDE_CONFIG_DIR="<CLAUDE_PRODUCT_ROOT>"
   node scripts/aaa.mjs register --surface claude --profile <PROFILE> --package-root "<PACKAGE_ROOT>" --apply --format json

   export CODEX_HOME="<CODEX_PRODUCT_ROOT>"
   node scripts/aaa.mjs register --surface codex --profile <PROFILE> --package-root "<PACKAGE_ROOT>" --apply --format json
   ```

3. Restart or reload the product.

The apply report can say `complete` even when native semantic discovery still
needs a separate probe. Record the lifecycle state from observed product
output. A failed action reports `registered: fail` or a partial result. It does
not claim rollback or a backup.

The report says `manual-required` when the Claude plugin cache or the Codex
source clone can still differ from the package. The command then exits with
code 1 and reports `registered: fail`. The check action lists the exact
commands. Run them, then run `register --apply` again until the report says
`complete`.

The Claude steps `claude-rules-deploy`, `claude-rules-extra-files`, and a
refused `claude-settings-deploy`, and a no-clobber file (`GEMINI.md` or the
Codex `config.toml`) that lacks managed content, also end the report as
`manual-required` with exit code 1 and error code `manual-step-required`. The other actions still run, and
`registered` is not changed. Do the named step by hand, then register again.
`CLAUDE.md` has no guard and is overwritten, so it never causes this.

## Boundaries

`register --dry-run` is allowed during review. `register --apply` must never be
run by `git pull`, a quality check, `doctor`, or a normal install dry-run.
Missing products, credentials, or macOS are `NOT_RUN_UNAVAILABLE`, not passes.
Trust that is available but not exercised is `NOT_RUN`. Use
[native verification](native-verification.md) for the evidence record.
