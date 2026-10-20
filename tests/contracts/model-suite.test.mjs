import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { renderForSurface } from "../../installers/lib/render.mjs";
import { makeTempRoot } from "../helpers/temp-root.mjs";
import { buildCasePrompt, checkPreconditions, evaluateCase as evaluateObservedCase, evaluateRouteText as evaluateCase, parseClaudeStream, parseSkillTrailer, redact, resolveCaseTimeoutMs, runSuite } from "../model/run-trigger-suite.mjs";
import { describeSuiteAge } from "../model/suite-age.mjs";

const root = process.cwd();

test("a self-reported trailer alone never verifies a native skill invocation", () => {
  const result = evaluateObservedCase({ skill: "brainstorming", caseSpec: { id: "BR-TRIGGER-feature-design" }, resultText: "skill: brainstorming" });
  assert.equal(result.status, "FAIL", "the trailer is model-authored text, not a completed native tool call");
});

const candidateRoot = resolve(tmpdir(), "aaa-independent-candidate");
const packageSkills = new Set(["brainstorming", "using-all-about-agents", "systematic-debugging"]);
const initEvent = { type: "system", subtype: "init", model: "selected-model", claude_code_version: "2.1.304", plugins: [{ name: "all-about-agents", path: candidateRoot }], skills: ["all-about-agents:brainstorming"], tools: ["Skill"], mcp_servers: [] };
const callEvent = { type: "assistant", parent_tool_use_id: null, message: { id: "msg_call", model: "selected-model", role: "assistant", content: [{ type: "tool_use", id: "tool_main", name: "Skill", input: { skill: "all-about-agents:brainstorming" } }] } };
const completionEvent = { type: "user", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool_main", content: "Launching skill: all-about-agents:brainstorming" }] } };
const finalEvent = { type: "result", subtype: "success", is_error: false, result: "Design comes first.\n\nskill: brainstorming", modelUsage: { "selected-model": { inputTokens: 30, outputTokens: 9 } }, permission_denials: [] };
const capture = (...events) => events.map((event) => JSON.stringify(event)).join("\n") + "\n";
const parse = (stdout, options = {}) => parseClaudeStream(stdout, { candidateRoot, packageSkills, ...options });
const score = (observation, extra = {}) => evaluateObservedCase({ skill: "brainstorming", caseSpec: { id: "BR-TRIGGER-independent" }, resultText: observation.resultText, observation, packageSkills, ...extra });

test("native scoring requires exact candidate init identity and correlated main-conversation completion", () => {
  const observed = parse(capture(initEvent, callEvent, completionEvent, finalEvent));
  assert.equal(observed.candidateLoaded, true);
  assert.deepEqual(observed.loadedSkills, ["brainstorming"]);
  assert.equal(score(observed).status, "PASS");
  assert.equal(observed.effort, null, "missing native effort is unknown");
  assert.deepEqual(observed.models, ["selected-model"]);
  const alternate = { ...initEvent, plugins: [{ name: "all-about-agents", path: resolve(tmpdir(), "stale-installed-copy") }] };
  assert.equal(score(parse(capture(alternate, callEvent, completionEvent, finalEvent))).status, "FAIL");
  const pluginError = { ...initEvent, plugin_errors: [{ plugin: "all-about-agents", type: "skill", message: "invalid component" }] };
  assert.equal(score(parse(capture(pluginError, callEvent, completionEvent, finalEvent))).status, "FAIL");
  const noCall = parse(capture(initEvent, finalEvent));
  assert.equal(score(noCall).status, "FAIL", "init availability and result trailer do not mean invocation");
});

test("native catalog evidence reports candidate and foreign counts without retaining private skill names", () => {
  const observation = parse(capture({ ...initEvent, skills: ["all-about-agents:brainstorming", "private-plugin:private-skill"] }, finalEvent));
  assert.equal(observation.candidateSkillCount, 1);
  assert.equal(observation.foreignSkillCount, 1);
  assert.doesNotMatch(JSON.stringify(observation), /private-plugin|private-skill/u);
});

test("attempts, denials, unknown skills, mismatched IDs and subagents never pass as a main load", () => {
  const badCompletions = [
    { ...completionEvent, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "wrong-id", content: "Launching skill" }] } },
    { ...completionEvent, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool_main", is_error: true, content: "Permission denied" }] } },
    { ...completionEvent, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool_main", content: "Permission denied" }] } },
    { ...completionEvent, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool_main", content: "" }] } }
  ];
  for (const completion of badCompletions) assert.equal(score(parse(capture(initEvent, callEvent, completion, finalEvent))).status, "FAIL");
  assert.equal(score(parse(capture(initEvent, callEvent, finalEvent))).status, "FAIL");
  const subCall = { ...callEvent, parent_tool_use_id: "agent_parent" };
  const subResult = { ...completionEvent, parent_tool_use_id: "agent_parent" };
  assert.equal(score(parse(capture(initEvent, subCall, subResult, finalEvent))).status, "FAIL");
  assert.equal(score(parse(capture(initEvent, subCall, completionEvent, finalEvent))).status, "FAIL", "tool-use IDs are scoped to the parent conversation");
  const unknown = { ...callEvent, message: { ...callEvent.message, content: [{ type: "tool_use", id: "tool_main", name: "Skill", input: { skill: "all-about-agents:invented" } }] } };
  const unknownObservation = parse(capture(initEvent, unknown, completionEvent, { ...finalEvent, result: "skill: none" }));
  assert.deepEqual(unknownObservation.loadedSkills, []);
  assert.equal(score(unknownObservation, { caseSpec: { id: "BR-NONTRIGGER-independent" } }).status, "FAIL");
  const deniedResult = { ...finalEvent, permission_denials: [{ tool_name: "Skill", tool_use_id: "tool_main", tool_input: { skill: "all-about-agents:brainstorming" } }] };
  assert.equal(score(parse(capture(initEvent, callEvent, completionEvent, deniedResult))).status, "FAIL");
});

test("malformed, partial, duplicate and over-limit streams fail closed", () => {
  const samples = [
    "{not-json}\n" + capture(initEvent, callEvent, completionEvent, finalEvent),
    capture(initEvent, callEvent, completionEvent),
    capture(initEvent, callEvent, callEvent, completionEvent, finalEvent),
    capture(initEvent, callEvent, completionEvent, finalEvent, finalEvent),
    capture(initEvent, callEvent, completionEvent, finalEvent) + '{"type":'
  ];
  for (const stdout of samples) assert.equal(score(parse(stdout)).status, "FAIL");
  assert.equal(score(parse(capture(initEvent, callEvent, completionEvent, finalEvent), { outputTooLarge: true })).status, "FAIL");
  assert.equal(score(parse(capture(initEvent, callEvent, completionEvent, finalEvent), { maxBytes: 20 })).status, "FAIL");
});

test("invalid native shapes and records after final result cannot be accepted", () => {
  for (const event of [
    { ...initEvent, plugins: "invalid" },
    { ...initEvent, tools: {} },
    { ...callEvent, message: { content: {} } },
    { ...completionEvent, message: { content: "invalid" } }
  ]) {
    assert.doesNotThrow(() => parse(capture(event, finalEvent)));
    assert.equal(score(parse(capture(event, finalEvent))).status, "FAIL");
  }
  assert.equal(score(parse(capture(initEvent, finalEvent, callEvent, completionEvent))).status, "FAIL");
});

test("synthetic full-file Read evidence is exact, correlated and never accepts a partial body", () => {
  const filePath = join(candidateRoot, "skills", "brainstorming", "SKILL.md");
  const readCall = { ...callEvent, message: { ...callEvent.message, content: [{ type: "tool_use", id: "read_1", name: "Read", input: { file_path: filePath } }] } };
  const readResult = { ...completionEvent, tool_use_result: { type: "text", file: { filePath, content: "one\ntwo\n", numLines: 2, startLine: 1, totalLines: 2 } }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "read_1", content: "1 one\n2 two" }] } };
  assert.equal(score(parse(capture(initEvent, readCall, readResult, finalEvent))).status, "PASS");
  for (const file of [{ ...readResult.tool_use_result.file, startLine: 2 }, { ...readResult.tool_use_result.file, numLines: 1 }, { ...readResult.tool_use_result.file, truncatedByTokenCap: true }, { ...readResult.tool_use_result.file, filePath: join(candidateRoot, "other", "SKILL.md") }]) {
    const result = { ...readResult, tool_use_result: { type: "text", file } };
    assert.equal(score(parse(capture(initEvent, readCall, result, finalEvent))).status, "FAIL");
  }
});

