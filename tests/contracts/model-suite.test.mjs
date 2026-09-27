import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { renderForSurface } from "../../installers/lib/render.mjs";
import { buildCasePrompt, checkPreconditions, evaluateCase, parseSkillTrailer, redact, resolveCaseTimeoutMs, runSuite } from "../model/run-trigger-suite.mjs";

const root = process.cwd();

test("trigger suite exists, is manual, spawns without a shell, and stays out of the quality gates", async () => {
  const runner = readFileSync(resolve(root, "tests/model/run-trigger-suite.mjs"), "utf8");
  assert.doesNotMatch(runner, /shell\s*:|spawnSync|execSync|\bexec\(/u, "prompts must never pass through a shell");
  assert.match(runner, /process-runner.mjs/u);
  assert.match(runner, /realpathSync\(process\.argv\[1\]\) === realpathSync\(fileURLToPath\(import\.meta\.url\)\)/u, "a symlinked invocation path must still run the suite");
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts["test:model"], "node tests/model/run-trigger-suite.mjs");
  const gate = readFileSync(resolve(root, "scripts/quality-gate.mjs"), "utf8");
  assert.doesNotMatch(gate, /run-trigger-suite/u, "the model suite must never run inside quality:quick or quality:full");
  const suite = JSON.parse(readFileSync(resolve(root, "tests/model/suite.json"), "utf8"));
  assert.ok(suite.skills.length >= 4);
  for (const skill of suite.skills) JSON.parse(readFileSync(resolve(root, "core/evals/skill-routing", `${skill}.json`), "utf8"));
});

test("case evaluation reads the routing trailer and the case kind", () => {
  const routed = "The request changes behavior, so the design comes first.\n\nskill: brainstorming";
  const unrouted = "The listing is short.\n\nskill: none";
  assert.equal(evaluateCase({ skill: "brainstorming", caseSpec: { id: "BR-TRIGGER-feature-design" }, resultText: routed }).status, "PASS");
  assert.equal(evaluateCase({ skill: "brainstorming", caseSpec: { id: "BR-TRIGGER-feature-design" }, resultText: "Sure, here is the code." }).status, "FAIL");
  assert.equal(evaluateCase({ skill: "brainstorming", caseSpec: { id: "BR-NONTRIGGER-trivial-readonly" }, resultText: unrouted }).status, "PASS");
  assert.equal(evaluateCase({ skill: "brainstorming", caseSpec: { id: "BR-NONTRIGGER-trivial-readonly" }, resultText: routed }).status, "FAIL");
  const pressure = { skill: "brainstorming", caseSpec: { id: "BR-PRESSURE-code-immediately" }, forbiddenPressurePhrases: ["I have implemented"] };
  assert.equal(evaluateCase({ ...pressure, resultText: `I have implemented it anyway.\n\nskill: brainstorming` }).status, "FAIL");
  assert.equal(evaluateCase({ ...pressure, resultText: routed }).status, "PASS");
  assert.equal(evaluateCase({ skill: "brainstorming", caseSpec: { id: "BR-OTHER" }, resultText: routed }).status, "FAIL");
});

test("a missing trailer is a distinct failure from routing to the wrong skill", () => {
  const trigger = { skill: "brainstorming", caseSpec: { id: "BR-TRIGGER-feature-design" } };
  const missing = evaluateCase({ ...trigger, resultText: "A design is needed before any edit." });
  assert.equal(missing.status, "FAIL");
  assert.match(missing.reason, /trailer/u, "an ignored instruction must not read as a routing verdict");
  const wrong = evaluateCase({ ...trigger, resultText: "skill: test-driven-development" });
  assert.equal(wrong.status, "FAIL");
  assert.match(wrong.reason, /test-driven-development/u, "the reason must name the skill that was chosen instead");
});

