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
`<CLAUDE_CONFIG_DIR>/CLAUDE.md` and `<CODEX_HOME>/AGENTS.md`.

An authorized apply may overwrite these managed global files without a backup.
It must not guess a product root or replace unknown neighboring files.

## Product binaries must resolve first

The native steps of `register --apply` spawn `claude` and `codex` by bare
name. Rendering and package apply never call them. When a binary does not
resolve, the plan still copies its managed files and then fails the native
commands, which leaves a package that looks installed but that the product
does not know about. Verify discovery with each product's own command before
you register:

```text
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

   POSIX shell on macOS or Linux:

   ```sh
   mkdir -p "<CLAUDE_PRODUCT_ROOT>" "<CODEX_PRODUCT_ROOT>"
   export CLAUDE_CONFIG_DIR="<CLAUDE_PRODUCT_ROOT>"
   node scripts/aaa.mjs register --surface claude --profile <PROFILE> --package-root "<PACKAGE_ROOT>" --dry-run --format json

   export CODEX_HOME="<CODEX_PRODUCT_ROOT>"
   node scripts/aaa.mjs register --surface codex --profile <PROFILE> --package-root "<PACKAGE_ROOT>" --dry-run --format json
   ```

The `register` action accepts one surface and one package root. It uses
`CLAUDE_CONFIG_DIR` or `CODEX_HOME`. The CLI does not accept a guessed
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
`guard: "no-clobber"`: when the destination exists and differs from the managed
source, the action reports `manual-required` and writes nothing. A live
`~/.gemini/GEMINI.md` can hold always-on sections this package does not own, and
the Antigravity render is not a superset of them the way `CLAUDE.md` is. Merge
the managed body by hand when that happens.

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
all-about-agents/statusline.json
statusline/statusline.mjs
statusline/track-tool.mjs
statusline/statusline.ps1
statusline/statusline.sh
```

`settings.json` is not one of them. It is a shared product file that the user
and other tools also write, so the plan merges into it instead of replacing it.
The merge is a deep merge: keys the package declares win, and every other key
in the existing file is preserved. Before the merge, only
`statusLine.command` in the rendered source is rebased to the selected
`CLAUDE_CONFIG_DIR`; the other rendered-source fields stay unchanged.

The POSIX runtime files keep executable mode. The approved files listed above
are overwritten without a backup, as required by this repository policy.

It then performs these native actions:

```text
claude plugin marketplace add "<PACKAGE_ROOT>" --scope user
claude plugin install all-about-agents@all-about-agents --scope user
claude plugin list --json
```

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
`manual-required` and names the file: copy the managed `[agents.*]` tables and
the model keys across by hand. This repository has no TOML writer, so it cannot
merge that file safely.

The native commands use the current structured CLI forms:

```text
codex plugin marketplace add "<PACKAGE_ROOT>" --json
codex plugin add all-about-agents@all-about-agents --json
codex plugin list --available --json
```

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

2. On macOS or Linux, set the isolated product root in a POSIX shell, then
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

## Boundaries

`register --dry-run` is allowed during review. `register --apply` must never be
run by `git pull`, a quality check, `doctor`, or a normal install dry-run.
Missing products, credentials, or macOS are `NOT_RUN_UNAVAILABLE`, not passes.
Trust that is available but not exercised is `NOT_RUN`. Use
[native verification](native-verification.md) for the evidence record.