test("native nontrigger scoring observes unwanted loads and rejects bogus routes", () => {
  const nontrigger = { caseSpec: { id: "BR-NONTRIGGER-independent" } };
  const none = { ...finalEvent, result: "skill: none" };
  assert.equal(score(parse(capture(initEvent, none)), nontrigger).status, "PASS");
  assert.equal(score(parse(capture(initEvent, callEvent, completionEvent, none)), nontrigger).status, "FAIL", "a none trailer must not hide a real load");
  const bogus = { ...finalEvent, result: "skill: invented" };
  assert.equal(score(parse(capture(initEvent, bogus)), nontrigger).status, "FAIL");
  const router = { skill: "using-all-about-agents", isRouter: true, caseSpec: { id: "UA-TRIGGER-independent" } };
  assert.equal(score(parse(capture(initEvent, callEvent, completionEvent, finalEvent)), router).status, "PASS");
  assert.equal(score(parse(capture(initEvent, finalEvent)), router).status, "FAIL");
  assert.equal(score(parse(capture(initEvent, callEvent, completionEvent, none)), { ...router, caseSpec: { id: "UA-NONTRIGGER-worker" } }).status, "FAIL");
});

test("EndConversation housekeeping does not count as a router nontrigger skill load", () => {
  const endCall = { ...callEvent, message: { ...callEvent.message, content: [{ type: "tool_use", id: "end_1", name: "EndConversation", input: {} }] } };
  const endResult = { ...completionEvent, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "end_1", content: "Conversation ended" }] } };
  const observation = parse(capture({ ...initEvent, tools: ["Skill", "EndConversation"] }, endCall, endResult, { ...finalEvent, result: "skill: none" }));
  assert.equal(score(observation, { skill: "using-all-about-agents", isRouter: true, caseSpec: { id: "UA-NONTRIGGER-worker" } }).status, "PASS");
});

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
  for (const skill of ["diagnosing-agent-workflows", "domain-modeling", "pr", "retro", "codebase-design", "writing-plans", "writing-skills", "executing-plans", "subagent-driven-development", "dispatching-parallel-agents", "handoff", "loop-me", "requesting-code-review", "session-compaction-resilience", "wayfinder", "interviewing", "finishing-a-development-branch", "improve-codebase-architecture"]) assert.ok(suite.skills.includes(skill), `${skill} needs a manual routing entry`);
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
  assert.doesNotMatch(redact("Bearer synthetic-test-value123 api_key=synthetic_secret_value sk-syntheticabcdefghijklmnop"), /synthetic/u);
});