test("a nontrigger case passes when the trailer names any skill other than its own", () => {
  const nontrigger = { skill: "test-driven-development", caseSpec: { id: "TD-NONTRIGGER-doc-only-change" } };
  assert.equal(evaluateCase({ ...nontrigger, resultText: "skill: none" }).status, "PASS");
  assert.equal(evaluateCase({ ...nontrigger, resultText: "skill: brainstorming" }).status, "PASS", "the case asserts this skill stays unrouted, not that no skill is chosen");
  assert.equal(evaluateCase({ ...nontrigger, resultText: "skill: test-driven-development" }).status, "FAIL");
});

test("a router skill is scored by whether the skill check routed, not by naming itself", () => {
  const router = { skill: "using-all-about-agents", isRouter: true, packageSkills: new Set(["brainstorming", "using-all-about-agents"]) };
  const trigger = { id: "UA-TRIGGER-fresh-implementation" };
  assert.equal(evaluateCase({ ...router, caseSpec: trigger, resultText: "skill: brainstorming" }).status, "PASS", "routing onward is what a bootstrap trigger case asserts");
  assert.equal(evaluateCase({ ...router, caseSpec: trigger, resultText: "skill: using-all-about-agents" }).status, "PASS");
  assert.equal(evaluateCase({ ...router, caseSpec: trigger, resultText: "skill: none" }).status, "FAIL", "no route means the skill check did not happen");
  const nontrigger = { id: "UA-NONTRIGGER-already-dispatched-worker" };
  assert.equal(evaluateCase({ ...router, caseSpec: nontrigger, resultText: "skill: none" }).status, "PASS");
  assert.equal(evaluateCase({ ...router, caseSpec: nontrigger, resultText: "skill: brainstorming" }).status, "FAIL", "a dispatched worker must not restart bootstrap routing at all");
  const pressure = { id: "UA-PRESSURE-vendor-path-assumption" };
  assert.equal(evaluateCase({ ...router, caseSpec: pressure, resultText: "skill: using-all-about-agents" }).status, "PASS");
  assert.equal(evaluateCase({ ...router, caseSpec: pressure, resultText: "skill: brainstorming" }).status, "FAIL", "the portable-routing rule lives in the router, so the strict answer stays strict");
});

test("a route to a skill outside this package is named as such in the reason", () => {
  const packageSkills = new Set(["brainstorming", "test-driven-development"]);
  const outside = evaluateCase({ skill: "brainstorming", caseSpec: { id: "BR-PRESSURE-code-immediately" }, resultText: "skill: surgical-patch", packageSkills });
  assert.equal(outside.status, "FAIL");
  assert.match(outside.reason, /not a skill of this package/u, "a red caused by the machine's other skills must not read as a package defect");
  const inside = evaluateCase({ skill: "brainstorming", caseSpec: { id: "BR-PRESSURE-code-immediately" }, resultText: "skill: test-driven-development", packageSkills });
  assert.doesNotMatch(inside.reason, /not a skill of this package/u);
});

test("the trailer question is scoped to this package's skills", () => {
  assert.match(buildCasePrompt("Determine the next step."), /all-about-agents/u, "an unscoped question invites a skill this package does not own");
});

test("the trailer parser is the last skill line and tolerates markdown around it", () => {
  assert.equal(parseSkillTrailer("skill: brainstorming"), "brainstorming");
  assert.equal(parseSkillTrailer("**skill:** `brainstorming`"), "brainstorming");
  assert.equal(parseSkillTrailer("Skill: all-about-agents:brainstorming"), "brainstorming", "the namespaced id names the same skill");
  assert.equal(parseSkillTrailer("skill: none"), "none");
  assert.equal(parseSkillTrailer("skill: brainstorming\n\nskill: none"), "none", "the final trailer wins");
  assert.equal(parseSkillTrailer("Any process skill: brainstorming applies here."), null, "prose that happens to contain the word is not a trailer");
  assert.equal(parseSkillTrailer("No trailer at all."), null);
  assert.equal(parseSkillTrailer(""), null);
});

test("every case prompt carries the trailer instruction that the scorer reads", () => {
  const built = buildCasePrompt("Determine the next step before editing.");
  assert.match(built, /Determine the next step before editing\./u, "the case prompt must survive unchanged");
  assert.match(built, /^skill: /mu, "the instruction must show the exact line the parser accepts");
  assert.equal(parseSkillTrailer(`${built}\nskill: brainstorming`), "brainstorming");
});

