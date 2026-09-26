import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const skillId = "subagent-driven-development";
const requiredCases = [
  "SD-TRIGGER-independent-plan-tasks",
  "SD-NONTRIGGER-overlapping-writers",
  "SD-PRESSURE-cheap-model-cleanup"
];

const skillPath = resolve(process.cwd(), "core/skills/subagent-driven-development/SKILL.md");
const evaluationPath = resolve(process.cwd(), "core/evals/skill-routing/subagent-driven-development.json");
const gateFixturePath = resolve(process.cwd(), "tests/fixtures/subagent-driven-development/skill-gate.json");
const injectionFixturePath = resolve(process.cwd(), "tests/fixtures/subagent-driven-development/command-injection.json");
const reviewPackagePath = resolve(process.cwd(), "core/skills/subagent-driven-development/scripts/review-package.js");

test("T025 exposes its routing evidence", async () => {
  const skill = await readFile(skillPath, "utf8");
  const evaluation = JSON.parse(await readFile(evaluationPath, "utf8"));
  const serialized = JSON.stringify(evaluation);
  assert.match(skill, /^---\n/u);
  for (const caseId of requiredCases) assert.match(serialized, new RegExp(caseId));
});

test("subagent-driven-development gates execution and isolates implementation writers", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /^---\n/u);
  const closing = skill.indexOf("\n---\n", 4);
  assert.ok(closing > 0, "frontmatter must close");
  const frontmatter = skill.slice(4, closing);
  assert.match(frontmatter, /^name:\s*subagent-driven-development\s*$/mu);
  assert.match(frontmatter, /^description:\s*Use when\b/mu);
  assert.match(frontmatter, /^evaluationCases:\s*$/mu);
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.match(skill, /approved (?:implementation )?plan/iu);
  assert.match(skill, /independent (?:plan )?tasks|tasks? (?:are )?independent/iu);
  assert.match(skill, /fresh implementer/iu);
  assert.match(skill, /task review|review.*(?:spec|quality)/iu);
  assert.match(skill, /whole.branch|whole branch|final review/iu);
  assert.match(skill, /overlapping writers|overlap.*writes|one writer at a time/iu);
  assert.match(skill, /do not .*parallel.*(?:writer|implementer)|never .*parallel.*(?:writer|implementer)/isu);
  assert.match(skill, /stop|return to|replan/iu);
  assert.doesNotMatch(skill, /(?:\.claude|\.codex|\.gemini|mcp__|WebSearch|WebFetch|spawn_agent|invoke_subagent)/iu);
});