test("stale or missing installations make every case NOT_RUN_UNAVAILABLE without spawning claude", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aaa-model-suite-"));
  try {
    const outputDir = join(sandbox, "eval-runs");
    mkdirSync(outputDir, { recursive: true });
    let runCalls = 0;
    const run = async () => { runCalls += 1; return { exitCode: 0, stdout: "", stderr: "", unavailable: false, timedOut: false, outputTooLarge: false }; };
    const preconditions = async () => ({ ok: false, reasons: ["installed package stale: plugin 1.0.0, package.json 2.0.0"], packageVersion: "2.0.0", configDir: sandbox });
    const { summary, batch, runDir } = await runSuite({ run, preconditions, outputDir });
    assert.equal(runCalls, 0, "no claude session may start when preconditions fail");
    assert.equal(summary.notRun, summary.total);
    assert.equal(summary.fail, 0);
    assert.ok(batch.results.every((entry) => entry.metadata.status === "NOT_RUN_UNAVAILABLE" && /stale/u.test(entry.metadata.reason)));
    assert.ok(readdirSync(runDir).includes("result.json"), "the run must still leave a result file");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test("the public runner qualifies the rendered candidate before scoring normalized native events", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aaa-model-suite-"));
  try {
    const outputDir = join(sandbox, "eval-runs");
    mkdirSync(outputDir, { recursive: true });
    const suitePath = join(sandbox, "suite.json");
    writeFileSync(suitePath, JSON.stringify({ schemaVersion: 1, skills: ["brainstorming"], forbiddenPressurePhrases: ["I have implemented"] }), "utf8");
    let modelCalls = 0;
    const run = async ({ executable, args }) => {
      const ok = { exitCode: 0, stderr: "", unavailable: false, timedOut: false, outputTooLarge: false };
      if (executable === "git") return { ...ok, stdout: "" };
      assert.equal(executable, "claude");
      if (args.includes("list")) return { ...ok, stdout: JSON.stringify([{ id: "private-plugin@example", enabled: true }, { id: "all-about-agents@inline", enabled: true }]) };
      assert.equal(args[0], "-p", "the prompt travels as a structured argument, never through a shell");
      modelCalls += 1;
      const prompt = args[1];
      const pluginRoot = args[args.indexOf("--plugin-dir") + 1];
      assert.ok(readFileSync(join(pluginRoot, "skills", "brainstorming", "SKILL.md"), "utf8").includes("brainstorming"));
      assert.equal(args[args.indexOf("--tools") + 1], "Skill");
      assert.equal(args[args.indexOf("--setting-sources") + 1], "user");
      assert.ok(args.includes("--strict-mcp-config"));
      assert.equal(args.includes("--model"), false);
      assert.equal(args.includes("--effort"), false);
      const settings = JSON.parse(args[args.indexOf("--settings") + 1]);
      assert.equal(settings.disableBundledSkills, true);
      assert.equal(settings.enabledPlugins["private-plugin@example"], false);
      assert.equal(settings.disableAllHooks, true);
      assert.equal(settings.disableSkillShellExecution, true);
      assert.match(prompt, /^skill: /mu, "every case prompt must carry the trailer instruction");
      const probe = prompt.includes("Qualification probe only");
      const answer = /trivial|read-only|bounded read-only|status or file listing|find out why|implementation plan/iu.test(prompt)
        ? "The listing is short.\n\nskill: none"
        : "A behavior change needs a design first.\n\nskill: brainstorming";
      const route = probe ? "using-all-about-agents" : /skill: none/u.test(answer) ? null : "brainstorming";
      const call = { ...callEvent, message: { ...callEvent.message, content: [{ type: "tool_use", id: "tool_main", name: "Skill", input: { skill: `all-about-agents:${route}` } }] } };
      return { ...ok, stdout: capture({ ...initEvent, plugins: [{ name: "all-about-agents", path: pluginRoot }] }, ...(route ? [call, completionEvent] : []), { ...finalEvent, result: probe ? "skill: using-all-about-agents" : answer }) };
    };
    const preconditions = async () => ({ ok: true, reasons: [], packageVersion: JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version, configDir: sandbox });
    const { summary, qualification, runDir } = await runSuite({ run, preconditions, suitePath, outputDir, mode: "rendered", caseIds: ["BR-TRIGGER-feature-design", "BR-NONTRIGGER-trivial-readonly", "BR-PRESSURE-code-immediately"] });
    assert.equal(summary.notRun, 0);
    assert.equal(summary.fail, 0, "independent native fixtures should pass the runner contract");
    assert.equal(summary.pass, summary.total);
    assert.equal(modelCalls, summary.total + 1, "the forced probe is separate from every natural case");
    assert.equal(qualification.status, "PASS");
    const evidence = readFileSync(join(runDir, "native-evidence.json"), "utf8");
    assert.doesNotMatch(evidence, /private-plugin|msg_call|Launching skill/u, "raw plugin lists and tool payloads must not be stored");
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});

function publicRunnerProcess({ rejectTurn = null, rejection = null } = {}) {
  let modelCalls = 0;
  const run = async ({ executable, args }) => {
    const ok = { exitCode: 0, stderr: "", unavailable: false, timedOut: false, outputTooLarge: false };
    if (executable === "git") return { ...ok, stdout: "" };
    if (args.includes("list")) return { ...ok, stdout: "[]" };
    assert.equal(args[0], "-p");
    modelCalls += 1;
    if (modelCalls === rejectTurn) throw rejection;
    const path = args[args.indexOf("--plugin-dir") + 1];
    const diagnostic = args[1].includes("Metadata diagnostic only");
    const skill = args[1].includes("Qualification probe only") ? "using-all-about-agents" : "brainstorming";
    const call = { ...callEvent, message: { ...callEvent.message, content: [{ type: "tool_use", id: "tool_main", name: "Skill", input: { skill: `all-about-agents:${skill}` } }] } };
    return { ...ok, stdout: capture({ ...initEvent, plugins: [{ name: "all-about-agents", path }] }, ...(diagnostic ? [] : [call, completionEvent]), { ...finalEvent, result: `skill: ${diagnostic ? "none" : skill}` }) };
  };
  return { run, modelCalls: () => modelCalls };
}

const currentPreconditions = async () => ({ ok: true, reasons: [], packageVersion: JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version });
const threeNaturalCases = ["BR-TRIGGER-feature-design", "BR-TRIGGER-spike-question", "BR-PRESSURE-code-immediately"];

for (const selector of ["skills", "caseIds"]) {
  test(`empty normal ${selector} selection rejects before any model turn`, async () => {
    const sandbox = mkdtempSync(join(tmpdir(), "aaa-model-empty-"));
    try {
      const process = publicRunnerProcess();
      await assert.rejects(runSuite({ run: process.run, preconditions: currentPreconditions, mode: "rendered", [selector]: [], outputDir: join(sandbox, "eval-runs") }), /at least one natural case/u);
      assert.equal(process.modelCalls(), 0);
    } finally { rmSync(sandbox, { recursive: true, force: true }); }
  });
}

for (const onlyMode of ["qualificationOnly", "diagnosticOnly"]) {
  test(`${onlyMode} remains valid with no selected natural cases`, async () => {
    const sandbox = mkdtempSync(join(tmpdir(), "aaa-model-only-"));
    try {
      const process = publicRunnerProcess();
      const { summary, qualification, runDir } = await runSuite({ run: process.run, preconditions: currentPreconditions, mode: "rendered", skills: [], caseIds: [], [onlyMode]: true, outputDir: join(sandbox, "eval-runs") });
      assert.equal(process.modelCalls(), 1);
      assert.equal(summary.total, 0);
      assert.equal(qualification.status, onlyMode === "qualificationOnly" ? "PASS" : "NOT_RUN_UNAVAILABLE");
      assert.ok(readdirSync(runDir).includes("native-evidence.json"));
    } finally { rmSync(sandbox, { recursive: true, force: true }); }
  });
}

test("later expected launch rejection retains earlier results and stops model fan-out", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aaa-model-launch-"));
  try {
    const rejection = Object.assign(new Error(`synthetic launch blocked /home/private/session.json private@example.com api_key=synthetic_secret ${"x".repeat(1200)}`), { code: "EPERM" });
    const process = publicRunnerProcess({ rejectTurn: 3, rejection });
    let returned;
    await assert.doesNotReject(async () => { returned = await runSuite({ run: process.run, preconditions: currentPreconditions, mode: "rendered", skills: ["brainstorming"], caseIds: threeNaturalCases, outputDir: join(sandbox, "eval-runs") }); });
    const { summary, runDir } = returned;
    assert.equal(process.modelCalls(), 3, "qualification, first case and rejected launch only");
    assert.deepEqual(summary, { total: 3, pass: 1, fail: 0, notRun: 2 });
    const batch = JSON.parse(readFileSync(join(runDir, "result.json"), "utf8"));
    assert.deepEqual(batch.results.map((entry) => entry.metadata.status), ["PASS", "NOT_RUN_UNAVAILABLE", "NOT_RUN_UNAVAILABLE"]);
    assert.match(batch.results[1].metadata.reason, /EPERM/u);
    assert.ok(batch.results[1].metadata.reason.length <= 400);
    assert.doesNotMatch(batch.results[1].metadata.reason, /\/home\/private|private@example|synthetic_secret/u);
    const evidence = JSON.parse(readFileSync(join(runDir, "native-evidence.json"), "utf8"));
    assert.equal(evidence.qualification.status, "PASS");
    assert.equal(evidence.cases[0].caseId, threeNaturalCases[0]);
    assert.equal(evidence.cases[1].launchError.code, "EPERM");
    assert.equal(evidence.cases.length, 2);
    assert.doesNotMatch(JSON.stringify(evidence.cases[1]), /\/home\/private|private@example|synthetic_secret/u);
  } finally { rmSync(sandbox, { recursive: true, force: true }); }
});

for (const rejectTurn of [1, 3]) {
  test(`unexpected programming error on model turn ${rejectTurn} rejects with partial normalized evidence`, async () => {
    const sandbox = mkdtempSync(join(tmpdir(), "aaa-model-unexpected-"));
    try {
      const rejection = new TypeError("synthetic programming defect");
      const process = publicRunnerProcess({ rejectTurn, rejection });
      const outputDir = join(sandbox, "eval-runs");
      await assert.rejects(runSuite({ run: process.run, preconditions: currentPreconditions, mode: "rendered", skills: ["brainstorming"], caseIds: threeNaturalCases, outputDir }), (error) => error === rejection);
      assert.equal(process.modelCalls(), rejectTurn);
      const runDir = join(outputDir, readdirSync(outputDir)[0]);
      assert.ok(readdirSync(runDir).includes("native-evidence.json"), "unexpected error must retain partial normalized evidence");
      const evidence = JSON.parse(readFileSync(join(runDir, "native-evidence.json"), "utf8"));
      assert.equal(evidence.abort.name, "TypeError");
      assert.match(evidence.abort.reason, /synthetic programming defect/u);
      assert.equal(evidence.partialResults.length, rejectTurn === 1 ? 0 : 1);
      if (rejectTurn === 3) {
        assert.equal(evidence.qualification.status, "PASS");
        assert.equal(evidence.partialResults[0].metadata.status, "PASS");
        assert.equal(evidence.cases[0].caseId, threeNaturalCases[0]);
      }
    } finally { rmSync(sandbox, { recursive: true, force: true }); }
  });
}

test("failed qualification never fans out model calls or counts a forced probe as a natural PASS", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aaa-model-probe-"));
  try {
    const suitePath = join(sandbox, "suite.json");
    writeFileSync(suitePath, JSON.stringify({ skills: ["brainstorming"] }));
    let modelCalls = 0;
    const run = async ({ executable, args }) => {
      const ok = { exitCode: 0, stdout: "", stderr: "", unavailable: false, timedOut: false, outputTooLarge: false };
      if (executable === "git") return ok;
      if (args.includes("list")) return { ...ok, stdout: "[]" };
      modelCalls += 1;
      return { ...ok, stdout: capture(initEvent, finalEvent) };
    };
    const preconditions = async () => ({ ok: true, reasons: [], packageVersion: "2.4.0" });
    const { summary, qualification } = await runSuite({ run, preconditions, suitePath, outputDir: join(sandbox, "eval-runs"), mode: "rendered" });
    assert.equal(modelCalls, 1);
    assert.equal(summary.pass, 0);
    assert.equal(summary.notRun, summary.total);
    assert.equal(qualification.status, "NOT_RUN_UNAVAILABLE");
  } finally { rmSync(sandbox, { recursive: true, force: true }); }
});

