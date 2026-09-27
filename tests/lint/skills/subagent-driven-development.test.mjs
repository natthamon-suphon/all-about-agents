import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { access, chmod, link, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import test from "node:test";
import { skipIfLinkUnavailable } from "../../helpers/symlink.mjs";

const skillId = "subagent-driven-development";
const requiredCases = [
  "SD-TRIGGER-independent-plan-tasks",
  "SD-NONTRIGGER-overlapping-writers",
  "SD-PRESSURE-cheap-model-cleanup",
  "SD-NONTRIGGER-concurrent-independent-reads"
];

const skillPath = resolve(process.cwd(), "core/skills/subagent-driven-development/SKILL.md");
const evaluationPath = resolve(process.cwd(), "core/evals/skill-routing/subagent-driven-development.json");
const gateFixturePath = resolve(process.cwd(), "tests/fixtures/subagent-driven-development/skill-gate.json");
const injectionFixturePath = resolve(process.cwd(), "tests/fixtures/subagent-driven-development/command-injection.json");
const skillDirectory = resolve(process.cwd(), "core/skills/subagent-driven-development");
const scriptsDirectory = join(skillDirectory, "scripts");
const reviewPackagePath = join(scriptsDirectory, "review-package.cjs");
const taskBriefPath = join(scriptsDirectory, "task-brief.cjs");
const sddWorkspacePath = join(scriptsDirectory, "sdd-workspace.cjs");
const promptNames = ["implementer-prompt.md", "task-reviewer-prompt.md", "re-review-prompt.md"];
const sddDispatchBoundary = "`subagent-driven-development` runs approved plan tasks one implementer at a time in the shared worktree, with a review after each task; `dispatching-parallel-agents` runs independent items at the same time, and allows writers only with disjoint write scopes.";
const flatten = (text) => text.replace(/\s+/gu, " ");
const runNode = (script, args, cwd) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", shell: false });

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
  const JavaScript = "require('node:fs').writeFileSync('owned-marker','x')";
  const maliciousBase = process.platform === "win32"
    ? `HEAD\" & \"${process.execPath}\" -e \"${JavaScript}\" & rem \"`
    : `HEAD\"; \"${process.execPath}\" -e \"${JavaScript}\"; #`;
  try {
    await writeFile(plan, "# Test plan\n", "utf8");
    const initialized = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8", shell: false });
    assert.equal(initialized.status, 0, initialized.stderr);

    const result = runNode(reviewPackagePath, [plan, maliciousBase, "HEAD"], root);

    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /bad (?:BASE|HEAD) commit or tree:/u);
    await assert.rejects(access(marker), { code: "ENOENT" });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("review-package keeps its valid review text and summary format", async () => {
  const root = await mkdtemp(join(tmpdir(), "aaa-review-output-"));
  const plan = join(root, "plan.md");
  const outFile = join(root, "sdd", "review.diff");
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  try {
    await writeFile(plan, "# Test plan\n", "utf8");
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

    const result = runNode(reviewPackagePath, [plan, base, head, outFile], root);
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

async function uncommittedRepo(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(["init", "--quiet"]);
  git(["config", "user.name", "AAA Test"]);
  git(["config", "user.email", "aaa-test@example.invalid"]);
  await writeFile(join(root, "plan.md"), "# Test plan\n", "utf8");
  await writeFile(join(root, "sample.txt"), "one\n", "utf8");
  git(["add", "plan.md", "sample.txt"]);
  git(["commit", "--quiet", "-m", "first"]);
  const run = (args) => runNode(reviewPackagePath, args, root);
  const cleanup = () => rm(root, { force: true, recursive: true });
  return { root, sdd: join(root, "sdd"), git, run, cleanup, base: git(["rev-parse", "HEAD"]) };
}

test("review-package packages uncommitted work against the recorded base without touching the index", async () => {
  const repo = await uncommittedRepo("aaa-review-worktree-");
  try {
    await writeFile(join(repo.root, "sample.txt"), "one\ntwo\n", "utf8");
    await writeFile(join(repo.root, "fresh.txt"), "fresh line\n", "utf8");
    const statusBefore = repo.git(["status", "--porcelain"]);
    const outFile = join(repo.sdd, "review.diff");
    const result = repo.run([join(repo.root, "plan.md"), repo.base, "WORKTREE", outFile]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /wrote .*review[.]diff: 0 commit\(s\), [0-9]+ bytes/u);
    const review = await readFile(outFile, "utf8");
    assert.match(review, /## Commits\n\(none: uncommitted working tree\)/u);
    assert.match(review, /^\+two$/mu);
    assert.match(review, /fresh[.]txt/u);
    assert.match(review, /^\+fresh line$/mu);
    assert.equal(repo.git(["status", "--porcelain"]), statusBefore);
    assert.equal(repo.git(["diff", "--cached", "--name-only"]), "");
  } finally {
    await repo.cleanup();
  }
});

test("review-package refuses an empty package instead of writing one", async () => {
  const repo = await uncommittedRepo("aaa-review-empty-");
  try {
    for (const head of ["HEAD", "WORKTREE"]) {
      const outFile = join(repo.sdd, `review-${head}.diff`);
      const result = repo.run([join(repo.root, "plan.md"), repo.base, head, outFile]);
      assert.equal(result.status, 3, `${head} must exit 3 on an empty change`);
      assert.match(result.stderr, /empty review package/u);
      await assert.rejects(access(outFile), { code: "ENOENT" });
    }
    await assert.rejects(access(repo.sdd), { code: "ENOENT" }, "an empty package must not create sdd/");
  } finally {
    await repo.cleanup();
  }
});

test("a WORKTREE package restores a missing sdd/.gitignore before it snapshots, so sdd/ files stay out", async () => {
  const repo = await uncommittedRepo("aaa-review-sdd-ignore-");
  try {
    await mkdir(repo.sdd);
    await writeFile(join(repo.sdd, "task-1-brief.md"), "old brief text\n", "utf8");
    await writeFile(join(repo.root, "sample.txt"), "one\ntwo\n", "utf8");
    const outFile = join(repo.sdd, "review.diff");
    const result = repo.run([join(repo.root, "plan.md"), repo.base, "WORKTREE", outFile]);
    assert.equal(result.status, 0, result.stderr);
    const review = await readFile(outFile, "utf8");
    assert.match(review, /^\+two$/mu);
    assert.doesNotMatch(review, /old brief text|task-1-brief/u);
  } finally {
    await repo.cleanup();
  }
});

test("review-package --snapshot records a per-task base so earlier uncommitted tasks stay out", async () => {
  const repo = await uncommittedRepo("aaa-review-snapshot-");
  try {
    await writeFile(join(repo.root, "sample.txt"), "one\ntask one line\n", "utf8");
    const statusBefore = repo.git(["status", "--porcelain"]);
    const snapshot = repo.run(["--snapshot"]);
    assert.equal(snapshot.status, 0, snapshot.stderr);
    const snapshotId = snapshot.stdout.trim();
    assert.match(snapshotId, /^[0-9a-f]{40,64}$/u);
    assert.equal(repo.git(["status", "--porcelain"]), statusBefore);
    assert.equal(repo.git(["diff", "--cached", "--name-only"]), "");
    await writeFile(join(repo.root, "task-two.txt"), "task two line\n", "utf8");
    const outFile = join(repo.sdd, "task-two.diff");
    const result = repo.run([join(repo.root, "plan.md"), snapshotId, "WORKTREE", outFile]);
    assert.equal(result.status, 0, result.stderr);
    const review = await readFile(outFile, "utf8");
    assert.match(review, /task-two[.]txt/u);
    assert.doesNotMatch(review, /task one line/u);
  } finally {
    await repo.cleanup();
  }
});

test("the skill and review prompts cover the no-commit review path", async () => {
  const directory = resolve(process.cwd(), "core/skills/subagent-driven-development");
  const skill = await readFile(join(directory, "SKILL.md"), "utf8");
  assert.match(skill, /--snapshot/u);
  assert.match(skill, /WORKTREE/u);
  assert.match(skill, /empty review package/iu);
  for (const name of ["task-reviewer-prompt.md", "re-review-prompt.md"]) {
    const prompt = await readFile(join(directory, name), "utf8");
    assert.match(prompt, /If Head is `WORKTREE`, report the\s+missing diff file and stop/u, `${name} must stop without a range fallback`);
  }
  assert.match(skill, /ledger, briefs, and reports\s+in the plan's `sdd\/` folder/u);
});

test("review-package keeps tracked-but-ignored files and recorded modes in a WORKTREE package", async () => {
  const repo = await uncommittedRepo("aaa-review-tracked-");
  try {
    repo.git(["config", "core.fileMode", "false"]);
    await writeFile(join(repo.root, "keep.log"), "kept\n", "utf8");
    await writeFile(join(repo.root, "run.sh"), "echo run\n", "utf8");
    repo.git(["add", "keep.log", "run.sh"]);
    repo.git(["update-index", "--chmod=+x", "run.sh"]);
    await writeFile(join(repo.root, ".gitignore"), "*.log\n", "utf8");
    repo.git(["add", ".gitignore"]);
    repo.git(["commit", "--quiet", "-m", "tracked ignored and executable"]);
    const base = repo.git(["rev-parse", "HEAD"]);
    const refsBefore = repo.git(["for-each-ref"]);
    const unchanged = repo.run([join(repo.root, "plan.md"), base, "WORKTREE", join(repo.sdd, "unchanged.diff")]);
    assert.equal(unchanged.status, 3, `an unchanged tree must be empty: ${unchanged.stderr}`);
    await writeFile(join(repo.root, "keep.log"), "kept\nedited\n", "utf8");
    const outFile = join(repo.sdd, "edited.diff");
    const edited = repo.run([join(repo.root, "plan.md"), base, "WORKTREE", outFile]);
    assert.equal(edited.status, 0, edited.stderr);
    const review = await readFile(outFile, "utf8");
    assert.match(review, /^\+edited$/mu);
    assert.doesNotMatch(review, /run[.]sh|old mode|deleted file/u);
    assert.equal(repo.git(["for-each-ref"]), refsBefore);
  } finally {
    await repo.cleanup();
  }
});

test("subagent-driven-development routing evaluation defines four complete critical cases", async () => {
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
  assert.equal(evaluation.cases[3].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[3].expected.routeTo, "dispatching-parallel-agents");
  for (const entry of evaluation.cases) {
    assert.doesNotMatch(entry.prompt, /subagent-driven-development|\bSDD\b|\bskill\b/iu, `${entry.id} prompt must not name the skill`);
  }
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

test("review-package packages a diff larger than the default 1 MiB process buffer", async () => {
  const repo = await uncommittedRepo("aaa-review-large-");
  try {
    const lines = Array.from({ length: 20000 }, (_, index) => `line ${String(index).padStart(6, "0")} ${"x".repeat(60)}`);
    await writeFile(join(repo.root, "large.txt"), `${lines.join("\n")}\n`, "utf8");
    const outFile = join(repo.sdd, "large.diff");
    const result = repo.run([join(repo.root, "plan.md"), repo.base, "WORKTREE", outFile]);
    assert.equal(result.status, 0, result.stderr);
    const bytes = Number(/, ([0-9]+) bytes$/mu.exec(result.stdout)?.[1]);
    assert.ok(bytes > 1024 * 1024, `package must exceed 1 MiB, got ${bytes}`);
    assert.match(await readFile(outFile, "utf8"), /^\+line 019999 x+$/mu);
  } finally {
    await repo.cleanup();
  }
});

test("review-package removes its temporary index when git add fails", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) {
    t.skip("needs a POSIX user that an unreadable file can stop");
    return;
  }
  const repo = await uncommittedRepo("aaa-review-index-");
  const temp = await mkdtemp(join(tmpdir(), "aaa-review-index-tmp-"));
  const unreadable = join(repo.root, "unreadable.txt");
  try {
    await writeFile(unreadable, "secret\n", "utf8");
    await chmod(unreadable, 0o000);
    const result = spawnSync(process.execPath, [reviewPackagePath, "--snapshot"], {
      cwd: repo.root,
      encoding: "utf8",
      env: { ...process.env, TMPDIR: temp },
      shell: false
    });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /^review-package: git add failed: .*unreadable[.]txt/mu);
    assert.deepEqual(await readdir(temp), []);
  } finally {
    await chmod(unreadable, 0o600);
    await repo.cleanup();
    await rm(temp, { force: true, recursive: true });
  }
});

test("review-package refuses to run outside a Git work tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "aaa-review-no-repo-"));
  try {
    const plan = join(root, "plan.md");
    await writeFile(plan, "# Test plan\n", "utf8");
    for (const args of [["--snapshot"], [plan, "HEAD", "WORKTREE"]]) {
      const result = runNode(reviewPackagePath, args, root);
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /not inside a Git work tree/u);
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("review-package and task-brief refuse a bad OUTFILE or ref before they create sdd/", async () => {
  const repo = await uncommittedRepo("aaa-outfile-");
  try {
    const plan = join(repo.root, "plan.md");
    await writeFile(join(repo.root, "sample.txt"), "one\ntwo\n", "utf8");
    await writeFile(plan, "# Test plan\n\n## Task 1: one\nbody\n", "utf8");
    const refused = [plan, join(repo.root, "review.diff"), join(repo.sdd, ".gitignore"), join(repo.sdd, ".GITIGNORE"), join(repo.sdd, ".hidden.diff")];
    for (const outFile of refused) {
      const packaged = repo.run([plan, repo.base, "WORKTREE", outFile]);
      assert.equal(packaged.status, 2, `review-package must refuse ${outFile}`);
      assert.match(packaged.stderr, /OUTFILE must be inside/u);
      const brief = runNode(taskBriefPath, [plan, "1", outFile], repo.root);
      assert.equal(brief.status, 2, `task-brief must refuse ${outFile}`);
      assert.match(brief.stderr, /OUTFILE must be inside/u);
    }
    assert.equal(repo.run([plan, "no-such-ref", "HEAD"]).status, 2);
    assert.equal(runNode(taskBriefPath, [plan, "9"], repo.root).status, 3);
    await assert.rejects(access(repo.sdd), { code: "ENOENT" }, "a refused call must not create sdd/");
    assert.equal(runNode(sddWorkspacePath, [plan], repo.root).status, 0);
    assert.equal(repo.run([plan, repo.base, "WORKTREE", join(repo.sdd, ".GITIGNORE")]).status, 2);
    assert.equal(await readFile(join(repo.sdd, ".gitignore"), "utf8"), "*\n");
    assert.equal(await readFile(plan, "utf8"), "# Test plan\n\n## Task 1: one\nbody\n");
    await assert.rejects(access(join(repo.root, "review.diff")), { code: "ENOENT" });
  } finally {
    await repo.cleanup();
  }
});

test("review-package, task-brief, and sdd-workspace never write through a symlink or hard link", async (t) => {
  const repo = await uncommittedRepo("aaa-links-");
  const outside = await mkdtemp(join(tmpdir(), "aaa-links-outside-"));
  const plan = join(repo.root, "plan.md");
  const planText = "# Test plan\n\n## Task 1: one\nbody\n";
  try {
    await writeFile(plan, planText, "utf8");
    await writeFile(join(repo.root, "sample.txt"), "one\ntwo\n", "utf8");
    try {
      await symlink(outside, repo.sdd, "dir");
    } catch (error) {
      skipIfLinkUnavailable(t, error);
      return;
    }
    for (const result of [repo.run([plan, repo.base, "WORKTREE"]), runNode(taskBriefPath, [plan, "1"], repo.root), runNode(sddWorkspacePath, [plan], repo.root)]) {
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /symlink/u);
    }
    assert.deepEqual(await readdir(outside), []);
    await unlink(repo.sdd);

    assert.equal(runNode(sddWorkspacePath, [plan], repo.root).status, 0);
    const planLink = join(repo.sdd, "link.diff");
    await symlink(join("..", "plan.md"), planLink);
    assert.equal(repo.run([plan, repo.base, "WORKTREE", planLink]).status, 2);
    assert.equal(runNode(taskBriefPath, [plan, "1", planLink], repo.root).status, 2);

    await symlink(join("..", "plan.md"), join(repo.sdd, "task-1-brief.md"));
    repo.git(["add", "-f", "sdd/task-1-brief.md"]);
    repo.git(["commit", "--quiet", "-m", "tracked link at the default brief name"]);
    const trackedLink = runNode(taskBriefPath, [plan, "1"], repo.root);
    assert.equal(trackedLink.status, 2, trackedLink.stderr);
    assert.match(trackedLink.stderr, /not a regular file/u);

    const first = repo.run([plan, repo.base, "WORKTREE"]);
    assert.equal(first.status, 0, first.stderr);
    const defaultPackage = /^wrote (.+): /mu.exec(first.stdout)[1];
    await unlink(defaultPackage);
    await link(plan, defaultPackage);
    const hardLinked = repo.run([plan, repo.base, "WORKTREE"]);
    assert.equal(hardLinked.status, 2, hardLinked.stderr);
    assert.match(hardLinked.stderr, /not a regular file with one link/u);
    assert.equal(await readFile(plan, "utf8"), planText);
  } finally {
    await repo.cleanup();
    await rm(outside, { force: true, recursive: true });
  }
});

test("review-package ignores color and external diff settings", async () => {
  const repo = await uncommittedRepo("aaa-review-plain-");
  try {
    repo.git(["config", "color.ui", "always"]);
    repo.git(["config", "diff.external", "echo"]);
    await writeFile(join(repo.root, "sample.txt"), "one\ntwo\n", "utf8");
    repo.git(["commit", "--quiet", "-am", "second"]);
    const outFile = join(repo.sdd, "plain.diff");
    const result = repo.run([join(repo.root, "plan.md"), repo.base, repo.git(["rev-parse", "HEAD"]), outFile]);
    assert.equal(result.status, 0, result.stderr);
    const review = await readFile(outFile, "utf8");
    assert.match(review, /^\+two$/mu);
    assert.doesNotMatch(review, /\u001b\[/u);
  } finally {
    await repo.cleanup();
  }
});

test("review-package removes its temporary index when it is stopped with SIGTERM or SIGHUP", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX signals only");
    return;
  }
  const repo = await uncommittedRepo("aaa-review-signal-");
  const temp = await mkdtemp(join(tmpdir(), "aaa-review-signal-tmp-"));
  try {
    repo.git(["config", "filter.slow.clean", "sleep 1; cat"]);
    await writeFile(join(repo.root, ".gitattributes"), "slow.txt filter=slow\n", "utf8");
    await writeFile(join(repo.root, "slow.txt"), "slow\n", "utf8");
    for (const [signal, code] of [["SIGTERM", 143], ["SIGHUP", 129]]) {
      const child = spawn(process.execPath, [reviewPackagePath, "--snapshot"], { cwd: repo.root, env: { ...process.env, TMPDIR: temp }, stdio: "ignore" });
      const closed = new Promise((resolveClose) => child.once("close", (exitCode, exitSignal) => resolveClose({ code: exitCode, signal: exitSignal })));
      const deadline = Date.now() + 10000;
      while ((await readdir(temp)).length === 0 && Date.now() < deadline) await new Promise((resolveWait) => setTimeout(resolveWait, 20));
      child.kill(signal);
      assert.deepEqual(await closed, { code, signal: null }, signal);
      assert.deepEqual(await readdir(temp), [], signal);
    }
  } finally {
    await repo.cleanup();
    await rm(temp, { force: true, recursive: true });
  }
});

test("the sdd helpers check sdd/ for a symlink again after mkdir and before the final rename", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aaa-sdd-recheck-"));
  const outside = await mkdtemp(join(tmpdir(), "aaa-sdd-recheck-outside-"));
  try {
    const linked = join(root, "sdd");
    try {
      await symlink(outside, linked, "dir");
    } catch (error) {
      skipIfLinkUnavailable(t, error);
      return;
    }
    const helper = (code) => spawnSync(process.execPath, ["-e", code, sddWorkspacePath, linked], { encoding: "utf8", shell: false });
    const ensured = helper("require(process.argv[1]).ensureSddDir(process.argv[2])");
    assert.equal(ensured.status, 2, ensured.stderr);
    assert.match(ensured.stderr, /symlink/u);
    const written = helper("require(process.argv[1]).writeOutFile(require('node:path').join(process.argv[2], 'x.diff'), 'x')");
    assert.equal(written.status, 2, written.stderr);
    assert.match(written.stderr, /symlink/u);
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(root, { force: true, recursive: true });
    await rm(outside, { force: true, recursive: true });
  }
});

test("outputs replace their target by rename and leave no temp file", async () => {
  const root = await mkdtemp(join(tmpdir(), "aaa-sdd-rename-"));
  try {
    const plan = join(root, "plan.md");
    const brief = join(root, "sdd", "task-1-brief.md");
    await writeFile(plan, "## Task 1: one\nbody\n", "utf8");
    assert.equal(runNode(taskBriefPath, [plan, "1"], root).status, 0);
    const before = (await stat(brief)).ino;
    assert.equal(runNode(taskBriefPath, [plan, "1"], root).status, 0);
    assert.notEqual((await stat(brief)).ino, before, "the brief must be replaced by rename, not truncated in place");
    assert.deepEqual((await readdir(join(root, "sdd"))).filter((name) => name.startsWith(".tmp")), []);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("a WORKTREE package lists the untracked files it pulled in and is readable only by its owner", async () => {
  const repo = await uncommittedRepo("aaa-review-untracked-");
  try {
    await writeFile(join(repo.root, "notes.txt"), "note\n", "utf8");
    await writeFile(join(repo.root, "sample.txt"), "one\ntwo\n", "utf8");
    const outFile = join(repo.sdd, "untracked.diff");
    const result = repo.run([join(repo.root, "plan.md"), repo.base, "WORKTREE", outFile]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(outFile, "utf8"), /\n## Untracked files included\nnotes[.]txt\n\n## Files changed\n/u);
    if (process.platform !== "win32") assert.equal((await stat(outFile)).mode & 0o777, 0o600);
  } finally {
    await repo.cleanup();
  }
});

test("a WORKTREE package refuses untracked secret-like files and names only their paths", async () => {
  const repo = await uncommittedRepo("aaa-review-secret-");
  try {
    await mkdir(join(repo.root, "keys"));
    await writeFile(join(repo.root, ".env"), "TOKEN=do-not-print\n", "utf8");
    await writeFile(join(repo.root, "keys", "server.pem"), "PRIVATE-KEY-BODY\n", "utf8");
    await writeFile(join(repo.root, ".environment"), "not a secret name\n", "utf8");
    const result = repo.run([join(repo.root, "plan.md"), repo.base, "WORKTREE"]);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /[.]env\b/u);
    assert.match(result.stderr, /keys\/server[.]pem/u);
    assert.doesNotMatch(result.stderr, /[.]environment|do-not-print|PRIVATE-KEY-BODY/u);
    await assert.rejects(access(repo.sdd), { code: "ENOENT" }, "no sdd/ folder and no package on refusal");
  } finally {
    await repo.cleanup();
  }
});

test("a WORKTREE package blocks exact secret names, not look-alikes, and names staging to include a file", async () => {
  const repo = await uncommittedRepo("aaa-review-secret-names-");
  try {
    const plan = join(repo.root, "plan.md");
    const lookAlikes = ["CredentialsProvider.java", "credentials.test.ts", ".env.example", ".env.sample", ".env.template", "vite.env.d.ts"];
    for (const name of lookAlikes) await writeFile(join(repo.root, name), "not a secret\n", "utf8");
    const allowed = repo.run([plan, repo.base, "WORKTREE", join(repo.sdd, "look-alikes.diff")]);
    assert.equal(allowed.status, 0, allowed.stderr);

    const secrets = ["id_dsa", ".git-credentials", ".pgpass", "_netrc", "prod.env", "credentials", "credentials.json", "credentials.yml", "credentials.toml", ".env.local"];
    for (const name of secrets) await writeFile(join(repo.root, name), "do-not-print\n", "utf8");
    const refused = repo.run([plan, repo.base, "WORKTREE"]);
    assert.equal(refused.status, 2, refused.stderr);
    const listed = /like secrets would enter the package: (.*?)\. /u.exec(refused.stderr)?.[1]?.split(", ");
    assert.deepEqual(listed?.toSorted(), secrets.toSorted(), refused.stderr);
    assert.match(refused.stderr, /`git add -- <path>`/u);
    assert.match(refused.stderr, /human's authority/u);
    assert.doesNotMatch(refused.stderr, /do-not-print/u);

    for (const name of secrets.filter((entry) => entry !== "prod.env")) await rm(join(repo.root, name));
    repo.git(["add", "--", "prod.env"]);
    const staged = repo.run([plan, repo.base, "WORKTREE", join(repo.sdd, "staged.diff")]);
    assert.equal(staged.status, 0, staged.stderr);
    assert.match(await readFile(join(repo.sdd, "staged.diff"), "utf8"), /^\+\+\+ b\/prod[.]env$/mu);
  } finally {
    await repo.cleanup();
  }
});

test("review-package never passes an option-like ref to git", async () => {
  const repo = await uncommittedRepo("aaa-review-option-ref-");
  try {
    await writeFile(join(repo.root, "sample.txt"), "one\ntwo\n", "utf8");
    repo.git(["commit", "--quiet", "-am", "second"]);
    repo.git(["update-ref", "refs/heads/--output=pwned.txt", repo.base]);
    const result = repo.run([join(repo.root, "plan.md"), "--output=pwned.txt", "HEAD", join(repo.sdd, "option.diff")]);
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(access(join(repo.root, "pwned.txt")), { code: "ENOENT" });
  } finally {
    await repo.cleanup();
  }
});

test("bash wrappers ignore CDPATH when they resolve their own folder", async (t) => {
  if (process.platform === "win32") {
    t.skip("win32: the bash wrappers target hosts with bash");
    return;
  }
  const root = await mkdtemp(join(tmpdir(), "aaa-cdpath-"));
  try {
    const decoy = join(root, "decoy");
    await mkdir(join(decoy, "scripts"), { recursive: true });
    const plan = join(root, "plan.md");
    await writeFile(plan, "## Task 1: one\nbody\n", "utf8");
    const result = spawnSync("bash", [join("scripts", "task-brief"), plan, "1"], { cwd: skillDirectory, env: { ...process.env, CDPATH: decoy }, encoding: "utf8", shell: false });
    assert.equal(result.status, 0, result.stderr);
    assert.match(await readFile(join(root, "sdd", "task-1-brief.md"), "utf8"), /body/u);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("task-brief accepts only a whole task number and extracts exactly that task", async () => {
  const root = await mkdtemp(join(tmpdir(), "aaa-task-brief-"));
  try {
    const plan = join(root, "plan.md");
    await writeFile(plan, "# Plan\n\n## Task 1: one\nbody one\n\n## Task 11: eleven\nbody eleven\n", "utf8");
    for (const taskNumber of ["1abc", "1.5", "-1", ""]) {
      const result = runNode(taskBriefPath, [plan, taskNumber], root);
      assert.equal(result.status, 2, `task number ${JSON.stringify(taskNumber)} must be refused`);
    }
    const result = runNode(taskBriefPath, [plan, "01"], root);
    assert.equal(result.status, 0, result.stderr);
    const brief = await readFile(join(root, "sdd", "task-1-brief.md"), "utf8");
    assert.match(brief, /body one/u);
    assert.doesNotMatch(brief, /eleven/u);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

const briefPlanLines = [
  "# Plan",
  "",
  "## Phase 1",
  "",
  "### Task 1: one",
  "body one",
  "#### Sub step",
  "sub body",
  "  ```sh",
  "# a shell comment, not a heading",
  "## Task 9: inside an indented fence",
  "  ```",
  "after fence",
  "",
  "### Task 2: two",
  "body two",
  "## task 3: lowercase is not a task heading",
  "lowercase body",
  "### Task 3: three",
  "body three",
  "##### Task 4: a deeper task heading",
  "body four",
  "",
  "## Plan self-review",
  "review text",
  "",
  "## Phase 2",
  "### Task 1: repeated heading",
  "repeat body",
  "### Task 5: last",
  "body five"
];
const briefCases = [
  ["1", ["### Task 1: one", "body one", "#### Sub step", "sub body", "  ```sh", "# a shell comment, not a heading", "## Task 9: inside an indented fence", "  ```", "after fence", ""]],
  ["2", ["### Task 2: two", "body two"]],
  ["3", ["### Task 3: three", "body three"]],
  ["4", ["##### Task 4: a deeper task heading", "body four", ""]],
  ["5", ["### Task 5: last", "body five"]],
  ["9", null]
];

async function assertBriefCases(runBrief) {
  const root = await mkdtemp(join(tmpdir(), "aaa-brief-cases-"));
  try {
    const plan = join(root, "plan.md");
    for (const eol of ["\n", "\r\n"]) {
      await writeFile(plan, `${briefPlanLines.join(eol)}${eol}`, "utf8");
      for (const [task, expected] of briefCases) {
        const label = `Task ${task} with ${JSON.stringify(eol)} line ends`;
        const brief = join(root, "sdd", `task-${task}-brief.md`);
        await rm(brief, { force: true });
        const result = runBrief(plan, task, root);
        if (expected === null) {
          assert.equal(result.status, 3, `${label}: ${result.stderr}`);
          await assert.rejects(access(brief), { code: "ENOENT" }, label);
          continue;
        }
        assert.equal(result.status, 0, `${label}: ${result.stderr}`);
        assert.equal(await readFile(brief, "utf8"), `${expected.join("\n")}\n`, label);
        assert.match(result.stdout, new RegExp(`: ${expected.length} lines\\n$`, "u"), label);
      }
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("task-brief ends a task at the next heading of the same or a higher level and outside fences", async () => {
  await assertBriefCases((plan, task, cwd) => runNode(taskBriefPath, [plan, task], cwd));
});

test("the node scripts refuse a folder as PLAN_FILE and extra arguments", async () => {
  const repo = await uncommittedRepo("aaa-plan-args-");
  try {
    const folder = join(repo.root, "folder-plan");
    await mkdir(folder);
    for (const [script, args] of [[taskBriefPath, [folder, "1"]], [sddWorkspacePath, [folder]], [reviewPackagePath, [folder, repo.base, "WORKTREE"]]]) {
      const result = runNode(script, args, repo.root);
      assert.equal(result.status, 2, `${script}: ${result.stderr}`);
      assert.match(result.stderr, /^no such plan file: /u, script);
    }
    const plan = join(repo.root, "plan.md");
    await writeFile(plan, "## Task 1: one\nbody\n", "utf8");
    for (const [script, args] of [[taskBriefPath, [plan, "1", join(repo.sdd, "brief.md"), "extra"]], [reviewPackagePath, [plan, repo.base, "WORKTREE", join(repo.sdd, "review.diff"), "extra"]]]) {
      const result = runNode(script, args, repo.root);
      assert.equal(result.status, 2, `${script}: ${result.stderr}`);
      assert.match(result.stderr, /^usage: /u, script);
    }
    await assert.rejects(access(repo.sdd), { code: "ENOENT" }, "a refused call must not create sdd/");
  } finally {
    await repo.cleanup();
  }
});

test("every script restores a missing sdd/.gitignore and never overwrites an existing one", async () => {
  const root = await mkdtemp(join(tmpdir(), "aaa-sdd-ignore-"));
  try {
    const plan = join(root, "plan.md");
    const gitignore = join(root, "sdd", ".gitignore");
    await writeFile(plan, "## Task 1: one\nbody\n", "utf8");
    await mkdir(join(root, "sdd"));
    const brief = runNode(taskBriefPath, [plan, "1"], root);
    assert.equal(brief.status, 0, brief.stderr);
    assert.equal(await readFile(gitignore, "utf8"), "*\n");
    await writeFile(gitignore, "custom\n", "utf8");
    const workspace = runNode(sddWorkspacePath, [plan], root);
    assert.equal(workspace.status, 0, workspace.stderr);
    assert.equal(workspace.stdout.trim(), join(root, "sdd"));
    assert.equal(await readFile(gitignore, "utf8"), "custom\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

function findOnPath(name) {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory && existsSync(join(directory, name))) return join(directory, name);
  }
  return null;
}

async function nodeFreeShell(t, toolNames) {
  if (process.platform === "win32") {
    t.skip("win32: the bash wrappers target hosts with bash; a node-free PATH needs symlinks this host may not allow");
    return null;
  }
  const tools = toolNames.map((name) => [name, findOnPath(name)]);
  const missing = tools.filter(([, target]) => !target).map(([name]) => name);
  if (missing.length > 0) {
    t.skip(`tools missing on PATH: ${missing.join(", ")}`);
    return null;
  }
  const bin = await mkdtemp(join(tmpdir(), "aaa-no-node-bin-"));
  const cleanup = async () => {
    // Unlink the links to host tools before the recursive delete of bin.
    for (const [name] of tools) await rm(join(bin, name), { force: true, recursive: false });
    await rm(bin, { force: true, recursive: true });
  };
  try {
    for (const [name, target] of tools) await symlink(target, join(bin, name));
  } catch (error) {
    await cleanup();
    skipIfLinkUnavailable(t, error);
    return null;
  }
  const env = { ...process.env, PATH: bin };
  const bash = join(bin, "bash");
  if (spawnSync(bash, ["-c", "command -v node"], { env }).status === 0) {
    await cleanup();
    t.skip("node is still reachable through the stripped PATH");
    return null;
  }
  return { bin, env, bash, cleanup };
}

test("the bash task-brief fallback extracts the same briefs as task-brief.cjs", async (t) => {
  const shell = await nodeFreeShell(t, ["bash", "awk", "wc", "tr", "dirname", "mkdir", "mktemp", "mv", "rm"]);
  if (!shell) return;
  try {
    const wrapper = (args, cwd) => spawnSync(shell.bash, [join(scriptsDirectory, "task-brief"), ...args], { cwd, env: shell.env, encoding: "utf8", shell: false });
    await assertBriefCases((plan, task, cwd) => wrapper([plan, task], cwd));
    const root = await mkdtemp(join(tmpdir(), "aaa-brief-args-"));
    try {
      const plan = join(root, "plan.md");
      await writeFile(plan, "## Task 1: one\nbody\n", "utf8");
      for (const args of [[root, "1"], [plan, "1", join(root, "sdd", "brief.md"), "extra"]]) {
        assert.equal(wrapper(args, root).status, 2, args.join(" "));
      }
      const missing = wrapper([plan, "9"], root);
      assert.equal(missing.status, 3, missing.stderr);
      assert.match(missing.stderr, /task 9 not found/u);
      await assert.rejects(access(join(root, "sdd")), { code: "ENOENT" }, "a missing task must not create sdd/");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  } finally {
    await shell.cleanup();
  }
});

test("bash wrappers keep working when node is not on PATH", async (t) => {
  const shell = await nodeFreeShell(t, ["bash", "git", "awk", "wc", "tr", "dirname", "mkdir", "mktemp", "mv", "rm"]);
  if (!shell) return;
  const { bin, env, bash } = shell;
  const repo = await uncommittedRepo("aaa-no-node-");
  try {
    const gitProbe = spawnSync(join(bin, "git"), ["--version"], { env, encoding: "utf8" });
    if (gitProbe.status !== 0) {
      t.skip(`git does not run with a stripped PATH: ${gitProbe.stderr.trim()}`);
      return;
    }
    const wrapper = (name, args, cwd = repo.root) => spawnSync(bash, [join(scriptsDirectory, name), ...args], { cwd, env, encoding: "utf8", shell: false });
    const plan = join(repo.root, "plan.md");

    for (const args of [["--snapshot"], [plan, repo.base, "WORKTREE"]]) {
      const refused = wrapper("review-package", args);
      assert.equal(refused.status, 2, refused.stderr);
      assert.match(refused.stderr, /need node/u);
    }

    repo.git(["config", "color.ui", "always"]);
    repo.git(["config", "diff.external", "echo"]);
    await writeFile(join(repo.root, "sample.txt"), "one\ntwo\n", "utf8");
    repo.git(["commit", "--quiet", "-am", "second"]);
    const head = repo.git(["rev-parse", "HEAD"]);
    const empty = wrapper("review-package", [plan, head, head]);
    assert.equal(empty.status, 3, empty.stderr);
    assert.match(empty.stderr, /empty review package/u);
    const packaged = wrapper("review-package", [plan, repo.base, head]);
    assert.equal(packaged.status, 0, packaged.stderr);
    const outFile = /^wrote (.+): 1 commit\(s\), [0-9]+ bytes$/mu.exec(packaged.stdout)?.[1];
    assert.ok(outFile, packaged.stdout);
    const review = await readFile(outFile, "utf8");
    assert.match(review, /^\+two$/mu);
    assert.doesNotMatch(review, /\u001b\[/u);
    assert.equal(await readFile(join(repo.sdd, ".gitignore"), "utf8"), "*\n");

    repo.git(["update-ref", "refs/heads/--output=pwned.txt", repo.base]);
    const optionRef = wrapper("review-package", [plan, "--output=pwned.txt", head]);
    assert.equal(optionRef.status, 0, optionRef.stderr);
    await assert.rejects(access(join(repo.root, "pwned.txt")), { code: "ENOENT" });

    const planLink = join(repo.sdd, "link.diff");
    await symlink(join("..", "plan.md"), planLink);
    for (const target of [plan, planLink, join(repo.sdd, ".GITIGNORE")]) {
      const escaped = wrapper("review-package", [plan, repo.base, head, target]);
      assert.equal(escaped.status, 2, `review-package must refuse ${target}: ${escaped.stderr}`);
    }
    assert.equal(await readFile(plan, "utf8"), "# Test plan\n");

    const outside = wrapper("review-package", [plan, repo.base, head], bin);
    assert.equal(outside.status, 2, outside.stderr);
    assert.match(outside.stderr, /not inside a Git work tree/u);

    const tasks = join(repo.root, "tasks.md");
    await writeFile(tasks, "## Task 1: one\nbody one\n## Task 11: eleven\nbody eleven\n", "utf8");
    const injected = wrapper("task-brief", [tasks, "1|.*"]);
    assert.equal(injected.status, 2, injected.stderr);
    assert.match(injected.stderr, /invalid task number/u);
    const brief = wrapper("task-brief", [tasks, "1"]);
    assert.equal(brief.status, 0, brief.stderr);
    const briefText = await readFile(join(repo.sdd, "task-1-brief.md"), "utf8");
    assert.match(briefText, /body one/u);
    assert.doesNotMatch(briefText, /eleven/u);
    await writeFile(tasks, "## Task 7: seven\nbody seven\n", "utf8");
    const leadingZero = wrapper("task-brief", [tasks, "07"]);
    assert.equal(leadingZero.status, 0, leadingZero.stderr);
    assert.match(await readFile(join(repo.sdd, "task-7-brief.md"), "utf8"), /body seven/u);
    const missing = wrapper("task-brief", [tasks, "9"]);
    assert.equal(missing.status, 3, missing.stderr);
    await assert.rejects(access(join(repo.sdd, "task-9-brief.md")), { code: "ENOENT" });
    for (const target of [plan, planLink, join(repo.sdd, ".GITIGNORE")]) {
      const escaped = wrapper("task-brief", [tasks, "7", target]);
      assert.equal(escaped.status, 2, `task-brief must refuse ${target}: ${escaped.stderr}`);
    }
    assert.equal(await readFile(plan, "utf8"), "# Test plan\n");
    assert.deepEqual((await readdir(repo.sdd)).filter((name) => name.startsWith(".tmp")), []);

    const linkedPlanDirectory = join(repo.root, "linked");
    await mkdir(linkedPlanDirectory);
    await writeFile(join(linkedPlanDirectory, "plan.md"), "## Task 1: one\n", "utf8");
    await symlink(bin, join(linkedPlanDirectory, "sdd"));
    const linkedSdd = wrapper("sdd-workspace", [join(linkedPlanDirectory, "plan.md")]);
    assert.equal(linkedSdd.status, 2, linkedSdd.stderr);
    assert.match(linkedSdd.stderr, /symlink/u);
    assert.equal(wrapper("task-brief", [join(linkedPlanDirectory, "plan.md"), "1"]).status, 2);
    await assert.rejects(access(join(bin, ".gitignore")), { code: "ENOENT" });

    await writeFile(join(repo.sdd, ".gitignore"), "custom\n", "utf8");
    assert.equal(wrapper("sdd-workspace", [plan]).status, 0);
    assert.equal(await readFile(join(repo.sdd, ".gitignore"), "utf8"), "custom\n");
  } finally {
    await repo.cleanup();
    await shell.cleanup();
  }
});

// Every script refuses a symlinked or non-folder sdd/ with exit 2 before any
// task or diff check, so the node and bash paths agree on the exit code.
async function assertSddRefusals(t, run) {
  const repo = await uncommittedRepo("aaa-sdd-refusals-");
  const outside = await mkdtemp(join(tmpdir(), "aaa-sdd-refusals-outside-"));
  try {
    await writeFile(join(repo.root, "sample.txt"), "one\ntwo\n", "utf8");
    repo.git(["commit", "--quiet", "-am", "second"]);
    const head = repo.git(["rev-parse", "HEAD"]);
    const fileDirectory = join(repo.root, "file-sdd");
    const linkDirectory = join(repo.root, "link-sdd");
    for (const directory of [fileDirectory, linkDirectory]) {
      await mkdir(directory);
      await writeFile(join(directory, "plan.md"), "## Task 1: one\nbody\n", "utf8");
    }
    await writeFile(join(fileDirectory, "sdd"), "a file, not a folder\n", "utf8");
    try {
      await symlink(outside, join(linkDirectory, "sdd"), "junction");
    } catch (error) {
      skipIfLinkUnavailable(t, error);
      return;
    }
    for (const [directory, refusal] of [[fileDirectory, /^sdd\/ is not a folder: /mu], [linkDirectory, /^refusing a symlinked sdd\/ folder: /mu]]) {
      const plan = join(directory, "plan.md");
      for (const [name, args] of [["sdd-workspace", [plan]], ["task-brief", [plan, "1"]], ["task-brief", [plan, "9"]], ["review-package", [plan, repo.base, head]], ["review-package", [plan, head, head]]]) {
        const label = `${name} ${args.slice(1).join(" ")} with ${directory}/sdd`;
        const result = run(name, args, repo.root);
        assert.equal(result.status, 2, `${label}: ${result.stderr}`);
        assert.match(result.stderr, refusal, label);
      }
    }
    assert.equal(await readFile(join(fileDirectory, "sdd"), "utf8"), "a file, not a folder\n");
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await repo.cleanup();
    await rm(outside, { force: true, recursive: true });
  }
}

test("the node scripts refuse a symlinked or non-folder sdd/ with exit 2 before task and diff checks", async (t) => {
  await assertSddRefusals(t, (name, args, cwd) => runNode(join(scriptsDirectory, `${name}.cjs`), args, cwd));
});

test("the bash fallbacks refuse a symlinked or non-folder sdd/ with the same exit code as node", async (t) => {
  const shell = await nodeFreeShell(t, ["bash", "git", "awk", "wc", "tr", "dirname", "mkdir", "mktemp", "mv", "rm"]);
  if (!shell) return;
  try {
    const gitProbe = spawnSync(join(shell.bin, "git"), ["--version"], { env: shell.env, encoding: "utf8" });
    if (gitProbe.status !== 0) {
      t.skip(`git does not run with a stripped PATH: ${gitProbe.stderr.trim()}`);
      return;
    }
    await assertSddRefusals(t, (name, args, cwd) => spawnSync(shell.bash, [join(scriptsDirectory, name), ...args], { cwd, env: shell.env, encoding: "utf8", shell: false }));
  } finally {
    await shell.cleanup();
  }
});

test("SKILL.md stays under its word budget and links every companion with a node usage line", async () => {
  const skill = await readFile(skillPath, "utf8");
  const body = skill.slice(skill.indexOf("\n---\n", 4) + 5);
  const words = body.split(/\s+/u).filter(Boolean).length;
  assert.ok(words < 1500, `SKILL.md body has ${words} words; the budget is under 1,500`);
  for (const name of promptNames) assert.ok(skill.includes(`[${name}](${name})`), `SKILL.md must link ${name}`);
  for (const name of ["task-brief", "review-package", "sdd-workspace"]) {
    assert.ok(skill.includes(`node <skill-dir>/scripts/${name}.cjs `), `SKILL.md must show node <skill-dir>/scripts/${name}.cjs`);
  }
});

test("no skill text names a script by its old .js name or as a bash-only command", async () => {
  for (const name of ["SKILL.md", ...promptNames]) {
    const text = await readFile(join(skillDirectory, name), "utf8");
    assert.doesNotMatch(text, /\b(?:task-brief|review-package|sdd-workspace)\.js\b/u, name);
    assert.doesNotMatch(text, /`(?:node )?scripts\/(?:task-brief|review-package|sdd-workspace)/u, `${name} must use node <skill-dir>/scripts/<name>.cjs`);
  }
  for (const name of ["review-package", "sdd-workspace", "task-brief"]) {
    const wrapper = await readFile(join(scriptsDirectory, name), "utf8");
    assert.ok(wrapper.includes(`exec node "\${SCRIPT_DIR}/${name}.cjs" "$@"`), `${name} must delegate to ${name}.cjs`);
  }
});

test("SKILL.md states the dispatch boundary, independent verification, and review hand-offs", async () => {
  const skill = await readFile(skillPath, "utf8");
  const text = flatten(skill);
  assert.ok(text.includes(sddDispatchBoundary), "SKILL.md must carry the SDD-DISPATCH boundary sentence verbatim");
  assert.match(text, /shared worktree and index/u);
  assert.match(text, /coordinator runs the task's verification command itself/u);
  assert.match(text, /a fresh worker on the strongest approved model/u);
  assert.match(text, /trust the ledger and the working tree over recollection/u);
  assert.doesNotMatch(text, /stronger approved/u);
  assert.match(text, /cannot resume a worker/u);
  assert.match(text, /`requesting-code-review`[^.]*`code-reviewer\.md`/u);
  assert.doesNotMatch(skill, /Their write\n/u);
  assert.doesNotMatch(text, /Reject or stop on shell operators/u);
  assert.match(text, /NUL/u);
});

test("worker prompts use a surface-neutral dispatch shape and mandatory TDD", async () => {
  for (const name of promptNames) {
    const prompt = await readFile(join(skillDirectory, name), "utf8");
    assert.doesNotMatch(prompt, /general-purpose|silently inherits|most expensive|more capable model/iu, name);
    for (const field of ["role", "model", "brief", "report"]) {
      assert.match(prompt, new RegExp(`^  ${field}: `, "mu"), `${name} lacks the ${field} dispatch field`);
    }
    assert.match(flatten(prompt), /cannot set a model/u, `${name} must say what to do when a surface cannot set a model`);
  }
  const implementer = flatten(await readFile(join(skillDirectory, "implementer-prompt.md"), "utf8"));
  assert.doesNotMatch(implementer, /if task says|if required|Ask them now|ask questions|your report is the test evidence/iu);
  assert.match(implementer, /test-driven-development for every behavior change/u);
  assert.match(implementer, /no-behavior change/u);
  assert.match(implementer, /NEEDS_CONTEXT with your questions/u);
  assert.match(implementer, /cannot resume a worker/u);
  const reviewer = flatten(await readFile(join(skillDirectory, "task-reviewer-prompt.md"), "utf8"));
  assert.match(reviewer, /Untracked files included/u);
  assert.match(reviewer, /controller runs the task's verification command/u);
});

test("the overlapping-writers non-trigger does not name the skill it tests", async () => {
  const evaluation = JSON.parse(await readFile(evaluationPath, "utf8"));
  const nonTrigger = evaluation.cases.find((entry) => entry.id === "SD-NONTRIGGER-overlapping-writers");
  assert.doesNotMatch(nonTrigger.prompt, /subagent-driven-development/u);
  assert.match(nonTrigger.prompt, /depends on/u);
});
