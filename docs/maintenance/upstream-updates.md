# Reviewed upstream updates

AAA keeps a portable canonical core and managed adapters. It adapts selected
upstream ideas; its version is not an upstream version. Loading, rendering,
and installing never fetch or update upstream content automatically.

## Reviewed baselines

Reviewed on 2026-10-20:

| Source | Baseline | Resolved commit |
| --- | --- | --- |
| [obra/superpowers](https://github.com/obra/superpowers) | v7.0.0 | `bb92a77741419a4ab5f06e711a283343f1ada0c3` |
| [mattpocock/skills](https://github.com/mattpocock/skills) | main, manifest 1.3.1 | `5beb35b040e3de97e54fa9e386d7e42d15c295c2` |
| Matt published release | v1.3.1 | `24fe0ef7737efae15c87225755e9f6f5965e4888` |

Matt's main includes work after the release tag. An annotated tag object is
not a commit. Superpowers v7.0.0 has tag object
`7f043e5eaf3522dc19178c673b76328de9b0c355`; its peeled commit is the baseline
above. Record resolved commits, not tag objects, in
[`core/upstreams.json`](../../core/upstreams.json).

## Check and compare

Read public heads and tags without changing this checkout:

```text
git ls-remote https://github.com/obra/superpowers.git HEAD refs/heads/main refs/tags/v7.0.0 "refs/tags/v7.0.0^{}"
git ls-remote https://github.com/mattpocock/skills.git HEAD refs/heads/main refs/tags/v1.3.1 "refs/tags/v1.3.1^{}"
```

For a later review, inspect the current tag list and choose a ready baseline;
do not assume these versions stay latest. Compare source in a separate,
disposable checkout at the exact resolved commit. Check that checkout's HEAD
and every claimed source path. Read upstream files as data. Do not execute
downloaded scripts or import an entire `in-progress` or `misc` directory.

Before editing, record current Git state and preserve unrelated changes.
Compare real canonical skills, companions, callers, tests, and routing cases.
Keep one disposition for every current canonical skill: `adapted`, `retained`,
or `local-only`. Record upstream source paths and a concrete reason for each
adaptation or retention. A local-only record explains why no ready equivalent
replaces that workflow. Retention does not require a cosmetic rewrite.

Keep the current core/adapters/installers split, model and effort policy,
access mode, emergency denies, session language, and selected companion tools.
Natural-language discovery and explicit opt-in remain deliberate local
contracts; they do not claim upstream native invocation flags. Do not add a
second router, executor, tracker, updater, or telemetry system.

## Import, attribution, and proof

1. Use [skill development](skill-development.md) and `writing-skills`. Define
   trigger, nontrigger, pressure, authority, and output cases before changing
   guidance. Observe the focused RED result, make the smallest change, and
   record GREEN. Lint checks are not model behavior evidence.
2. Update canonical content, evaluation cases, inventory, provenance, and
   directly coupled tests together. Preserve legacy `CONTEXT.md` and original
   artifacts. Create glossary or ADR records only when real domain work needs
   them and the task owns that change.
3. Preserve source attribution. The root [LICENSE](../../LICENSE) includes
   Jesse Vincent's 2025 MIT notice, Matt Pocock's 2026 MIT notice, and the local
   notice. Each managed plugin package must deliver those exact bytes. Keep
   [PR credits](../../core/skills/pr/CREDITS.md) for Dex Horthy as well.
4. Bump `package.json`, add the dated `WhatsNew.md` entry, and update current
   counts and links. Regenerate snapshot projections from actual renderers
   with each test's exact home, platform, profile, statusline, and environment
   inputs. Render twice and compare file bytes and ownership; never invent
   hashes or drop files to make a snapshot pass.

Run the focused checks, then the repository gates:

```text
node --test tests/contracts/upstreams.test.mjs tests/contracts/package-notices.test.mjs
npm run quality:skill -- <skill-name>
node scripts/aaa.mjs validate --scope all
node --test tests/contracts/antigravity-adapter.test.mjs tests/contracts/claude-adapter.test.mjs tests/contracts/codex-adapter.test.mjs tests/contracts/complete-skill-manifest.test.mjs
node --test tests/static/documentation.test.mjs tests/static/maintenance-docs.test.mjs
npm run sync:status
npm run quality:quick
npm run quality:full
```

## Separate native qualification

Source review, lint, rendering, and disposable-package checks have distinct
limits. Report changed paths, exact commands and results, preserved divergences,
and checks not run. Fresh authenticated model cases are separate from static
checks. Windows source checks do not establish macOS or native product behavior.

Keep lifecycle order: rendered, validated, registered, trusted, active, runtime
verified. Record unavailable model, macOS, CLI, Desktop, or IDE checks as
`NOT_RUN_UNAVAILABLE` with a later owner. Never infer native success from a
snapshot. Follow [cross-tool quality](cross-tool-quality.md) and
[native verification](native-verification.md).

An upstream review does not authorize commit, push, merge, installation,
registration, or live configuration changes. Git actions stay separate from
native actions. A pull does not install anything. Use `register --dry-run` for
review; `register --apply` needs exact authority and a reviewed report.