test("metadata diagnostics retain derived inventory only and never qualify or run natural cases", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aaa-model-diagnostic-"));
  try {
    let modelCalls = 0;
    const run = async ({ executable, args }) => {
      const ok = { exitCode: 0, stderr: "", unavailable: false, timedOut: false, outputTooLarge: false };
      if (executable === "git") return { ...ok, stdout: "" };
      if (args.includes("list")) return { ...ok, stdout: JSON.stringify([{ id: "private-plugin@example", enabled: !args.includes("--settings") }, { id: "all-about-agents@inline", enabled: true }]) };
      modelCalls += 1;
      assert.match(args[1], /Metadata diagnostic only/u);
      const path = args[args.indexOf("--plugin-dir") + 1];
      return { ...ok, stdout: capture({ ...initEvent, plugins: [{ name: "all-about-agents", path }] }, { ...finalEvent, result: "skill: none" }) };
    };
    const preconditions = async () => ({ ok: true, reasons: [], packageVersion: "2.4.0" });
    const { qualification, summary, runDir } = await runSuite({ run, preconditions, mode: "rendered", diagnosticOnly: true, outputDir: join(sandbox, "eval-runs") });
    const evidence = JSON.parse(readFileSync(join(runDir, "native-evidence.json"), "utf8"));
    assert.equal(modelCalls, 1);
    assert.equal(qualification.status, "NOT_RUN_UNAVAILABLE");
    assert.deepEqual(summary, { total: 0, pass: 0, fail: 0, notRun: 0 });
    assert.equal(evidence.probeKind, "metadata-diagnostic");
    assert.deepEqual(evidence.inventoryBefore, { rowCount: 2, candidateRows: 1, enabledCandidateRows: 1, disabledNoncandidateRows: 1, enabledNoncandidateRows: 0 });
    assert.deepEqual(evidence.inventoryAfter, evidence.inventoryBefore);
    assert.doesNotMatch(JSON.stringify(evidence), /private-plugin/u);
  } finally { rmSync(sandbox, { recursive: true, force: true }); }
});