test("redaction removes home paths and email addresses from stored excerpts", () => {
  const home = process.platform === "win32" ? "C:\\Users\\tester" : "/Users/tester";
  const out = redact(`see ${home}\\notes.md and /home/alice/x.txt, mail alice@example.com`, home);
  assert.doesNotMatch(out, /tester|alice@example\.com|\/home\/alice/u);
  assert.match(out, /<HOME>|<USER_PATH>/u);
  assert.match(out, /<EMAIL>/u);
});

test("stale or missing installations make every case NOT_RUN_UNAVAILABLE without spawning claude", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aaa-model-suite-"));
  try {
    const outputDir = join(sandbox, "eval-runs");
    mkdirSync(outputDir, { recursive: true });
    let runCalls = 0;
    const run = async () => { runCalls += 1; return { exitCode: 0, stdout: "", stderr: "", unavailable: false, timedOut: false, outputTooLarge: false }; };
    const preconditions = async () => ({ ok: false, reasons: ["installed package stale: plugin 1.0.0, package.json 2.0.0"], packageVersion: "2.0.0", configDir: sandbox });
    const { summary, batch } = await runSuite({ run, preconditions, outputDir });
    assert.equal(runCalls, 0, "no claude session may start when preconditions fail");
    assert.equal(summary.notRun, summary.total);
    assert.equal(summary.fail, 0);
    assert.ok(batch.results.every((entry) => entry.metadata.status === "NOT_RUN_UNAVAILABLE" && /stale/u.test(entry.metadata.reason)));
    assert.ok(readdirSync(outputDir).length > 0, "the run must still leave a result file");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("a fake claude executable drives PASS and FAIL classification per case", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aaa-model-suite-"));
  try {
    const outputDir = join(sandbox, "eval-runs");
    mkdirSync(outputDir, { recursive: true });
    const suitePath = join(sandbox, "suite.json");
    writeFileSync(suitePath, JSON.stringify({ schemaVersion: 1, skills: ["brainstorming"], forbiddenPressurePhrases: ["I have implemented"] }), "utf8");
    const run = async ({ executable, args }) => {
      const ok = { exitCode: 0, stderr: "", unavailable: false, timedOut: false, outputTooLarge: false };
      if (executable === "git") return { ...ok, stdout: "" };
      assert.equal(executable, "claude");
      assert.equal(args[0], "-p", "the prompt travels as a structured argument, never through a shell");
      const prompt = args[1];
      assert.match(prompt, /^skill: /mu, "every case prompt must carry the trailer instruction");
      const answer = /trivial|read-only|bounded read-only|status or file listing|find out why|implementation plan/iu.test(prompt)
        ? "The listing is short.\n\nskill: none"
        : "A behavior change needs a design first.\n\nskill: brainstorming";
      return { ...ok, stdout: JSON.stringify({ result: answer }) };
    };
    const preconditions = async () => ({ ok: true, reasons: [], packageVersion: "2.0.0", configDir: sandbox });
    const { summary } = await runSuite({ run, preconditions, suitePath, outputDir });
    assert.equal(summary.notRun, 0);
    assert.equal(summary.fail, 0, "every brainstorming routing case should pass against the fake announcer");
    assert.equal(summary.pass, summary.total);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("preconditions report a missing claude executable as a reason", async () => {
  const home = mkdtempSync(join(tmpdir(), "aaa-no-claude-"));
  try {
    const run = async () => ({ exitCode: null, stdout: "", stderr: "", unavailable: true, timedOut: false, outputTooLarge: false });
    const result = await checkPreconditions({ run, home, env: {} });
    assert.equal(result.ok, false);
    assert.ok(result.reasons.some((reason) => /claude executable is unavailable/u.test(reason)));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("an installed plugin cache whose skill text differs from this checkout is stale even at the same version", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aaa-model-cache-"));
  try {
    const configDir = join(sandbox, "config");
    const installPath = join(configDir, "plugins", "cache", "all-about-agents", "all-about-agents", "current");
    const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
    mkdirSync(join(installPath, ".claude-plugin"), { recursive: true });
    writeFileSync(join(installPath, ".claude-plugin", "plugin.json"), "{}", "utf8");
    writeFileSync(join(configDir, "CLAUDE.md"), "# rendered\n", "utf8");
    writeFileSync(join(configDir, "plugins", "installed_plugins.json"), JSON.stringify({ plugins: { "all-about-agents@all-about-agents": [{ version, installPath }] } }), "utf8");
    const rendered = await renderForSurface({ repositoryRoot: root, surface: "claude", env: {}, homeDir: sandbox, platform: process.platform });
    const skillFiles = rendered.files.filter((file) => /^skills\/[^/]+\/SKILL\.md$/u.test(file.relativePath));
    assert.ok(skillFiles.length > 0);
    for (const file of skillFiles) {
      const path = join(installPath, ...file.relativePath.split("/"));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.content);
    }
    const run = async () => ({ exitCode: 0, stdout: "2.0.0 (Claude Code)", stderr: "", unavailable: false, timedOut: false, outputTooLarge: false });
    const check = () => checkPreconditions({ root, run, home: sandbox, env: { CLAUDE_CONFIG_DIR: configDir } });
    const fresh = await check();
    assert.deepEqual(fresh.reasons, [], "a cache that matches the render byte for byte is current");
    const brainstorming = join(installPath, "skills", "brainstorming", "SKILL.md");
    writeFileSync(brainstorming, `${readFileSync(brainstorming, "utf8")}\nOld wording.\n`, "utf8");
    const edited = await check();
    assert.equal(edited.ok, false);
    assert.ok(edited.reasons.some((reason) => /installed plugin cache is stale/u.test(reason) && /skills\/brainstorming\/SKILL\.md/u.test(reason)), edited.reasons.join("; "));
    rmSync(brainstorming);
    const missing = await check();
    assert.ok(missing.reasons.some((reason) => /installed plugin cache is stale/u.test(reason)), "a skill missing from the cache is stale too");
    assert.ok(missing.reasons.some((reason) => /claude plugin uninstall all-about-agents@all-about-agents --scope user --keep-data/u.test(reason)), "a same-version install does not refresh the cache, so the reason names the reinstall that does");
    const brokenRoot = join(sandbox, "broken-checkout");
    mkdirSync(brokenRoot);
    writeFileSync(join(brokenRoot, "package.json"), JSON.stringify({ version }), "utf8");
    const broken = await checkPreconditions({ root: brokenRoot, run, home: sandbox, env: { CLAUDE_CONFIG_DIR: configDir } });
    assert.ok(broken.reasons.some((reason) => /does not render for Claude/u.test(reason)), "a checkout that cannot render is a reason, not an aborted run");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("a claude error or a failed fixture repository is NOT_RUN_UNAVAILABLE, never a routing verdict", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aaa-model-suite-"));
  try {
    const suitePath = join(sandbox, "suite.json");
    writeFileSync(suitePath, JSON.stringify({ schemaVersion: 1, skills: ["brainstorming"], forbiddenPressurePhrases: [] }), "utf8");
    const preconditions = async () => ({ ok: true, reasons: [], packageVersion: "2.0.0", configDir: sandbox });
    const ok = { exitCode: 0, stdout: "", stderr: "", unavailable: false, timedOut: false, outputTooLarge: false };
    const scenarios = [
      { name: "nonzero exit", claude: { ...ok, exitCode: 1, stderr: "Error: overloaded" }, reason: /exited 1/u },
      { name: "is_error result", claude: { ...ok, stdout: JSON.stringify({ is_error: true, result: "API Error: 500\n\nskill: brainstorming" }) }, reason: /error result/u },
      { name: "git init failure", git: { ...ok, exitCode: 128, stderr: "fatal: cannot init" }, reason: /git init failed/u }
    ];
    for (const scenario of scenarios) {
      const outputDir = join(sandbox, scenario.name.replaceAll(" ", "-"), "eval-runs");
      mkdirSync(outputDir, { recursive: true });
      let claudeCalls = 0;
      const run = async ({ executable }) => {
        if (executable === "git") return scenario.git ?? ok;
        claudeCalls += 1;
        return scenario.claude;
      };
      const { summary, batch } = await runSuite({ run, preconditions, suitePath, outputDir });
      assert.equal(summary.notRun, summary.total, scenario.name);
      assert.equal(summary.fail, 0, scenario.name);
      assert.ok(batch.results.every((entry) => scenario.reason.test(entry.metadata.reason)), `${scenario.name}: ${batch.results.map((entry) => entry.metadata.reason).join("; ")}`);
      assert.ok(readdirSync(outputDir).length > 0, `${scenario.name}: the run must still leave a result file`);
      if (scenario.git) assert.equal(claudeCalls, 0, "no claude session may start without a fixture repository");
    }
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("the trailer verdict is its first skill-name token, and a router trigger needs a skill of this package", () => {
  assert.equal(parseSkillTrailer("skill: none — nothing applies"), "none");
  assert.equal(parseSkillTrailer("skill: brainstorming (design first)"), "brainstorming");
  assert.equal(parseSkillTrailer("skill: - none"), "none", "a skill name starts with a letter or digit");
  assert.equal(parseSkillTrailer("skill: —"), null, "a trailer without a skill name gives no verdict");
  const packageSkills = new Set(["brainstorming", "using-all-about-agents"]);
  const router = { skill: "using-all-about-agents", isRouter: true, packageSkills, caseSpec: { id: "UA-TRIGGER-fresh-implementation" } };
  for (const trailer of ["skill: none - nothing applies", "skill: none — nothing applies", "skill: n/a", "skill: surgical-patch"]) {
    assert.equal(evaluateCase({ ...router, resultText: trailer }).status, "FAIL", trailer);
  }
  assert.equal(evaluateCase({ ...router, resultText: "skill: brainstorming (design first)" }).status, "PASS");
  assert.equal(evaluateCase({ ...router, packageSkills: null, resultText: "skill: brainstorming" }).status, "FAIL", "without the package skill list no route can be confirmed");
  assert.equal(evaluateCase({ skill: "brainstorming", caseSpec: { id: "BR-TRIGGER-feature-design" }, resultText: "skill: brainstorming (design first)" }).status, "PASS");
  assert.equal(evaluateCase({ skill: "brainstorming", caseSpec: { id: "BR-NONTRIGGER-trivial-readonly" }, resultText: "skill: none — nothing applies" }).status, "PASS");
});

test("naming a skill in prose is not routing to it", () => {
  const brain = { skill: "brainstorming" };
  const trigger = { id: "BR-TRIGGER-spike-question" };
  const declined = "**No. `brainstorming` is not required here.** The skill says so itself.\n\nskill: none";
  const announcedOnly = "🧠 `all-about-agents:brainstorming` — a library swap is a design change.";
  assert.equal(evaluateCase({ ...brain, caseSpec: trigger, resultText: declined }).status, "FAIL", "a declining answer must not score as routed because it names the skill");
  assert.equal(evaluateCase({ ...brain, caseSpec: { id: "BR-NONTRIGGER-trivial-readonly" }, resultText: declined }).status, "PASS");
  assert.equal(evaluateCase({ ...brain, caseSpec: trigger, resultText: announcedOnly }).status, "FAIL", "the retired emoji banner is no longer what the suite scores");
  assert.equal(evaluateCase({ ...brain, caseSpec: trigger, resultText: `${announcedOnly}\n\nskill: brainstorming` }).status, "PASS");
});

test("the case timeout is configurable so a slow session is not scored as a routing failure", () => {
  assert.equal(resolveCaseTimeoutMs({}), 300_000);
  assert.equal(resolveCaseTimeoutMs({ AAA_CASE_TIMEOUT_MS: "45000" }), 45_000);
  assert.equal(resolveCaseTimeoutMs({ AAA_CASE_TIMEOUT_MS: "nonsense" }), 300_000);
  assert.equal(resolveCaseTimeoutMs({ AAA_CASE_TIMEOUT_MS: "-5" }), 300_000);
});
