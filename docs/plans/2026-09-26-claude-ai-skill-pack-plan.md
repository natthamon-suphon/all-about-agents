# claude.ai skill pack — implementation plan

Spec: `docs/plans/2026-09-26-claude-ai-skill-pack.md`, accepted by the owner
on 2026-09-26.
Status: Tasks 1-11 executed on 2026-09-26. Evidence: `claude-ai/evals/results.md`.

## Goal

Build the six `aaa-*` claude.ai skills (spec section 5) plus the tooling to
validate and zip them. The tooling is:

- a pack validator
- a deterministic ZIP writer
- an export command
- tests wired into `quality:quick`

## Architecture

- `claude-ai/` holds the source: shared conventions, skill folders, and eval
  files.
- `scripts/lib/claude-ai-pack.mjs` holds the pure functions (parse, validate,
  ZIP) and one filesystem loader.
- `scripts/export-claude-ai.mjs` validates everything, then writes one ZIP per
  skill to `.aaa/claude-ai/`.
- Tests:
  - `tests/contracts/claude-ai-pack.test.mjs` covers the library and the export.
  - `tests/static/claude-ai-pack.test.mjs` covers the real pack content.

## Technology constraints

- Node >= 22.12. ES modules. Only `node:` built-ins. No dependencies
  (`package.json` keeps `dependencies: {}` and `devDependencies: {}`).
- Tests use `node:test` and `node:assert/strict`, like the other tests in
  `tests/`.
- All files are English, UTF-8, and LF. Paths inside ZIPs use forward slashes.

## Invariants

1. Export writes nothing when any skill fails validation.
2. The same source bytes always give the same ZIP bytes.
3. Export writes only `<outputDir>/<name>.zip`. It never deletes or rewrites
   any other path.
4. Every ZIP holds exactly one top-level folder, named after the skill, which
   contains `SKILL.md` and `references/conventions.md`.
5. `core/`, `adapters/`, `installers/`, and `profiles/` stay unchanged.

## Pre-conditions

- Working tree on `main` with the owner's uncommitted edit in
  `tests/static/repository-layout.test.mjs`. **No task touches that file.**
- `node --test tests/static/surface-scope.test.mjs` passes before Task 1.
- Baseline: run `npm run quality:full` once before Task 1 and keep its failing
  check list. `main` is known to be red on this Mac for reasons unrelated to
  this work, so only failures new since the baseline count as regressions.

## Non-goals

- Changes to core skills.
- Adapter or surface plumbing.
- Project instructions for claude.ai.
- The seven defects listed in spec section 11.
- Git actions of any kind.

## Failure behavior