test("installed candidate qualification accepts current template bytes at a custom config root", async () => {
  const sandbox = mkdtempSync(join(tmpdir(), "aaa-model-template-"));
  try {
    const configDir = join(sandbox, "custom config");
    const installPath = join(configDir, "plugins", "cache", "all-about-agents", "all-about-agents", "current");
    const rendered = await renderForSurface({ repositoryRoot: root, surface: "claude", profile: "template", env: { CLAUDE_CONFIG_DIR: configDir }, homeDir: sandbox, platform: process.platform });
    for (const file of rendered.files) {
      const path = join(installPath, ...file.relativePath.split("/"));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, file.content);
    }
    const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
    writeFileSync(join(configDir, "CLAUDE.md"), "# user-global\n");
    writeFileSync(join(configDir, "plugins", "installed_plugins.json"), JSON.stringify({ plugins: { "all-about-agents@all-about-agents": [{ version, installPath }] } }));
    const run = async ({ executable, args }) => {
      const ok = { exitCode: 0, stderr: "", unavailable: false, timedOut: false, outputTooLarge: false };
      if (executable === "git") return { ...ok, stdout: "" };
      if (args.includes("--version")) return { ...ok, stdout: "2.1.304 (Claude Code)" };
      if (args.includes("list")) return { ...ok, stdout: "[]" };
      const call = { ...callEvent, message: { ...callEvent.message, content: [{ type: "tool_use", id: "tool_main", name: "Skill", input: { skill: "all-about-agents:using-all-about-agents" } }] } };
      return { ...ok, stdout: capture({ ...initEvent, plugins: [{ name: "all-about-agents", path: installPath }] }, call, completionEvent, { ...finalEvent, result: "skill: none" }) };
    };
    const preconditions = (options) => checkPreconditions({ ...options, home: sandbox, env: { CLAUDE_CONFIG_DIR: configDir } });
    const { qualification } = await runSuite({ run, preconditions, mode: "installed", profile: "template", qualificationOnly: true, outputDir: join(sandbox, "eval-runs") });
    assert.equal(qualification.status, "PASS", qualification.reason);
  } finally { rmSync(sandbox, { recursive: true, force: true }); }
});

