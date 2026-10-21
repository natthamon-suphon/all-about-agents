# Skill and agent routing guide

## Approved result

The owner chose short routing rules for every skill and agent, each linked to
a detailed guide in easy English. Include the routing rules in global
`CLAUDE.md` as well as the existing Codex and Antigravity instruction paths.
This conversation authorizes repository implementation and checks. It does
not authorize installation, live configuration, commit, or push.

## Design and constraints

Reuse skill descriptions and role dispatch criteria from `loadCore`; do not
maintain a second trigger catalog. Render a short routing section from those
records. Keep the existing bootstrap and all trigger, authority, model,
permission, and emergency-deny contracts unchanged.

Keep one detailed source at `docs/reference/skills-and-agents.md`. Ship its
bytes at `all-about-agents/skills-and-agents.md` in every package. Native
registration uses the existing contained, source-hash-checked file deployment
to copy that guide beside the global instruction file. The guide is outside
always-loaded rule folders. Its anchors are stable `skill-<id>` and
`agent-<id>` headings. No dependency or network access is needed to read it.

Claude inlines the short routing rules in its global file. Codex uses a
compact `AGENTS.md` entry linked to `all-about-agents/skill-agent-routing.md`.
The full generated index is copied beside the detailed guide by native
registration. This review-driven adjustment preserves space for user and
project instructions under the default 32 KiB combined budget.
Antigravity keeps its rules in its existing always-on rule file, with a
pointer in `GEMINI.md`, to preserve its 12,000-byte instruction budget and
24,000-byte rule limit. Links in staged global files are relative to their
native deployment destination. Test the projected native layout as well as
the package bytes.

The current normal checkout is `main` at `07b3c05`. Preserve the untracked
`.agents/` directory. Work stays in this checkout; no Git state changes.

## File ownership

- `docs/reference/skills-and-agents.md`: complete skill and agent guide.
- `adapters/shared/global-instructions.mjs`: guide constants and routing render.
- `adapters/{claude,codex,antigravity}/adapter.mjs`: package the same guide.
- `installers/lib/native-registration.mjs`: required owned guide and deployment.
- `tests/contracts/skill-agent-routing.test.mjs`: public render, links, coverage,
  determinism, Markdown escaping, and native-layout contracts.
- `tests/contracts/native-registration.test.mjs`: deployment, hash and safe-path
  checks using disposable roots only.
- `tests/contracts/claude-adapter.test.mjs`: updated global-file shape contract.
- `tests/snapshots/{claude,codex,antigravity}/*.json`: actual renderer output.
- `README.md`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and
  `docs/maintenance/global-instructions.md`: navigation and deployment facts.
- `.aaa/skill-agent-routing-2026-10-21/state.md`: local execution evidence.

## Execution

### T1: Guide and public routing output

Consume `loadCore(root)` records. Extend the existing global renderer seam;
return deterministic Markdown and reject absent descriptions or role routing
criteria rather than silently omitting an entry. Escape Markdown table text.

Write a test against the existing renderers before production edits. Run
`node --test tests/contracts/skill-agent-routing.test.mjs`; expect RED because
the routing section is absent. Add the guide and renderer. Expect GREEN for
all 31 skills and seven agents, exact anchors, unchanged bootstrap, and both
profiles on Windows and macOS. Guide sections explain purpose, use, non-use,
inputs, outputs, steps, example, limits, and neighboring routes.

### T2: Package and native guide delivery

Consume the same guide bytes and existing registration planner. Add the
guide to every package and require it in managed package ownership. Deploy
to the instruction root through the existing file-copy action.

Add the missing-guide/deployment tests before changing production code. Run
`node --test tests/contracts/native-registration.test.mjs`; expect the new
guide assertion to fail. Extend the existing deployment path and rerun.
Check source tampering, unsafe destination links, operator neighbors, and
repeat-run stability. Use only disposable product roots and fake product
commands. A static/disposable pass does not prove native activation.

### T3: Navigation and full verification

Link all three repository entrypoints and README to the guide. Document
global routing carriers and the new owned guide. Regenerate snapshots twice
from their pinned actual renderer inputs and compare bytes. Run focused
adapter/routing/registration/documentation tests, `npm run sync:status`,
`npm run quality:quick`, `npm run quality:full`, and `git diff --check`.
Obtain an independent read-only review and resolve material findings.

## Completion and limits

Report exact checks, branch and dirty state. Keep installation and native
runtime/model qualification `not run`: this task does not authorize them.
Guide text and render tests cannot prove model routing decisions. Do not
claim behavior is perfect or native products loaded these changes.

## Self-review

The plan covers both owner choices. It adds no second bootstrap or second
trigger source. Its new file uses the existing deployment protection rather
than another installer. The main failure risks are stale guide coverage,
broken anchors after deployment, oversized always-on text, and accidental
native claims; focused tests and the final evidence record own these risks.