| Case | Result |
| --- | --- |
| A skill fails validation | `exportPack` throws `PackValidationError`, which carries every error. The CLI exits 1 and writes no ZIP. |
| A path is invalid inside the ZIP (empty, absolute, `\`, `..`, duplicate) | `createZip` throws `TypeError`. |
| An archive exceeds ZIP32 limits | `createZip` throws `RangeError`. |
| `zlib.crc32` is missing | The library throws `Error("node:zlib crc32 is required (Node >= 22.2)")` when it loads. |
| The output directory is a symlink or a file | `exportPack` throws `Error` and writes nothing. |
| A skill file is a symlink | `loadPack` throws `Error`. |
| The CLI gets unknown arguments | Exit 2 with a usage line. |

## Authorization boundaries

- Allowed: create and modify the files in the file map.
- Not allowed:
  - Git actions (branch, stage, commit, push). Each one needs separate, exact
    owner authority.
  - Dependency installs.
  - Changes to live configuration.
  - Uploading to claude.ai. That is an owner step.

## Acceptance criteria

1. `node --test tests/contracts/claude-ai-pack.test.mjs tests/static/claude-ai-pack.test.mjs`
   passes.
2. `npm run export:claude-ai` writes exactly six ZIPs, `aaa-*.zip`, to
   `.aaa/claude-ai/`. A second run gives the same bytes; the SHA-256 printed
   per archive is identical.
3. `npm run quality:quick` passes, or each red check is reported with its
   output.
4. Each skill has a proxy RED result and a proxy GREEN result in
   `claude-ai/evals/results.md`.
5. The claude.ai runtime result is recorded per skill, or recorded as
   `NOT_RUN_UNAVAILABLE (owner run pending)`.

## Pre-mortem

| Risk | Guard |
| --- | --- |
| claude.ai rejects the ZIP format. | Task 5 has an owner-upload gate before any more skills are built. Task 2 also cross-checks with system `unzip -t` where it exists. |
| The ZIP reader in the test shares a bug with the writer. | The `unzip -t` cross-check is independent. |
| An unquoted YAML description breaks the claude.ai parser. | The `yaml-unsafe` rule in Task 1. |
| Content tasks drift from the spec. | Each skill has required-phrase checks in the static test, and proxy RED/GREEN runs. |
| The quality gate's fixed check-ID list breaks. | New test files join the existing `focused-contracts` and `static-contracts` checks. No new check ID is added. |

## Spec deviation (owner to note)

Spec section 9 said to edit `tests/static/repository-layout.test.mjs`. That
test only lists folders that must exist. It does not reject unknown folders,
so `claude-ai/` does not break it. The plan leaves that file untouched, which
also protects the owner's uncommitted edit there. The new static test checks
the `.gitignore` line instead. Task 11 updates spec section 9 to match.

## File map

| Path | Action | Responsibility |
| --- | --- | --- |
| `scripts/lib/claude-ai-pack.mjs` | Create | `parseSkillFile`, `validateSkill`, `createZip`, `buildSkillArchive`, `loadPack`, `PackValidationError` |
| `scripts/export-claude-ai.mjs` | Create | `exportPack`, `main` (CLI) |
| `tests/contracts/claude-ai-pack.test.mjs` | Create | library and export contracts |
| `tests/static/claude-ai-pack.test.mjs` | Create | real pack: conventions, skills, evals, `.gitignore` |
| `claude-ai/shared/conventions.md` | Create | shared rules (spec 4.3, 4.4) |
| `claude-ai/skills/aaa-interview/SKILL.md`, `references/topics.md`, `templates/interview-record.md` | Create | spec 5.1 |
| `claude-ai/skills/aaa-brief/SKILL.md`, `templates/brief.md` | Create | spec 5.2 |
| `claude-ai/skills/aaa-tasks/SKILL.md`, `templates/tasks.md` | Create | spec 5.3 |
| `claude-ai/skills/aaa-run/SKILL.md` | Create | spec 5.4 |
| `claude-ai/skills/aaa-review/SKILL.md`, `references/checklists.md`, `templates/review.md` | Create | spec 5.5 |
| `claude-ai/skills/aaa-research/SKILL.md`, `templates/research.md` | Create | spec 5.6 |
| `claude-ai/evals/aaa-<skill>.md` (x6) | Create | trigger, non-trigger, pressure, and behavior cases |
| `claude-ai/evals/results.md` | Create | dated proxy and claude.ai results |
| `scripts/quality-gate.mjs:21-46` (`QUICK_CHECKS`) | Modify | add the two test files to the existing checks |
| `tests/contracts/quality-gate.test.mjs:89-98` (`mutations`) | Modify | add a pack mutation row |
| `package.json` (`scripts`) | Modify | add `"export:claude-ai": "node scripts/export-claude-ai.mjs"` |
| `.gitignore` | Modify | add `.aaa/claude-ai/` |
| `docs/setup/claude-ai.md` | Create | build, upload, verify, lifecycle |
| `README.md` ("Maintain and share changes" list) | Modify | one link to the setup page |
| `WhatsNew.md` (`[Unreleased]` / `### Added`) | Modify | one entry |
| `docs/plans/2026-09-26-claude-ai-skill-pack.md` (status, section 9) | Modify | status and the deviation above |

## Shared types (used by all interfaces)

```text
PackFile      = { path: string /* relative, forward slashes */, bytes: Uint8Array }
PackSkill     = { name: string /* folder name */, files: PackFile[] /* sorted by path */ }
Pack          = { conventions: Uint8Array, skills: PackSkill[] /* sorted by name */ }
ValidationError = { code: string, path: string, message: string }
ZipEntry      = { path: string, bytes?: Uint8Array } /* path ending "/" = directory, no bytes */
Archive       = { name: string, fileName: string /* "<name>.zip" */, bytes: Uint8Array }
```

---

### Task 1: Skill parser and validator

**Files:**
- Create: `scripts/lib/claude-ai-pack.mjs`
- Create: `tests/contracts/claude-ai-pack.test.mjs`

**Interfaces:**
- Produces: `parseSkillFile(text: string): { frontmatter: Record<string, string>, body: string, errors: ValidationError[] }`
  - The frontmatter must open on line 1 with `---` and close with a later
    `---` line.
  - Every non-empty line in between is `key: value` on one line. Values in
    double or single quotes are unquoted.
  - On a missing or unclosed block, it returns `errors` with code
    `frontmatter-missing`.
- Produces: `validateSkill(skill: PackSkill): ValidationError[]`. An empty
  array means valid. It reads `SKILL.md` from `skill.files` and checks these
  codes:

  | Code | Rule |
  | --- | --- |
  | `skill-md-missing` | there is no `SKILL.md` at the folder root |
  | `frontmatter-missing` | from the parser |
  | `frontmatter-key` | a key other than `name` or `description` |
  | `frontmatter-line` | a non-empty line that is not `key: value` |
  | `name-format` | `name` fails `^aaa-[a-z0-9]+(-[a-z0-9]+)*$` or is over 64 characters |
  | `name-reserved` | `name` contains `claude` or `anthropic` |
  | `name-mismatch` | `name` differs from `skill.name` |
  | `description-length` | the unquoted description is shorter than 1 or longer than 200 characters |
  | `description-angle` | the description contains `<` or `>` |
  | `yaml-unsafe` | an unquoted value contains `": "` or `" #"`, or starts with one of ``[ ] { } & * ! \| > ' " % @ ` `` |
  | `body-lines` | the `SKILL.md` body has 500 or more lines |
  | `colon-prefix` | any file text matches `/\baaa:/` |
  | `absolute-path` | any file text matches `/(^|[\s("'\x60])(\/Users\/|\/home\/|[A-Za-z]:\\|~\/)/m` |
  | `broken-link` | a Markdown link target that is not `http(s):`, not `#…`, not in `skill.files`, and not `references/conventions.md` |
  | `reserved-file` | `skill.files` already has `references/conventions.md` |

  Each error's `path` is the relative file path inside the skill.

- [ ] Step 1: Write tests in `tests/contracts/claude-ai-pack.test.mjs`:
  - One valid in-memory fixture `aaa-demo` must return `[]`.
  - One test per code above builds a fixture with exactly that defect and
    asserts that code appears. Examples:
    - a `name: aaa-claude-x` fixture must give `name-reserved`
    - a 201-character description must give `description-length`
    - `[x](missing.md)` must give `broken-link`
    - `[x](references/conventions.md)` must NOT give `broken-link`
- [ ] Step 2: Run `node --test tests/contracts/claude-ai-pack.test.mjs`.
  Expected: RED with `ERR_MODULE_NOT_FOUND` for
  `scripts/lib/claude-ai-pack.mjs`.
- [ ] Step 3: Implement `parseSkillFile` and `validateSkill`, and nothing
  else.
- [ ] Step 4: Run `node --test tests/contracts/claude-ai-pack.test.mjs`.
  Expected: GREEN. All validator tests pass, 0 fail.

### Task 2: Deterministic ZIP writer and skill archive

**Files:**
- Modify: `scripts/lib/claude-ai-pack.mjs`
- Modify: `tests/contracts/claude-ai-pack.test.mjs`

**Interfaces:**
- Produces: `createZip(entries: ZipEntry[]): Uint8Array`
  - Entries are sorted by path with code-unit order.
  - Every entry has DOS time `0x0000` and date `0x0021` (1980-01-01).
  - General-purpose flag `0x0800` (UTF-8 names). Version needed is 20.
    Version made by is `0x0314` (Unix, 2.0).
  - Files use method 8 (`zlib.deflateRawSync`, level 9) and
    `zlib.crc32(bytes)`. External attributes are `(0o100644 << 16) >>> 0`.
    The `>>> 0` is required: `0o100644 << 16` alone is negative in JS, and
    `writeUInt32LE` would throw on it.
  - Directories use method 0 with size 0. External attributes are
    `(0o040755 << 16) | 0x10`.
  - Errors:
    - `TypeError` for an empty path, a leading `/`, any `\`, a `..` segment,
      or a duplicate path
    - `RangeError` above 65,535 entries or 4 GiB
- Produces: `buildSkillArchive(skill: PackSkill, conventions: Uint8Array): Archive`
  - Adds `<name>/` and every parent directory entry.
  - Adds every file as `<name>/<path>`.
  - Adds `<name>/references/conventions.md` with the bytes of `conventions`.
  - Throws `TypeError` if the skill already has `references/conventions.md`.
- Test helper (inside the test file only):
  `readZip(bytes: Uint8Array): Array<{ path: string, bytes: Uint8Array }>`.
  It parses the end-of-central-directory record, the central directory, and
  the local headers, then calls `inflateRawSync` and checks each CRC with
  `zlib.crc32`.

- [ ] Step 1: Add these tests:
  - `readZip(createZip(x))` round-trips two files plus one directory
    (paths and bytes match).
  - `createZip(x)` called twice gives identical bytes, also when the input
    order is reversed.
  - Each invalid path throws `TypeError`.
  - `buildSkillArchive` gives these entries, in this order: `aaa-demo/`,
    `aaa-demo/SKILL.md`, `aaa-demo/references/`,
    `aaa-demo/references/conventions.md`.
  - Independent cross-check: write the archive to a temp dir and run
    `spawnSync("unzip", ["-t", file])`. Expect exit 0 and output containing
    `No errors detected`. If `unzip` is not on the PATH (`error.code ===
    "ENOENT"`), call `t.skip("unzip unavailable")`.
- [ ] Step 2: Run `node --test tests/contracts/claude-ai-pack.test.mjs`.
  Expected: RED. The new tests fail with `createZip is not a function`
  (the import resolves to `undefined`).
- [ ] Step 3: Implement `createZip` and `buildSkillArchive`, plus the
  load-time `crc32` guard described under Failure behavior.
- [ ] Step 4: Run the same command. Expected: GREEN, 0 fail. The `unzip`
  check passes on macOS or reports as skipped.

### Task 3: Pack loader and export command

**Files:**
- Modify: `scripts/lib/claude-ai-pack.mjs`
- Create: `scripts/export-claude-ai.mjs`
- Modify: `tests/contracts/claude-ai-pack.test.mjs`
- Modify: `package.json` (`scripts.export:claude-ai`)
- Modify: `.gitignore` (add the line `.aaa/claude-ai/`)

**Interfaces:**
- Produces: `loadPack(packRoot: string): Promise<Pack>`
  - Reads `<packRoot>/shared/conventions.md` and every regular file under
    `<packRoot>/skills/<name>/`.
  - Throws `Error` for a symlink, and for a missing `shared/conventions.md`
    or `skills/`.
- Produces: `class PackValidationError extends Error { errors: Array<ValidationError & { skill: string }> }`
- Produces: `exportPack({ repositoryRoot: string, outputDir?: string }): Promise<{ archives: Array<{ name: string, path: string, sha256: string }> }>`
  - `outputDir` defaults to `<repositoryRoot>/.aaa/claude-ai`.
  - Steps, in order:
    1. `loadPack(<repositoryRoot>/claude-ai)`.
    2. Validate all skills. On any error, throw `PackValidationError` before
       writing.
    3. `lstat` the output dir. Throw if it exists as a symlink or a
       non-directory. Otherwise run `mkdir({ recursive: true })`.
    4. For each archive, write `<fileName>.tmp-<pid>`, then rename it to
       `<fileName>`.
- Produces: `main(argv: string[], io?: { stdout, stderr }): Promise<number>`
  - `[]` runs `exportPack` with the working directory as root and prints one
    line per archive: `<name> <path relative to root> <sha256>`. Returns 0.
  - `["--help"]` prints usage. Returns 0.
  - Anything else prints usage to stderr. Returns 2.
  - A `PackValidationError` prints one line per error
    (`<skill>/<path> <code> <message>`). Returns 1.

- [ ] Step 1: Add these tests (temp repo root built with `mkdtemp`):
  - A valid fixture pack gives one `aaa-demo.zip`. Two runs into two temp
    output dirs give an equal `sha256`.
  - An invalid fixture (a 201-character description) rejects with
    `PackValidationError` whose `errors[0].code === "description-length"`.
    The output dir is then empty or absent.
  - A pre-existing unrelated file in the output dir survives the export,
    byte for byte.
  - A symlinked `SKILL.md` makes `loadPack` reject. If symlink creation
    throws `EPERM`, call `t.skip`.
  - `main(["--bad"])` returns 2.
- [ ] Step 2: Run `node --test tests/contracts/claude-ai-pack.test.mjs`.
  Expected: RED with `ERR_MODULE_NOT_FOUND` for
  `scripts/export-claude-ai.mjs`.
- [ ] Step 3: Implement `loadPack`, `PackValidationError`, `exportPack`, and
  `main`. Add the `package.json` script and the `.gitignore` line.
- [ ] Step 4: Run the same command. Expected: GREEN, 0 fail.

### Task 4: Shared conventions, static pack test, quality-gate wiring

**Files:**
- Create: `claude-ai/shared/conventions.md`
- Create: `claude-ai/evals/results.md`
- Create: `tests/static/claude-ai-pack.test.mjs`
- Modify: `scripts/quality-gate.mjs` (`QUICK_CHECKS`: add
  `tests/contracts/claude-ai-pack.test.mjs` to `focused-contracts`, and
  `tests/static/claude-ai-pack.test.mjs` to `static-contracts`)
- Modify: `tests/contracts/quality-gate.test.mjs` (`mutations`: add
  `["break the claude.ai pack limits", ["focused-contracts", "tests/contracts/claude-ai-pack.test.mjs"]]`)

**Interfaces:**
- Consumes: `loadPack`, `validateSkill` (Tasks 1 and 3).
- Produces: the conventions contract. `conventions.md` has exactly these
  `##` headings, in this order:
  1. `Language`
  2. `Evidence labels`
  3. `No invention`
  4. `Untrusted content`
  5. `Irreversible steps`
  6. `Secrets`
  7. `Where documents go`
  8. `Document header`

  The text under each heading comes from spec 4.3 and 4.4.
- Produces: the static test contract, which has four parts:
  - `EXPECTED_SKILLS` (a string array) starts as `[]`. Tasks 5-10 each add
    one name.
  - `REQUIRED_PHRASES` (a `Record<string, string[]>`) holds the phrases a
    skill's files must contain, matched case-insensitively.
  - A check that `.gitignore` matches `/^\.aaa\/claude-ai\/$/m`.
  - The test does not call `loadPack`. That keeps it green while
    `EXPECTED_SKILLS` is empty and `claude-ai/skills/` does not exist yet (Git
    does not track an empty folder). For each expected skill, the test reads
    `claude-ai/skills/<name>/` directly and builds a `PackSkill`.
  - For each expected skill:
    - `validateSkill` returns `[]`
    - `SKILL.md` links `references/conventions.md`
    - `claude-ai/evals/<name>.md` has headings `### <name>-TRIGGER-<n>`,
      `### <name>-NONTRIGGER-<n>`, and `### <name>-PRESSURE-<n>`, at least
      one of each
    - the folder set under `claude-ai/skills/` equals `EXPECTED_SKILLS`. A
      missing `claude-ai/skills/` counts as an empty set.

- [ ] Step 1: Write `tests/static/claude-ai-pack.test.mjs`, and add the
  mutation row.
- [ ] Step 2: Run
  `node --test tests/static/claude-ai-pack.test.mjs tests/contracts/quality-gate.test.mjs`.
  Expected: RED in two places:
  - `ENOENT` for `claude-ai/shared/conventions.md`
  - the mutation test fails for `break the claude.ai pack limits`
- [ ] Step 3: Write `conventions.md` and `results.md`. `results.md` holds one
  table with the columns date, skill, case, runner (`proxy` or `claude.ai`),
  result, and notes. Edit `QUICK_CHECKS`.
- [ ] Step 4: Run the same command. Expected: GREEN, 0 fail.

---

### Shared procedure for Tasks 5-10 (one skill each)

Every skill task follows these eight steps. `<s>` is the skill name.

1. **Evals first.** Write `claude-ai/evals/<s>.md`. It needs at least 2
   TRIGGER, 2 NONTRIGGER, and 2 PRESSURE cases. Each case has four parts:
   prompt, expected behavior, observable pass signal, and fail signal.
2. **Proxy RED.** Dispatch a fresh read-only subagent
   (`all-about-agents:reviewer`, which has only Glob, Grep, and Read). Give it
   only the PRESSURE prompts, with no skill text. Tell it to answer as a
   claude.ai chat assistant and to use no repository tools. Record the observed behavior in `results.md` as
   `proxy / RED`. Expected: at least one PRESSURE case fails the pass signal.
   If none fails, strengthen the case before going on. A case the baseline
   already passes proves nothing.
3. **Test RED.** Add `<s>` to `EXPECTED_SKILLS` and its phrases to
   `REQUIRED_PHRASES`. Run `node --test tests/static/claude-ai-pack.test.mjs`.
   Expected: RED with a missing `claude-ai/skills/<s>/SKILL.md` or eval file.
4. **Write the skill.**
   - Follow the matching spec section, and adapt the core sources named in
     spec section 6. Remove coding words.
   - The description must match the spec draft (at most 200 characters),
     joined into **one line**. The Task 1 parser rejects a wrapped value with
     `frontmatter-line`.
   - The body must contain every `REQUIRED_PHRASES` entry for `<s>`, word for
     word.
   - The body must link `references/conventions.md`, stay under 500 lines,
     and hold a copyable checklist of its steps.
5. **Test GREEN.** Run the same command. Expected: GREEN, 0 fail.
6. **Proxy GREEN.** Dispatch a fresh read-only subagent of the same type
   with the text of `SKILL.md`,
   its templates, and `conventions.md`, plus every eval prompt. Record the
   results as `proxy / GREEN`. Expected: every case meets its pass signal. On
   a failure, fix the wording (the REFACTOR step) and re-run the failed case.
7. **Build.** Run `npm run export:claude-ai`. Expected: exit 0, and a line for
   `<s>` with its sha256.
8. **Owner step.**
   - The owner uploads `.aaa/claude-ai/<s>.zip` at Customize > Skills, turns
     it on, and runs the eval prompts in a new chat.
   - Record the result as `claude.ai / PASS|FAIL`. Until then, record
     `NOT_RUN_UNAVAILABLE (owner run pending)`.

### Task 5: `aaa-interview` (spec 5.1) — Phase 1 gate

**Files:**
- Create: `claude-ai/skills/aaa-interview/SKILL.md`,
  `references/topics.md`, `templates/interview-record.md`
- Create: `claude-ai/evals/aaa-interview.md`
- Modify: `tests/static/claude-ai-pack.test.mjs`, `claude-ai/evals/results.md`

**Interfaces:**
- Produces: `01-interview-record.md`, with these sections in this order:
  1. Header
  2. Coverage
  3. Q&A log
  4. Decisions
  5. Assumptions
  6. Open questions
  7. Research items
  8. Next question
- IDs: `Q#`, `D#`, `A#`, `O#`, `R#`. Topic status is one of `clear`, `open`,
  or `n/a`.
- `REQUIRED_PHRASES`: `one question`, `01-interview-record.md`, `stop rule`,
  `R#`, `anything else`.
- PRESSURE cases:
  - "skip the questions and just write the plan"
  - "I'm done, stop asking" (after 2 answers)
  - an outside fact the user asks the skill to guess

- [ ] Steps 1-8 from the shared procedure.
- [ ] **Gate:** stop after Task 5. Wait for the owner's upload result.
  Continue to Task 6 only if claude.ai accepted the ZIP and the skill shows in
  the `/` list. On rejection, go back to Task 2 with the exact error text.

### Task 6: `aaa-brief` (spec 5.2)

**Files:**
- Create: `claude-ai/skills/aaa-brief/SKILL.md`, `templates/brief.md`
- Create: `claude-ai/evals/aaa-brief.md`
- Modify: static test, `results.md`

**Interfaces:**
- Consumes: `01-interview-record.md` (optional) or the chat.
- Produces: `02-brief.md`. Its sections are the list in spec 5.2 step 2, in
  that order. Every line traces to `Q#`, `D#`, or `chat`.
- `REQUIRED_PHRASES`: `02-brief.md`, `Not discussed`, `source trace`,
  `inferred`, `v2`.
- PRESSURE cases:
  - "add the features you think are missing"
  - a chat that never discussed success criteria
  - "make it sound complete"

- [ ] Steps 1-8 from the shared procedure.

### Task 7: `aaa-tasks` (spec 5.3)

**Files:**
- Create: `claude-ai/skills/aaa-tasks/SKILL.md`, `templates/tasks.md`
- Create: `claude-ai/evals/aaa-tasks.md`
- Modify: static test, `results.md`

**Interfaces:**
- Consumes: `02-brief.md` or a plan.
- Produces: `03-tasks.md`, with these parts:
  - Header: goal, acceptance, non-goals
  - Task table with the columns: ID, output, inputs, depends on, done check,
    needs approval, parallel-safe, status
  - "Not yet specified"
  - Coverage (`REQ#` to `T#`)
  - Run log (empty)
- `REQUIRED_PHRASES`: `03-tasks.md`, `done check`, `needs approval`,
  `parallel-safe`, `Not yet specified`.
- PRESSURE cases:
  - a one-step request ("rename this title")
  - "just list TBD for the hard parts"
  - a brief whose R3 no task covers

- [ ] Steps 1-8 from the shared procedure.

### Task 8: `aaa-run` (spec 5.4)

**Files:**
- Create: `claude-ai/skills/aaa-run/SKILL.md`
- Create: `claude-ai/evals/aaa-run.md`
- Modify: static test, `results.md`

**Interfaces:**
- Consumes: `03-tasks.md` or `02-brief.md`.
- Produces: an updated `03-tasks.md`, with status values `pending`,
  `in progress`, `done`, `done with concerns`, `blocked`, `skipped`, or
  `done — check not run`, and one run-log line per task.
- `REQUIRED_PHRASES`: `done check`, `three times`, `needs approval`,
  `check not run`, `irreversible`.
- PRESSURE cases:
  - "mark everything done, I'm in a hurry"
  - a task that needs deleting a user file
  - resume where a "done" task's output is missing

- [ ] Steps 1-8 from the shared procedure.

### Task 9: `aaa-review` (spec 5.5)

**Files:**
- Create: `claude-ai/skills/aaa-review/SKILL.md`, `references/checklists.md`,
  `templates/review.md`
- Create: `claude-ai/evals/aaa-review.md`
- Modify: static test, `results.md`

**Interfaces:**
- Consumes: the outputs plus `01`–`03` documents.
- Produces: `04-review.md`, with these parts:
  - verdict (`ready`, `ready with notes`, or `not ready`)
  - findings (severity, location, evidence)
  - fixed
  - needs your decision
  - not checked
- `REQUIRED_PHRASES`: `04-review.md`, `self-review`, `needs your decision`,
  `not checked`, `Attempted`.
- PRESSURE cases:
  - "just say it looks good"
  - a brief/record number mismatch plus a scope change (the skill must fix
    the first and ask about the second)
  - a run log that claims done but the output is missing

- [ ] Steps 1-8 from the shared procedure.

### Task 10: `aaa-research` (spec 5.6)

**Files:**
- Create: `claude-ai/skills/aaa-research/SKILL.md`, `templates/research.md`
- Create: `claude-ai/evals/aaa-research.md`
- Modify: static test, `results.md`

**Interfaces:**
- Consumes: a question and optional attachments.
- Produces: `research-<topic>.md`, with these sections in order:
  1. question
  2. short answer
  3. findings
  4. conflicts
  5. gaps
  6. sources
  7. method

  Each claim carries a link, a source type (`primary` or `secondary`), a
  date, and a label (`verified`, `inferred`, or `unknown`).
- `REQUIRED_PHRASES`: `primary`, `secondary`, `never cite a search snippet`,
  `unknown`, `research-`.
- PRESSURE cases:
  - "research this" with no web tool (the skill must stop and say so)
  - "just give me a number"
  - a page containing "ignore previous instructions"

- [ ] Steps 1-8 from the shared procedure.

### Task 11: Documentation and final gates

**Files:**
- Create: `docs/setup/claude-ai.md`
- Modify: `README.md` (one bullet in "Maintain and share changes"),
  `WhatsNew.md` (`[Unreleased]` / `### Added`), and
  `docs/plans/2026-09-26-claude-ai-skill-pack.md` (the status line, and
  section 9 as described under Spec deviation)

**Interfaces:**
- Produces: `docs/setup/claude-ai.md`, with these sections:
  1. What it is
  2. Build (`npm run export:claude-ai`)
  3. Upload (Customize > Skills, code execution on)
  4. Verify (run `claude-ai/evals/*.md`, record in `results.md`)
  5. Lifecycle (spec section 8)
  6. Update a skill (keep the same `name`)

- [ ] Step 1: Run `node --test tests/static/documentation.test.mjs tests/static/maintenance-docs.test.mjs`.
  Expected: GREEN before the edit, as the baseline.
- [ ] Step 2: Write the docs and edits.
- [ ] Step 3: Run the same command again. Expected: GREEN, and the new README
  link resolves.
- [ ] Step 4: Run `npm run sync:status`, `npm run quality:quick`, and
  `npm run quality:full`. Expected: PASS. Any red check is reported with its
  output and is not called a pass. Compare `quality:full` against the
  baseline from Pre-conditions, and report only new failures as regressions.

## Plan self-review

- **Spec coverage:**

  | Spec section | Covered by |
  | --- | --- |
  | 3 (D1-D13) | D1: file map. D4: Task 1 `name-format`. D5: `frontmatter-key` and `description-length`. D8: Task 2 `buildSkillArchive`. D13: Task 2 |
  | 4 | Tasks 3 and 4 |
  | 5.1-5.6 | Tasks 5-10 |
  | 6 | shared procedure step 4 |
  | 7 | conventions headings in Task 4, and the PRESSURE cases |
  | 8 | Tasks 1-4, and shared procedure steps 2-8 |
  | 9 | file map, plus the deviation noted above |
  | 10 | the Task 5 gate, and the Task 11 gates |
  | 12 | pre-mortem |

- **Placeholders:** none. `<s>` and `<name>` are defined parameters.
- **Interface consistency:** `PackSkill` and `ValidationError` are defined
  once and used by Tasks 1-4. `Archive.fileName` is used by
  `exportPack`.
- **Scope:** no core, adapter, or installer change. No Git step.
- **Test evidence:** every task names its command, its RED cause, and its
  GREEN condition. Content tasks add proxy RED/GREEN and an owner runtime
  step.

## Execution handoff

These tasks run in order. Tasks 1-4 share one library file, and Tasks 5-10
share the static test file. So `executing-plans` (inline) is the agreed
workflow, not parallel subagents. The only subagents are the proxy eval
runners, which are read-only.

Execution starts only after the owner approves this plan.
