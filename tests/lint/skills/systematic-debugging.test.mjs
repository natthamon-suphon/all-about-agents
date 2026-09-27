import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const skillId = "systematic-debugging";
const requiredCases = [
  "DB-TRIGGER-failure-or-regression",
  "DB-NONTRIGGER-known-requested-change",
  "DB-PRESSURE-print-env-guess-fix",
  "DB-NONTRIGGER-latency-target-no-failure",
];
const skillDir = new URL(`../../../core/skills/${skillId}/`, import.meta.url);
const readSkillFile = (name) => readFile(new URL(name, skillDir), "utf8");
const debugPerfBoundary = "A failure or regression with an unknown cause goes to `systematic-debugging` first; measuring, profiling, or proving a performance change goes to `performance-profiling-and-benchmarking`.";

test("systematic-debugging gates fixes on safe, minimal evidence", async () => {
  const skill = await readSkillFile("SKILL.md");
  const redFlags = await readSkillFile("red-flags.md");
  const rootCause = await readSkillFile("root-cause-tracing.md");
  assert.match(skill, /Skill Gate Protocol/iu);
  assert.match(skill, /NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST/iu);
  assert.match(skill, /smallest reproducible evidence/iu);
  assert.match(skill, /nondeterministic/iu);
  assert.match(skill, /disposable root/iu);
  assert.match(skill, /pre-existing pollution/iu);
  assert.match(skill, /not run/iu);
  assert.ok(skill.includes(debugPerfBoundary), "SKILL.md must state the DEBUG-PERF boundary sentence");
  for (const text of [skill, redFlags, rootCause]) {
    assert.doesNotMatch(text, /95%/u);
    assert.doesNotMatch(text, /(?:printenv|env)\s*\|/iu);
    assert.doesNotMatch(text, /echo\s+[^\n]*(?:TOKEN|SECRET|IDENTITY)/iu);
  }
});

test("systematic-debugging keeps owner rules for commits, regression tests, and mitigations", async () => {
  const skill = await readSkillFile("SKILL.md");
  const redFlags = await readSkillFile("red-flags.md");
  assert.doesNotMatch(skill, /stated in the commit or PR message/iu);
  assert.match(skill, /final report/iu);
  assert.match(skill, /only\s+when\s+the\s+user\s+authorizes/iu);
  assert.doesNotMatch(skill, /fix the bug without the regression test/iu);
  assert.match(skill, /ask\s+your\s+human\s+partner\s+before\s+landing\s+a\s+fix\s+with\s+no\s+automated\s+regression\s+test/iu);
  assert.doesNotMatch(skill, /Implement appropriate handling/iu);
  assert.match(skill, /temporary\s+mitigation/iu);
  assert.match(skill, /interactive\s+debugger\s+is\s+available/iu);
  assert.doesNotMatch(`${skill}\n${redFlags}`, /2\+/u);
  assert.match(redFlags, /after\s+3\s+failed\s+fixes/iu);
});

test("systematic-debugging moves pressure material into a linked companion", async () => {
  const skill = await readSkillFile("SKILL.md");
  const redFlags = await readSkillFile("red-flags.md");
  assert.match(skill, /\]\(red-flags\.md\)/u);
  assert.match(skill, /\]\(root-cause-tracing\.md#find-the-failing-boundary\)/u);
  assert.match(redFlags, /Common Rationalizations/u);
  assert.match(redFlags, /Stop guessing/u);
  assert.match(redFlags, /Return to Phase 1/iu);
});