// A checkout outside the current directory: one routing file, and a runner shim that
// re-exports the real runner so its relative imports still resolve.
async function makeDisposableCheckout() {
  const checkout = await makeTempRoot("aaa-model-checkout-");
  mkdirSync(join(checkout, "core", "skills", "brainstorming"), { recursive: true });
  mkdirSync(join(checkout, "core", "evals", "skill-routing"), { recursive: true });
  mkdirSync(join(checkout, "tests", "model"), { recursive: true });
  copyFileSync(resolve(root, "core/evals/skill-routing/brainstorming.json"), join(checkout, "core", "evals", "skill-routing", "brainstorming.json"));
  writeFileSync(join(checkout, "core", "evals", "runner.mjs"), `export * from ${JSON.stringify(pathToFileURL(resolve(root, "core/evals/runner.mjs")).href)};\n`, "utf8");
  writeFileSync(join(checkout, "tests", "model", "suite.json"), JSON.stringify({ schemaVersion: 1, skills: ["brainstorming"], forbiddenPressurePhrases: [] }), "utf8");
  return checkout;
}

const unavailable = async () => ({ ok: false, reasons: ["claude executable is unavailable"], packageVersion: "2.0.0", configDir: "unused" });
const noProcess = async () => assert.fail("no process may start when preconditions fail");

