import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { access, link, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { makeTempRoot } from "../helpers/temp-root.mjs";
import { skipIfLinkUnavailable } from "../helpers/symlink.mjs";
import { loadCore } from "../../installers/lib/load-core.mjs";
import { renderClaude } from "../../adapters/claude/adapter.mjs";
import { renderCodex } from "../../adapters/codex/adapter.mjs";
import { renderAntigravity } from "../../adapters/antigravity/adapter.mjs";

const scripts = resolve("core/skills/subagent-driven-development/scripts");
const briefScript = join(scripts, "task-brief.cjs");
const startScript = resolve("core/skills/executing-plans/scripts/task-start.cjs");
const doneScript = resolve("core/skills/executing-plans/scripts/task-done.cjs");
const run = (script, args, cwd) => spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", shell: false });

async function fixture() {
  const root = await makeTempRoot("aaa-execution ทีม spaces-");
  const plan = join(root, "plan ทีม with spaces.md");
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  await writeFile(plan, "# Plan\n**Spec:** ./spec.md\n\n## Global Constraints\nPreserve work.\n\n## Task 1: first\nCheck first.\n\n## Task 2: second\nCheck second.\n");
  git(["init", "--quiet"]);
  git(["add", "."]);
  git(["-c", "user.name=AAA Test", "-c", "user.email=aaa-test@example.invalid", "commit", "--quiet", "-m", "fixture"]);
  return { root, plan, git, sdd: join(root, "sdd", "plan ทีม with spaces.md"), cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("task-brief includes exact spec pointer and Global Constraints while ignoring fenced task headings", async () => {
  const root = await mkdtemp(join(tmpdir(), "aaa-execution-brief-"));
  try {
    const plan = join(root, "plan ทีม with spaces.md");
    const spec = "**Spec:** [Approved spec](../spec ทีม.md#scope)";
    await writeFile(plan, [
      "# Plan", spec, "", "~~~~markdown", "## Task 1: fake", "fake body", "~~~~", "",
      "## Global Constraints", "Keep user work.", "", "```text", "## Task 8: fake constraint", "```", "",
      "## Task 1: real", "real body", "````markdown", "```", "## Task 9: fake nested fence", "````", "after fence", "",
      "## Task 2: next", "next body", ""
    ].join("\n"));

    const result = run(briefScript, [plan, "1"], root);

    assert.equal(result.status, 0, result.stderr);
    const brief = await readFile(join(root, "sdd", "plan ทีม with spaces.md", "task-1-brief.md"), "utf8");
    assert.ok(brief.includes(spec), "worker needs the exact spec pointer");
    assert.match(brief, /## Global Constraints\nKeep user work\./u);
    assert.match(brief, /## Task 1: real\nreal body/u);
    assert.match(brief, /after fence/u);
    assert.doesNotMatch(brief, /Task 1: fake|fake body|Task 2: next|next body/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("optional Git Bash fallback keeps the same brief context without Node on PATH", { skip: process.platform !== "win32" }, async (t) => {
  const gitPath = spawnSync("where.exe", ["git"], { encoding: "utf8", shell: false }).stdout?.trim().split(/\r?\n/u)[0];
  const gitRoot = gitPath && dirname(dirname(gitPath));
  const bash = gitRoot && join(gitRoot, "bin", "bash.exe");
  if (!bash || !existsSync(bash)) { t.skip("Git Bash unavailable"); return; }
  const root = await mkdtemp(join(tmpdir(), "aaa-execution-bash-"));
  try {
    const plan = join(root, "plan.md");
    await writeFile(plan, "# Plan\n**Spec:** ./spec.md\n\n~~~text\n## Task 1: fake\n~~~\n\n## Global Constraints\nKeep user work.\n\n## Task 1: real\nbody\n## Task 2: next\n");
    const result = spawnSync(bash, [join(scripts, "task-brief").replaceAll("\\", "/"), plan.replaceAll("\\", "/"), "1"], {
      cwd: root, env: { ...process.env, PATH: join(gitRoot, "usr", "bin") }, encoding: "utf8", shell: false
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(root, "sdd", "plan.md", "task-1-brief.md"), "utf8"), "**Spec:** ./spec.md\n\n## Global Constraints\nKeep user work.\n\n## Task 1: real\nbody\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("task-start CLI returns a real current-tree base and brief without changing the real index or refs", async () => {
  const repo = await fixture();
  try {
    await writeFile(join(repo.root, "user work.txt"), "not committed\n");
    const indexBefore = await readFile(join(repo.root, ".git", "index"));
    const refsBefore = repo.git(["for-each-ref"]);
    const result = run(startScript, [repo.plan, "1"], repo.root);
    assert.equal(result.status, 0, `task-start CLI must exist and run: ${result.stderr}`);
    const started = JSON.parse(result.stdout);
    assert.equal(started.briefPath, join(repo.sdd, "task-1-brief.md"));
    assert.equal(repo.git(["cat-file", "-t", started.base]), "tree");
    assert.match(repo.git(["ls-tree", "--name-only", started.base]), /user work[.]txt/u);
    assert.doesNotMatch(repo.git(["ls-tree", "-r", "--name-only", started.base]), /sdd\//u);
    assert.match(await readFile(started.briefPath, "utf8"), /Spec:.*spec[.]md/su);
    assert.deepEqual(await readFile(join(repo.root, ".git", "index")), indexBefore);
    assert.equal(repo.git(["for-each-ref"]), refsBefore);
    assert.equal(await readFile(join(repo.root, "user work.txt"), "utf8"), "not committed\n");
  } finally {
    await repo.cleanup();
  }
});

test("task-start rejects invalid tasks and secret-like untracked work before creating its workspace", async () => {
  const repo = await fixture();
  try {
    for (const task of ["no", "1.2", "9007199254740992", "8"]) {
      const result = run(startScript, [repo.plan, task], repo.root);
      assert.equal(result.status, task === "8" ? 3 : 2, result.stderr);
    }
    await writeFile(join(repo.root, ".env"), "fixture-only\n");
    const result = run(startScript, [repo.plan, "1"], repo.root);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /untracked files that look like secrets/u);
    await assert.rejects(access(repo.sdd), { code: "ENOENT" });
  } finally {
    await repo.cleanup();
  }
});

test("task-start restores workspace ignore before snapshot and preserves existing files", async () => {
  const repo = await fixture();
  try {
    await mkdir(repo.sdd, { recursive: true });
    await writeFile(join(repo.sdd, "old-evidence.md"), "preserve me\n");
    const result = run(startScript, [repo.plan, "1"], repo.root);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(repo.git(["ls-tree", "-r", "--name-only", JSON.parse(result.stdout).base]), /sdd\//u);
    assert.equal(await readFile(join(repo.sdd, "old-evidence.md"), "utf8"), "preserve me\n");
    await writeFile(join(repo.sdd, ".gitignore"), "custom rule\n");
    assert.equal(run(startScript, [repo.plan, "2"], repo.root).status, 0);
    assert.equal(await readFile(join(repo.sdd, ".gitignore"), "utf8"), "custom rule\n");
  } finally {
    await repo.cleanup();
  }
});

test("task-done CLI runs exact argv, keeps full output, and records same-plan completion only on success", async () => {
  const repo = await fixture();
  try {
    const runner = join(repo.root, "runner ทีม with spaces.cjs");
    const args = ["space data", "ทีม", "; & | $(touch owned-marker) `echo data`", 'quote " data'];
    await writeFile(runner, "console.log(JSON.stringify(process.argv.slice(2))); console.error('last error stream line');\n");
    const started = run(startScript, [repo.plan, "1"], repo.root);
    assert.equal(started.status, 0, started.stderr);
    const { base } = JSON.parse(started.stdout);
    const indexBefore = await readFile(join(repo.root, ".git", "index"));
    const refsBefore = repo.git(["for-each-ref"]);
    const result = run(doneScript, [repo.plan, "1", base, "--", process.execPath, runner, ...args], repo.root);
    assert.equal(result.status, 0, `task-done CLI must exist and run: ${result.stderr}`);
    const done = JSON.parse(result.stdout);
    assert.equal(done.completed, true);
    assert.equal(done.exitCode, 0);
    const log = await readFile(done.logPath, "utf8");
    assert.ok(log.includes(JSON.stringify(args)), "arguments must reach the child as data");
    assert.match(log, /last error stream line/u);
    const ledger = await readFile(join(repo.sdd, "progress.md"), "utf8");
    assert.ok(ledger.startsWith(`# SDD ledger — plan: ${repo.plan}\n`));
    assert.match(ledger, /Task 1: completed/u);
    assert.ok(ledger.includes(base));
    assert.ok(ledger.includes(JSON.stringify([process.execPath, runner, ...args])));
    assert.deepEqual(await readFile(join(repo.root, ".git", "index")), indexBefore);
    assert.equal(repo.git(["for-each-ref"]), refsBefore);
    await assert.rejects(access(join(repo.root, "owned-marker")), { code: "ENOENT" });

    const beforeFailure = ledger;
    const failed = run(doneScript, [repo.plan, "2", base, "--", process.execPath, "-e", "console.error('check failed'); process.exit(7)"], repo.root);
    assert.equal(failed.status, 7, failed.stderr);
    assert.equal(JSON.parse(failed.stdout).completed, false);
    assert.match(failed.stderr, /exited 7/u);
    assert.match(await readFile(JSON.parse(failed.stdout).logPath, "utf8"), /check failed/u);
    assert.equal(await readFile(join(repo.sdd, "progress.md"), "utf8"), beforeFailure);
  } finally {
    await repo.cleanup();
  }
});

test("task-done accepts silent success and reports launch failure without completing that task", async () => {
  const repo = await fixture();
  try {
    const base = repo.git(["rev-parse", "HEAD"]);
    const silent = run(doneScript, [repo.plan, "1", base, "--", process.execPath, "-e", ""], repo.root);
    assert.equal(silent.status, 0, silent.stderr);
    assert.equal(JSON.parse(silent.stdout).completed, true);
    assert.equal(await readFile(JSON.parse(silent.stdout).logPath, "utf8"), "");
    const ledger = await readFile(join(repo.sdd, "progress.md"), "utf8");
    const missing = run(doneScript, [repo.plan, "2", base, "--", join(repo.root, "no-such-executable")], repo.root);
    assert.equal(missing.status, 127, missing.stderr);
    assert.equal(JSON.parse(missing.stdout).completed, false);
    assert.match(missing.stderr, /cannot launch.*native executable|cannot launch.*node <runner>/u);
    assert.equal(await readFile(join(repo.sdd, "progress.md"), "utf8"), ledger);
  } finally {
    await repo.cleanup();
  }
});

test("task-done preserves distinct immutable logs across a success, failed rerun, and successful rerun", async () => {
  const repo = await fixture();
  try {
    const attempt = (text, code) => run(doneScript, [repo.plan, "1", "HEAD", "--", process.execPath, "-e", `console.log(${JSON.stringify(text)}); process.exit(${code})`], repo.root);
    const first = attempt("first successful evidence", 0);
    assert.equal(first.status, 0, first.stderr);
    const firstPath = JSON.parse(first.stdout).logPath;
    const firstLog = await readFile(firstPath);
    const firstLedger = await readFile(join(repo.sdd, "progress.md"), "utf8");
    assert.ok(firstLedger.includes(JSON.stringify(firstPath)));

    const failed = attempt("failed rerun evidence", 7);
    assert.equal(failed.status, 7, failed.stderr);
    const failedResult = JSON.parse(failed.stdout);
    assert.equal(failedResult.completed, false);
    assert.deepEqual(await readFile(firstPath), firstLog, "failed rerun must preserve the completed attempt's exact log");
    assert.notEqual(failedResult.logPath, firstPath);
    const failedLog = await readFile(failedResult.logPath);
    assert.equal(await readFile(join(repo.sdd, "progress.md"), "utf8"), firstLedger, "failed rerun adds no completion");

    const last = attempt("last successful evidence", 0);
    assert.equal(last.status, 0, last.stderr);
    const lastPath = JSON.parse(last.stdout).logPath;
    assert.equal(new Set([firstPath, failedResult.logPath, lastPath]).size, 3, "every attempt reports its own evidence path");
    assert.deepEqual(await readFile(firstPath), firstLog);
    assert.deepEqual(await readFile(failedResult.logPath), failedLog);
    assert.match(await readFile(lastPath, "utf8"), /last successful evidence/u);
    const ledger = await readFile(join(repo.sdd, "progress.md"), "utf8");
    assert.equal(ledger.match(/Task 1: completed/gu)?.length, 2);
    assert.ok(ledger.includes(JSON.stringify(firstPath)));
    assert.ok(ledger.includes(JSON.stringify(lastPath)));
    assert.ok(!ledger.includes(JSON.stringify(failedResult.logPath)));
    for (const logPath of [firstPath, failedResult.logPath, lastPath]) assert.equal((await stat(logPath)).nlink, 1);
  } finally {
    await repo.cleanup();
  }
});

test("task-done validates task, base, plan, and argument controls before child or workspace writes", async () => {
  const repo = await fixture();
  try {
    const marker = join(repo.root, "child-ran");
    const childArgs = ["--", process.execPath, "-e", "require('node:fs').writeFileSync(process.argv[1], 'ran')", marker];
    for (const [plan, task, base] of [[repo.plan, "8", "HEAD"], [repo.plan, "1x", "HEAD"], [repo.plan, "1", "missing-base"], [repo.root, "1", "HEAD"]]) {
      const result = run(doneScript, [plan, task, base, ...childArgs], repo.root);
      assert.equal(result.status, task === "8" ? 3 : 2, result.stderr);
    }
    const controls = run(doneScript, [repo.plan, "1", "HEAD", "--", process.execPath, "bad\narg"], repo.root);
    assert.equal(controls.status, 2, controls.stderr);
    assert.match(controls.stderr, /control characters/u);
    await assert.rejects(access(marker), { code: "ENOENT" });
    await assert.rejects(access(repo.sdd), { code: "ENOENT" });
  } finally {
    await repo.cleanup();
  }
});

test("task-done rejects a foreign ledger copied into a plan workspace before running the child", async () => {
  const repo = await fixture();
  try {
    const first = run(doneScript, [repo.plan, "1", "HEAD", "--", process.execPath, "-e", ""], repo.root);
    assert.equal(first.status, 0, first.stderr);
    const otherPlan = join(repo.root, "other plan.md");
    await writeFile(otherPlan, "## Task 2: other\nDo other work.\n");
    const ledger = await readFile(join(repo.sdd, "progress.md"), "utf8");
    const otherSdd = join(repo.root, "sdd", "other plan.md");
    await mkdir(otherSdd, { recursive: true });
    await writeFile(join(otherSdd, "progress.md"), ledger);
    const result = run(doneScript, [otherPlan, "2", "HEAD", "--", process.execPath, "-e", "require('node:fs').writeFileSync('child-ran', 'ran')"], repo.root);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /ledger.*plan/u);
    assert.equal(await readFile(join(repo.sdd, "progress.md"), "utf8"), ledger);
    await assert.rejects(access(join(repo.root, "child-ran")), { code: "ENOENT" });
    assert.equal((await readdir(otherSdd)).some((name) => name.startsWith("task-2-tests")), false);
  } finally {
    await repo.cleanup();
  }
});

test("two plans in one parent start and complete separately while legacy shared evidence stays untouched", async () => {
  const repo = await fixture();
  try {
    await mkdir(join(repo.root, "sdd"));
    await writeFile(join(repo.root, "sdd", "progress.md"), "unverified legacy ledger\n");
    await writeFile(join(repo.root, "sdd", "task-1-brief.md"), "legacy brief\n");
    await writeFile(join(repo.root, "sdd", ".gitignore"), "legacy rule\n");
    const started = run(startScript, [repo.plan, "1"], repo.root);
    assert.equal(started.status, 0, started.stderr);
    assert.equal(JSON.parse(started.stdout).briefPath, join(repo.sdd, "task-1-brief.md"));
    const firstDone = run(doneScript, [repo.plan, "1", JSON.parse(started.stdout).base, "--", process.execPath, "-e", "console.log('first plan')"], repo.root);
    assert.equal(firstDone.status, 0, firstDone.stderr);
    const brief = await readFile(join(repo.sdd, "task-1-brief.md"), "utf8");
    const firstLogPath = JSON.parse(firstDone.stdout).logPath;
    const log = await readFile(firstLogPath, "utf8");
    const ledger = await readFile(join(repo.sdd, "progress.md"), "utf8");
    const other = join(repo.root, "other plan.md");
    await writeFile(other, "## Task 1: unrelated\nOther plan evidence.\n");
    const second = run(startScript, [other, "1"], repo.root);
    assert.equal(second.status, 0, second.stderr);
    const otherSdd = join(repo.root, "sdd", "other plan.md");
    assert.equal(JSON.parse(second.stdout).briefPath, join(otherSdd, "task-1-brief.md"));
    const secondDone = run(doneScript, [other, "1", JSON.parse(second.stdout).base, "--", process.execPath, "-e", "console.log('second plan')"], repo.root);
    assert.equal(secondDone.status, 0, secondDone.stderr);
    assert.match(await readFile(JSON.parse(secondDone.stdout).logPath, "utf8"), /second plan/u);
    assert.match(await readFile(join(otherSdd, "progress.md"), "utf8"), /Task 1: completed/u);
    assert.equal(await readFile(join(repo.sdd, "task-1-brief.md"), "utf8"), brief);
    assert.equal(await readFile(firstLogPath, "utf8"), log);
    assert.equal(await readFile(join(repo.sdd, "progress.md"), "utf8"), ledger);
    assert.equal(await readFile(join(repo.root, "sdd", "progress.md"), "utf8"), "unverified legacy ledger\n");
    assert.equal(await readFile(join(repo.root, "sdd", "task-1-brief.md"), "utf8"), "legacy brief\n");
    assert.equal(await readFile(join(repo.root, "sdd", ".gitignore"), "utf8"), "legacy rule\n");
  } finally {
    await repo.cleanup();
  }
});

test("task-done refuses linked ledger targets before running the child", async (t) => {
  const repo = await fixture();
  try {
    await mkdir(repo.sdd, { recursive: true });
    const outside = join(repo.root, "untouched.txt");
    await writeFile(outside, "untouched\n");
    const target = join(repo.sdd, "progress.md");
    await link(outside, target);
    const result = run(doneScript, [repo.plan, "1", "HEAD", "--", process.execPath, "-e", "require('node:fs').writeFileSync('child-ran', 'ran')"], repo.root);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /not a regular file with one link/u);
    await unlink(target);
    try {
      await symlink(outside, target);
    } catch (error) {
      skipIfLinkUnavailable(t, error);
      return;
    }
    const linked = run(doneScript, [repo.plan, "1", "HEAD", "--", process.execPath, "-e", "require('node:fs').writeFileSync('child-ran', 'ran')"], repo.root);
    assert.equal(linked.status, 2, linked.stderr);
    assert.equal(await readFile(outside, "utf8"), "untouched\n");
    await assert.rejects(access(join(repo.root, "child-ran")), { code: "ENOENT" });
    assert.deepEqual((await readdir(repo.sdd)).filter((name) => name.startsWith(".tmp")), []);
  } finally {
    await repo.cleanup();
  }
});

test("task-done bounds large logs and printed output, and refuses to complete an overflowed check", async () => {
  const repo = await fixture();
  try {
    const result = run(doneScript, [repo.plan, "1", "HEAD", "--", process.execPath, "-e", "process.stdout.write('x'.repeat(9 * 1024 * 1024))"], repo.root);
    assert.notEqual(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).completed, false);
    assert.match(result.stderr, /log.*limit/u);
    assert.ok(Buffer.byteLength(result.stdout) < 32768);
    assert.ok((await stat(JSON.parse(result.stdout).logPath)).size <= 8 * 1024 * 1024 + 256);
    await assert.rejects(access(join(repo.sdd, "progress.md")), { code: "ENOENT" });
  } finally {
    await repo.cleanup();
  }
});

test("task-done refuses Windows command scripts with an explicit interpreter hint", { skip: process.platform !== "win32" }, async () => {
  const repo = await fixture();
  try {
    const command = join(repo.root, "runner.cmd");
    await writeFile(command, "@echo off\r\necho ran>child-ran\r\n");
    const result = run(doneScript, [repo.plan, "1", "HEAD", "--", command], repo.root);
    assert.notEqual(result.status, 0, result.stderr);
    assert.match(result.stderr, /node <runner>/u);
    await assert.rejects(access(join(repo.root, "child-ran")), { code: "ENOENT" });
    await assert.rejects(access(join(repo.sdd, "progress.md")), { code: "ENOENT" });
  } finally {
    await repo.cleanup();
  }
});

test("review-package rejects unrelated or reversed committed ranges and empty evidence", async () => {
  const repo = await fixture();
  try {
    const base = repo.git(["rev-parse", "HEAD"]);
    await writeFile(join(repo.root, "new.txt"), "change\n");
    repo.git(["add", "."]);
    repo.git(["-c", "user.name=AAA Test", "-c", "user.email=aaa-test@example.invalid", "commit", "--quiet", "-m", "second"]);
    const head = repo.git(["rev-parse", "HEAD"]);
    const unrelated = repo.git(["-c", "user.name=AAA Test", "-c", "user.email=aaa-test@example.invalid", "commit-tree", `${head}^{tree}`, "-m", "unrelated root"]);
    for (const [from, to] of [[base, unrelated], [head, base]]) {
      const result = run(join(scripts, "review-package.cjs"), [repo.plan, from, to], repo.root);
      assert.equal(result.status, 2, "committed BASE must be an ancestor of HEAD");
      assert.match(result.stderr, /BASE.*ancestor.*HEAD/u);
    }
    const empty = run(join(scripts, "review-package.cjs"), [repo.plan, head, head], repo.root);
    assert.equal(empty.status, 3, empty.stderr);
    assert.match(empty.stderr, /empty review package/u);
    await assert.rejects(access(repo.sdd), { code: "ENOENT" });
  } finally {
    await repo.cleanup();
  }
});

test("all rendered surfaces and profiles deliver runnable start/done helpers and all runtime dependencies", async () => {
  const repo = await fixture();
  const outputRoot = await mkdtemp(join(tmpdir(), "aaa-execution-package-"));
  try {
    const core = await loadCore(process.cwd());
    for (const [surface, render] of [["claude", renderClaude], ["codex", renderCodex], ["antigravity", renderAntigravity]]) {
      for (const profile of ["portable", "template"]) {
        const rendered = render({ core, profile, platform: process.platform, env: {}, homeDir: outputRoot });
        const delivered = rendered.files.filter((file) => /\/(?:executing-plans|subagent-driven-development)\/scripts\/.*[.]cjs$/u.test(file.relativePath));
        const start = delivered.find((file) => file.relativePath.endsWith("/executing-plans/scripts/task-start.cjs"));
        const done = delivered.find((file) => file.relativePath.endsWith("/executing-plans/scripts/task-done.cjs"));
        assert.ok(start && done, `${surface}/${profile} must deliver both public helpers`);
        const packageRoot = join(outputRoot, surface, profile);
        for (const file of delivered) {
          const target = resolve(packageRoot, ...file.relativePath.split("/"));
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, file.content);
        }
        const started = run(resolve(packageRoot, start.relativePath), [repo.plan, "1"], repo.root);
        assert.equal(started.status, 0, `${surface}/${profile}: ${started.stderr}`);
        const finished = run(resolve(packageRoot, done.relativePath), [repo.plan, "1", JSON.parse(started.stdout).base, "--", process.execPath, "-e", ""], repo.root);
        assert.equal(finished.status, 0, `${surface}/${profile}: ${finished.stderr}`);
        assert.equal(JSON.parse(finished.stdout).completed, true);
      }
    }
  } finally {
    await repo.cleanup();
    await rm(outputRoot, { recursive: true, force: true });
  }
});