test("systematic-debugging references are resolvable and examples do not disclose configuration", async () => {
  const rootCause = await readSkillFile("root-cause-tracing.md");
  const feedbackLoops = await readSkillFile("feedback-loops.md");
  const waiting = await readSkillFile("condition-based-waiting.md");
  const skill = await readSkillFile("SKILL.md");

  assert.doesNotMatch(rootCause, /\w+\s*:\s*process\.env(?:\.|\[)/u);
  assert.match(rootCause, /never dump the\s+environment/iu);
  assert.doesNotMatch(`${feedbackLoops}\n${waiting}`, /\b\d{1,3}%/u);
  assert.doesNotMatch(`${skill}\n${feedbackLoops}`, /scripts\/hitl-loop\.template\.sh/u);
  await access(new URL("hitl-loop.template.sh", skillDir));
});

test("systematic-debugging boundary example prints presence with real newlines", async () => {
  const rootCause = await readSkillFile("root-cause-tracing.md");
  const skill = await readSkillFile("SKILL.md");
  assert.match(rootCause, /## Find the Failing Boundary/u);
  assert.match(rootCause, /printf '\[DEBUG-[0-9a-f]{4}\][^'\n]*%s\\n' "\$\{[A-Z_]+:\+yes\}"/u);
  assert.doesNotMatch(`${skill}\n${rootCause}`, /'%s\\\\n'/u);
});

test("systematic-debugging companions agree on dead ends, extra layers, and debug tags", async () => {
  const rootCause = await readSkillFile("root-cause-tracing.md");
  const defense = await readSkillFile("defense-in-depth.md");
  assert.doesNotMatch(rootCause, /Fix at symptom point/u);
  assert.equal(rootCause.match(/"Report the dead end and ask"/gu)?.length >= 2, true, "both graphs must end a dead end with report-and-ask");
  assert.doesNotMatch(rootCause, /Add validation at each layer/u);
  assert.match(rootCause, /\[DEBUG-a4f2\] git init/u);
  assert.doesNotMatch(rootCause, /'DEBUG git init/u);
  assert.doesNotMatch(defense, /Validate at EVERY layer/iu);
  assert.doesNotMatch(defense, /Add checks at every layer/iu);
  assert.match(defense, /separate change/iu);
  assert.match(defense, /approv/iu);
  assert.match(defense, /\[DEBUG-a4f2\]/u);
  assert.doesNotMatch(defense, /startsWith\(tmpDir\)/u);
  assert.match(defense, /realpathSync/u);
  assert.match(defense, /relative\(/u);
});

test("systematic-debugging loops are honest about humans, flakiness, and bisect", async () => {
  const feedbackLoops = await readSkillFile("feedback-loops.md");
  const template = await readSkillFile("hitl-loop.template.sh");
  assert.doesNotMatch(template, /The agent runs the script/u);
  assert.match(template, /own terminal/u);
  assert.doesNotMatch(feedbackLoops, /a human enters the loop only via/u);
  assert.match(feedbackLoops, /own terminal/u);
  assert.doesNotMatch(feedbackLoops, /pinned, high reproduction rate/u);
  assert.match(feedbackLoops, /labeled nondeterministic/iu);
  assert.match(feedbackLoops, /disposable worktree/iu);
  assert.match(feedbackLoops, /git bisect reset/u);
});

test("systematic-debugging companions carry no stale claims or orphan helpers", async () => {
  const names = (await readdir(skillDir)).filter((name) => name.endsWith(".md"));
  const texts = await Promise.all(names.map(readSkillFile));
  const all = texts.join("\n");
  assert.doesNotMatch(all, /condition-based-waiting-example/u);
  assert.doesNotMatch(all, /all-about-agents:/u, "use bare skill names; no adapter rewrites the prefix");
  assert.doesNotMatch(all, /waitForEvent\b/u);
  assert.doesNotMatch(all, /\b\d+ tests passed|debugging session \(\d{4}/iu);
  const waiting = await readSkillFile("condition-based-waiting.md");
  assert.match(waiting, /description = '/u);
  const rootCause = await readSkillFile("root-cause-tracing.md");
  assert.doesNotMatch(rootCause, /\.\/find-polluter\.sh/u);
  assert.match(rootCause, /must not already exist/iu);
});

test("find-polluter preserves filenames, selects a runner, and reports failures", async () => {
  const script = await readSkillFile("find-polluter.sh");
  assert.match(script, /-print0/iu);
  assert.match(script, /read\s+-r\s+-d/iu);
  assert.ok(script.includes('for TEST_FILE in "${TEST_FILES[@]}"'));
  assert.match(script, /TEST_RUNNER/iu);
  assert.match(script, /pre-existing pollution/iu);
  assert.match(script, /no test files matched/iu);
  assert.match(script, /test failed/iu);
  assert.ok(script.includes('"$RUNNER" test -- "$TEST_FILE"'), "package managers keep the test -- form");
  assert.ok(script.includes('"$RUNNER" "$TEST_FILE"'), "a path runner gets only the file");
  assert.match(script, /-name node_modules -prune/u);
  assert.doesNotMatch(script, /\$0 '\.git'/u);
  assert.doesNotMatch(script, /for TEST_FILE in \$TEST_FILES/u);
  assert.doesNotMatch(script, /\|\|\s*true/u);
});

const bashUnavailable = process.platform === "win32"
  ? "find-polluter.sh is a POSIX script; the Windows run is not covered"
  : spawnSync("bash", ["--version"], { encoding: "utf8" }).status === 0
    ? false
    : "bash is unavailable";

test("find-polluter runs a path runner once per file, skips node_modules, and refuses existing state", { skip: bashUnavailable }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aaa-find-polluter-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixtures = new URL("../../fixtures/systematic-debugging/runner/", import.meta.url);
  const script = fileURLToPath(new URL("find-polluter.sh", skillDir));
  const runner = join(root, "bin", "fixture-runner.sh");
  await mkdir(join(root, "bin"));
  await copyFile(new URL("fixture-runner.sh", fixtures), runner);
  await chmod(runner, 0o755);

  async function project(name, files) {
    const dir = join(root, name);
    for (const [relative, fixture] of files) {
      const target = join(dir, ...relative.split("/"));
      await mkdir(join(target, ".."), { recursive: true });
      if (fixture) await copyFile(new URL(fixture, fixtures), target);
      else await writeFile(target, "#!/usr/bin/env bash\nexit 0\n");
    }
    return dir;
  }

  function run(cwd, check, pattern) {
    const env = { ...process.env, POLLUTION_TARGET: join(cwd, check) };
    delete env.TEST_RUNNER;
    return spawnSync("bash", [script, check, pattern, runner], { cwd, env, encoding: "utf8" });
  }

  const polluted = await project("polluted", [["tests/clean test.sh", "clean test.sh"], ["tests/create pollution.sh", "create pollution.sh"]]);
  const found = run(polluted, "state/marker", "tests/**/*.sh");
  assert.equal(found.status, 1, found.stdout + found.stderr);
  assert.match(found.stdout, /FOUND POLLUTER: \.\/tests\/create pollution\.sh/u);

  const vendored = await project("vendored", [["clean test.sh", "clean test.sh"], ["node_modules/dep/vendored.sh", null]]);
  const clean = run(vendored, "state/marker", "**/*.sh");
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /Found 1 test files/u);

  const existing = await project("existing", [["clean test.sh", "clean test.sh"], ["state/marker", null]]);
  const refused = run(existing, "state/marker", "*.sh");
  assert.equal(refused.status, 3, refused.stdout + refused.stderr);
  assert.match(refused.stderr, /pre-existing pollution/u);
});

test("find-polluter treats Windows npm.cmd and bun.EXE as package managers", { skip: bashUnavailable }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aaa-find-polluter-pm-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = fileURLToPath(new URL("find-polluter.sh", skillDir));
  await mkdir(join(root, "bin"));
  await mkdir(join(root, "project"));
  await writeFile(join(root, "project", "a.test.sh"), "#!/usr/bin/env bash\nexit 0\n");
  for (const name of ["npm.cmd", "bun.EXE"]) {
    const runner = join(root, "bin", name);
    await writeFile(runner, "#!/usr/bin/env bash\nprintf 'runner args:'; printf '[%s]' \"$@\"; printf '\\n'\n");
    await chmod(runner, 0o755);
    const env = { ...process.env };
    delete env.TEST_RUNNER;
    const result = spawnSync("bash", [script, "state/marker", "*.test.sh", runner], { cwd: join(root, "project"), env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /runner args:\[test\]\[--\]\[\.\/a\.test\.sh\]/u, name);
  }
});

test("systematic-debugging evaluation has exact trigger, non-trigger, and pressure contracts", async () => {
  const evaluation = JSON.parse(await readFile(new URL(`../../../core/evals/skill-routing/${skillId}.json`, import.meta.url), "utf8"));
  assert.equal(evaluation.schemaVersion, 1);
  assert.equal(evaluation.id, `${skillId}-routing`);
  assert.equal(evaluation.skill, skillId);
  assert.deepEqual(evaluation.cases.map((entry) => entry.id), requiredCases);
  for (const entry of evaluation.cases) {
    assert.equal(entry.critical, true, `${entry.id} must be critical`);
    assert.equal(typeof entry.prompt, "string");
    assert.doesNotMatch(entry.prompt, /systematic-debugging|\bskill\b/iu, `${entry.id} prompt must not name the skill`);
    assert.equal(typeof entry.expected, "object");
    assert.ok(Array.isArray(entry.observables) && entry.observables.length > 0);
    for (const observable of entry.observables) assert.doesNotMatch(observable, /outermost seam|filename boundaries/iu);
  }
  assert.equal(evaluation.cases[0].expected.skillCheck, "required");
  assert.equal(evaluation.cases[0].expected.rootCauseBeforeFix, true);
  assert.equal(evaluation.cases[0].expected.smallestReproducibleEvidence, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.knownRequestedChange, true);
  assert.equal(evaluation.cases[2].expected.skillCheck, "required");
  assert.equal(evaluation.cases[2].expected.noSecretOrEnvironmentDump, true);
  assert.equal(evaluation.cases[2].expected.noGuessFix, true);
  assert.equal(evaluation.cases[2].expected.honestNondeterminism, true);
  assert.equal(evaluation.cases[3].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[3].expected.noFailureToExplain, true);
  assert.equal(evaluation.cases[3].expected.routeTo, "performance-profiling-and-benchmarking");
  assert.equal("routesTo" in evaluation.cases[3].expected, false);
});
