# Legacy quarantine

This directory contains historical repository artifacts that are retained for
audit and migration evidence. Nothing below `quarantine/legacy/` is an active
installer input, generated package input, fallback source, or supported setup
entrypoint. Canonical behavior lives under [`core/`](../core/), is translated
by [`adapters/`](../adapters/), and is applied by [`installers/`](../installers/).

The quarantine is not a backup. It is version-controlled evidence of why a
legacy surface was retired. Do not copy these files into a live product root.

## Disposition register

| Original path | Replacement path | Failed legacy behavior | Replacement evidence | Removal eligibility |
| --- | --- | --- | --- | --- |
| `agents/` | `quarantine/legacy/agents/` | Mixed Markdown/JSON role definitions duplicated policy and could claim tools a target did not support. | [`core/roles/`](../core/roles/) is the vendor-neutral source; adapter role contracts and role tests verify surface-specific output. | Remove only after the retention policy permits it and native Gate 2 evidence confirms no consumer reads the old path. |
| `configs/` | `quarantine/legacy/configs/` | Tracked local overlays embedded stale role, permission, and product-specific assumptions. | [`profiles/`](../profiles/) plus surface manifests and adapter settings render the approved portable/template policies. | Remove after all supported surfaces have native Gate 2 evidence and no migration reader references the files. |
| `hooks/` | `quarantine/legacy/hooks/` | Old launchers coupled product events, shell assumptions, and mutable status tracking outside the canonical hook contract. | [`core/hooks/`](../core/hooks/) and adapter hook templates are covered by parser, safety, contract, and integration tests. | Remove after native hook execution is observed on every available surface and the historical fixtures are no longer required. |
| `setup/` | `quarantine/legacy/setup/` | Legacy scripts performed coupled product-specific mutation and documented stale paths. | [`scripts/aaa.mjs`](../scripts/aaa.mjs), [`installers/`](../installers/), and the [setup guides](../docs/setup/windows.md) provide dry-run-first, explicit-root, atomic behavior. | Remove after migration documentation no longer needs the historical commands and native Gate 2 evidence exists. |
| `statusline/` | `quarantine/legacy/statusline/` | Standalone scripts bypassed adapter ownership, current sanitization, and installer preflight. | The Claude adapter owns generated statusline files; setup docs define `--statusline-name`, Node.js prerequisites, and unsupported surfaces. | Remove after native Claude statusline observation and completion of the repository retention period. |
| `skills/` | `quarantine/legacy/skills/` | Root copies duplicated canonical skills and previously allowed silent fallback from missing canonical companions. | [`core/skills/`](../core/skills/) is now the only loader source. Fifteen required companions were promoted there, and the core-only manifest test rejects legacy fallback. | Remove when no audit or migration consumer needs the historical bodies and all native skill-discovery gates are recorded. |
| `.claude-plugin/` | `quarantine/legacy/.claude-plugin/` | The checked-in manifest and marketplace described the old root package; after canonical migration, the active `source: "./"` no longer had a paired root plugin. | The Claude adapter renders matching `.claude-plugin/plugin.json` and `marketplace.json` files inside each generated package; strict Claude Code 2.1.248 validation passed on the disposable T051 package. | Remove after the historical registration metadata is outside the retention window and no migration consumer remains. |
| `docs/antigravity.md` | `quarantine/legacy/docs/antigravity.md` | The single legacy guide mixed Desktop and CLI behavior and referenced retired setup scripts. | [Antigravity 2.0 compatibility](../docs/compatibility/antigravity-2.md), [agy compatibility](../docs/compatibility/agy.md), and the platform setup guides separate confirmed, manual, unknown, and unsupported behavior. | Remove after the new documentation has completed its retention window and no inbound links remain. |

## Generated metadata boundary

The repository root no longer advertises an incomplete Claude marketplace.
Each generated Claude package contains a matching plugin manifest and local
marketplace with `source: "./"`. Native registration remains a manual two-step
operation: add that generated directory as a marketplace, then install the named
plugin. Strict manifest validation is evidence about package structure only; it
does not prove native discovery, hook execution, or model behavior.

## Removal gate

A quarantined artifact may be deleted only when all of these are true:

1. `core/inventory.json` no longer needs it as audit evidence.
2. Repository search finds no active loader, adapter, installer, test, or
   documentation consumer outside the quarantine record.
3. Its replacement passes static, contract, integration, snapshot, and
   security checks.
4. Any available native product passes Gate 2 discovery/behavior validation;
   unavailable products remain explicitly `NOT_RUN_UNAVAILABLE`.
5. The removal is separately reviewed and authorized.