test("subagent-driven-development preserves model, process, and command safety", async () => {
  const skill = await readFile(skillPath, "utf8");
  assert.match(skill, /strongest approved|most capable approved|highest approved/iu);
  assert.match(skill, /explicit(?:ly)? specify.*model|model.*explicitly/iu);
  assert.match(skill, /argument array|argv|executable.*arguments/iu);
  assert.match(skill, /shell interpolation|interpolat(?:e|ion).*shell|shell.*interpolat/iu);
  assert.match(skill, /command injection|shell metacharacter|injection/iu);
  assert.match(skill, /no automatic(?:ally)? commit|do not automatically commit|automatic commit/iu);
  assert.match(skill, /broad.*(?:delete|deletion|cleanup)|workspace.*(?:delete|deletion)/isu);
  assert.match(skill, /explicit(?:ly)? user|user(?:'s)? explicit|authorization/iu);
  assert.match(skill, /uncommitted.*(?:preserve|untouched)|preserve.*uncommitted/isu);
});

test("T025 fixtures encode the Skill Gate and command-injection boundaries", async () => {
  const gate = JSON.parse(await readFile(gateFixturePath, "utf8"));
  const injection = JSON.parse(await readFile(injectionFixturePath, "utf8"));
  assert.equal(gate.case, "approved-independent-plan");
  assert.equal(gate.expected.skillCheck, "required");
  assert.equal(gate.expected.dispatch, true);
  assert.equal(gate.expected.overlappingWriters, false);
  assert.ok(Array.isArray(injection.safeArgv));
  assert.ok(Array.isArray(injection.unsafeShellStrings));
  assert.equal(injection.expected.argvOnly, true);
  assert.equal(injection.expected.rejectShellInterpolation, true);
  assert.ok(injection.unsafeShellStrings.some((command) => /\$\(|`|;|&&/u.test(command)));
});

test("review-package passes an untrusted Git ref as one argument without shell execution", async () => {
  const root = await mkdtemp(join(tmpdir(), "aaa-review-package-"));
  const marker = join(root, "owned-marker");
  const plan = join(root, "plan.md");
  const installedReviewPackage = join(root, "review-package.cjs");
  const JavaScript = "require('node:fs').writeFileSync('owned-marker','x')";
  const maliciousBase = process.platform === "win32"
    ? `HEAD\" & \"${process.execPath}\" -e \"${JavaScript}\" & rem \"`
    : `HEAD\"; \"${process.execPath}\" -e \"${JavaScript}\"; #`;
  try {
    await writeFile(plan, "# Test plan\n", "utf8");
    await writeFile(installedReviewPackage, await readFile(reviewPackagePath, "utf8"), "utf8");
    const initialized = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8", shell: false });
    assert.equal(initialized.status, 0, initialized.stderr);

    const result = spawnSync(process.execPath, [installedReviewPackage, plan, maliciousBase, "HEAD"], {
      cwd: root,
      encoding: "utf8",
      shell: false
    });

    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /bad (?:BASE|HEAD) commit:/u);
    await assert.rejects(access(marker), { code: "ENOENT" });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("review-package keeps its valid review text and summary format", async () => {
  const root = await mkdtemp(join(tmpdir(), "aaa-review-output-"));
  const plan = join(root, "plan.md");
  const installedReviewPackage = join(root, "review-package.cjs");
  const outFile = join(root, "review.diff");
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    await writeFile(plan, "# Test plan\n", "utf8");
    await writeFile(installedReviewPackage, await readFile(reviewPackagePath, "utf8"), "utf8");
    git(["init", "--quiet"]);
    git(["config", "user.name", "AAA Test"]);
    git(["config", "user.email", "aaa-test@example.invalid"]);
    await writeFile(join(root, "sample.txt"), "one\n", "utf8");
    git(["add", "sample.txt"]);
    git(["commit", "--quiet", "-m", "first"]);
    const base = git(["rev-parse", "HEAD"]);
    await writeFile(join(root, "sample.txt"), "one\ntwo\n", "utf8");
    git(["add", "sample.txt"]);
    git(["commit", "--quiet", "-m", "second"]);
    const head = git(["rev-parse", "HEAD"]);

    const result = spawnSync(process.execPath, [installedReviewPackage, plan, base, head, outFile], {
      cwd: root,
      encoding: "utf8",
      shell: false
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /wrote .*review[.]diff: 1 commit\(s\), [0-9]+ bytes/u);
    const review = await readFile(outFile, "utf8");
    assert.match(review, new RegExp(`^# Review package: ${base}\\.\\.${head}`, "u"));
    assert.match(review, /## Commits\n.*second/su);
    assert.match(review, /## Files changed\n/u);
    assert.match(review, /## Diff\n/u);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("subagent-driven-development routing evaluation defines three complete critical cases", async () => {
  const evaluation = JSON.parse(await readFile(evaluationPath, "utf8"));
  assert.equal(evaluation.schemaVersion, 1);
  assert.equal(evaluation.skill, skillId);
  assert.deepEqual(evaluation.cases.map((entry) => entry.id), requiredCases);
  for (const entry of evaluation.cases) {
    assert.equal(entry.critical, true, `${entry.id} must be critical`);
    assert.equal(typeof entry.prompt, "string");
    assert.equal(typeof entry.expected, "object");
    assert.ok(Array.isArray(entry.observables) && entry.observables.length > 0);
    assert.ok(entry.observables.every((observable) => typeof observable === "string" && observable.trim().length > 0));
  }
  assert.equal(evaluation.cases[0].expected.skillCheck, "required");
  assert.equal(evaluation.cases[0].expected.independentTasks, true);
  assert.equal(evaluation.cases[0].expected.freshImplementerPerTask, true);
  assert.equal(evaluation.cases[0].expected.noOverlappingWriters, true);
  assert.equal(evaluation.cases[0].expected.taskReview, true);
  assert.equal(evaluation.cases[0].expected.finalReview, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.overlappingWriters, true);
  assert.equal(evaluation.cases[1].expected.noParallelWriters, true);
  assert.equal(evaluation.cases[1].expected.replanOrSequential, true);
  assert.equal(evaluation.cases[2].expected.skillCheck, "required");
  assert.equal(evaluation.cases[2].expected.strongestApprovedModels, true);
  assert.equal(evaluation.cases[2].expected.noCheapModelSubstitution, true);
  assert.equal(evaluation.cases[2].expected.argvOnly, true);
  assert.equal(evaluation.cases[2].expected.rejectCommandInjection, true);
  assert.equal(evaluation.cases[2].expected.noAutomaticCommit, true);
  assert.equal(evaluation.cases[2].expected.noBroadDeletion, true);
});

test("core loader exposes subagent-driven-development metadata and routing links", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  const skill = core.skills.find((entry) => entry.id === skillId);
  assert.ok(skill);
  assert.equal(skill.name, skillId);
  assert.deepEqual(skill.evaluationCases, requiredCases);
  assert.deepEqual(core.evals.find((entry) => entry.id === "subagent-driven-development-routing")?.cases.map((entry) => entry.id), requiredCases);
});

test("worker prompts never commit on their own and cite the real model policy heading", async () => {
  const directory = resolve(process.cwd(), "core/skills/subagent-driven-development");
  const skill = await readFile(join(directory, "SKILL.md"), "utf8");
  assert.match(skill, /^## Model and review policy$/mu);
  const implementer = await readFile(join(directory, "implementer-prompt.md"), "utf8");
  assert.doesNotMatch(implementer, /Commit your work/iu);
  assert.match(implementer, /Do not commit/iu);
  for (const name of ["implementer-prompt.md", "task-reviewer-prompt.md", "re-review-prompt.md"]) {
    const prompt = await readFile(join(directory, name), "utf8");
    assert.doesNotMatch(prompt, /Model Selection/u, `${name} cites a heading that does not exist`);
  }
  const reReview = await readFile(join(directory, "re-review-prompt.md"), "utf8");
  assert.doesNotMatch(reReview, /cheap/iu, "re-review must not downshift the model");
});
