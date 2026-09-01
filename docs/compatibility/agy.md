# agy CLI compatibility

`agy` is the Antigravity CLI surface. The observed runtime is agy `1.1.22` on
Windows. T07 disposable checks passed package validation for both profiles,
28 skills, 7 agents, 1 hook, the Windows statusline command for both fixture
profiles, and exact model discovery. The POSIX launcher rendered but did not
run on macOS. Plugin installation, settings merge, and runtime skill use remain
`NOT_RUN`.

## Lifecycle and support

Use these states in order:

```text
rendered -> validated -> registered -> trusted -> active -> runtime verified
```

The validator proves `validated` package shape. It does not prove that a
plugin is `registered`, `trusted`, `active`, or `runtime verified`.

| Capability | Current evidence | Boundary |
| --- | --- | --- |
| Plugin package, skills, agents, and hooks | Both packages validated with 28 skills, 7 agents, and 1 hook | Runtime skill and hook behavior are not claimed. |
| Plugin registration | Supported by reviewed and authorized `register --apply` | Rendering, normal install, and `git pull` do not register it. Apply runs `agy plugin install` and `agy plugin list`; reload and runtime observation stay manual. |
| Settings | Sparse overlay rendered; authorized `register --apply` can merge it | No live settings file was written or merged in the retained native evidence. Unknown settings are preserved. |
| Statusline and display name | Native `statusLine` block and Windows/POSIX launchers render; both Windows fixture profiles passed | POSIX/macOS runtime, a live TUI session, and persistence are not claimed. |
| Model and effort | `agy models` listed `gemini-3.7-flash-high`; help documented `high` | Model use needs a fresh native session. |

The statusline reads native JSON from stdin and emits one bounded text line. The
install command accepts `--statusline-name "<YOUR_NAME>"` for the shared
display-name input. The name is trimmed, limited to 64 Unicode code points,
and rejects control and ANSI characters.

## Model, permissions, and headless arguments

The exact model policy is `gemini-3.7-flash-high` with `high` effort. The
template profile records per-run full access with:

```text
agy -p <PROMPT> --model gemini-3.7-flash-high --effort high --dangerously-skip-permissions
```

The prompt is one structured process argument. Do not rebuild it as a shell
command string. If `agy models` does not list the slug, stop and retry with an
exact operator-selected slug or omit `--model`. No automatic model fallback is
claimed.

Native action mapping is unsupported without a product contract.

Full access does not remove the emergency denies for destructive erasure,
`sudo`, writes into `.git/`, and writes into `/home/user/.ssh`. Hook files are
disabled and inert because command-root and failure behavior are not verified.

## Roots and registration

The only documented settings destination is:

```text
~/.gemini/antigravity-cli/settings.json
```

The documented staged plugin root is:

```text
~/.gemini/antigravity-cli/plugins/<plugin_name>/
```

The settings artifact is a sparse overlay. Rendering does not write it. Review
the dry-run before apply. An authorized `register --apply` merges it and
preserves unknown settings; it is not a direct replacement file.

Warning: `register --apply` may install a plugin and merge settings in the
documented agy product root. Use a new disposable root where the product
supports it, and use exact authority before applying.

```text
node scripts/aaa.mjs register --surface agy --profile <PROFILE> --package-root "<PACKAGE_ROOT>" --dry-run --format json
node scripts/aaa.mjs register --surface agy --profile <PROFILE> --package-root "<PACKAGE_ROOT>" --apply --format json
```

The fixed native commands are:

```text
agy plugin validate "<PACKAGE_ROOT>"
agy plugin install "<PACKAGE_ROOT>"
agy plugin list
```

Restart the TUI after a package or settings change. Record `registered`,
`trusted`, `active`, and `runtime verified` only from observed product output.

## Limits

The disposable checks did not run live plugin installation, runtime skill
invocation, settings merge, model persistence, hook execution, authenticated
requests, or macOS execution. `agy agents` was inconclusive when it printed no
rows. These checks remain `NOT_RUN` or `NOT_RUN_UNAVAILABLE`.

Use [native registration](../maintenance/native-registration.md),
[native verification](../maintenance/native-verification.md), and the
[cross-tool quality guide](../maintenance/cross-tool-quality.md). See
[known limitations](../limitations/known-limitations.md).