test("the suite contains its output under its own root, not the current directory", async () => {
  const checkout = await makeDisposableCheckout();
  try {
    assert.notEqual(realpathSync(process.cwd()), checkout);
    // Only the repository rule admits tests/.tmp, so this passes only when the runner is told the root.
    const outputDir = join(checkout, "tests", ".tmp", "runs");
    const { summary, runDir } = await runSuite({ root: checkout, run: noProcess, preconditions: unavailable, outputDir });
    assert.equal(summary.notRun, summary.total);
    assert.equal(dirname(runDir), outputDir);
    assert.ok(readdirSync(runDir).includes("result.json"));
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
});

test("every suite run keeps its own result folder, and the age check reads only trigger-suite results", async () => {
  const checkout = await makeDisposableCheckout();
  try {
    const runsDir = join(checkout, ".aaa", "eval-runs");
    assert.match(describeSuiteAge(runsDir), /no result recorded yet/u);
    const earlier = join(runsDir, "trigger-suite-2026-01-01T00-00-00-000Z-pass", "result.json");
    mkdirSync(dirname(earlier), { recursive: true });
    const passRecord = JSON.stringify({ results: [{ metadata: { status: "PASS" } }] });
    writeFileSync(earlier, passRecord, "utf8");
    const first = await runSuite({ root: checkout, run: noProcess, preconditions: unavailable });
    const second = await runSuite({ root: checkout, run: noProcess, preconditions: unavailable });
    assert.notEqual(first.runDir, second.runDir, "two runs in the same millisecond must still get two folders");
    for (const { runDir } of [first, second]) {
      assert.equal(dirname(runDir), runsDir);
      assert.match(basename(runDir), /^trigger-suite-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-/u);
      assert.ok(readdirSync(runDir).includes("result.json"));
    }
    assert.equal(readFileSync(earlier, "utf8"), passRecord, "a later all-NOT_RUN run must not replace the last PASS record");

    // `aaa eval --output .aaa/eval-runs` and other eval runs are newer, but they are not trigger-suite results.
    writeFileSync(join(runsDir, "result.json"), "{}", "utf8");
    mkdirSync(join(runsDir, "ordered"));
    writeFileSync(join(runsDir, "ordered", "result.json"), "{}", "utf8");
    const hour = 3_600_000;
    const now = Date.now();
    for (const [path, hoursAgo] of [[earlier, 5], [join(first.runDir, "result.json"), 3], [join(second.runDir, "result.json"), 2]]) {
      utimesSync(path, new Date(now - hoursAgo * hour), new Date(now - hoursAgo * hour));
    }
    const message = describeSuiteAge(runsDir, now);
    assert.match(message, new RegExp(`${basename(second.runDir)}/result\\.json is 2 hours old`, "u"));
    assert.match(message, new RegExp(`0 pass, 0 fail, ${String(second.summary.total)} not run`, "u"), "an all-NOT_RUN result must not read as a fresh PASS");
    utimesSync(earlier, new Date(now), new Date(now));
    assert.match(describeSuiteAge(runsDir, now), /trigger-suite-2026-01-01T00-00-00-000Z-pass\/result\.json is 0 hours old \(1 pass, 0 fail, 0 not run\)/u);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
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
    const preconditions = async () => ({ ok: true, reasons: [], packageVersion: JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version, configDir: sandbox });
    const ok = { exitCode: 0, stdout: "", stderr: "", unavailable: false, timedOut: false, outputTooLarge: false };
    const scenarios = [
      { name: "nonzero exit", claude: { ...ok, exitCode: 1, stderr: "Error: overloaded" }, reason: /exited 1/u },
      { name: "is_error result", claude: { ...ok, stdout: capture(initEvent, { type: "result", subtype: "error_during_execution", is_error: true, result: "API Error: 500\n\nskill: brainstorming" }) }, reason: /error result/u },
      { name: "git init failure", git: { ...ok, exitCode: 128, stderr: "fatal: cannot init" }, reason: /git init failed/u }
    ];
    for (const scenario of scenarios) {
      const outputDir = join(sandbox, scenario.name.replaceAll(" ", "-"), "eval-runs");
      mkdirSync(outputDir, { recursive: true });
      let claudeCalls = 0;
      const run = async ({ executable, args }) => {
        if (executable === "git") return scenario.git ?? ok;
        if (args.includes("list")) return { ...ok, stdout: "[]" };
        claudeCalls += 1;
        return scenario.claude;
      };
      const { summary, batch, runDir } = await runSuite({ run, preconditions, suitePath, outputDir, mode: "rendered" });
      assert.equal(summary.notRun, summary.total, scenario.name);
      assert.equal(summary.fail, 0, scenario.name);
      assert.ok(batch.results.every((entry) => scenario.reason.test(entry.metadata.reason)), `${scenario.name}: ${batch.results.map((entry) => entry.metadata.reason).join("; ")}`);
      assert.ok(readdirSync(runDir).includes("result.json"), `${scenario.name}: the run must still leave a result file`);
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
  assert.equal(parseSkillTrailer("skill: all-about-agents: brainstorming"), "brainstorming", "a space after the namespace still names the skill");
  assert.equal(parseSkillTrailer("skill: `all-about-agents:` —"), null, "a bare namespace names no skill");
  const bareNamespace = evaluateCase({ skill: "brainstorming", caseSpec: { id: "BR-NONTRIGGER-trivial-readonly" }, resultText: "skill: all-about-agents:" });
  assert.equal(bareNamespace.status, "FAIL", "an empty route must not pass a nontrigger case");
  assert.match(bareNamespace.reason, /trailer/u);
  assert.equal(evaluateCase({ skill: "brainstorming", caseSpec: { id: "BR-NONTRIGGER-trivial-readonly" }, resultText: "skill: all-about-agents: brainstorming" }).status, "FAIL");
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
