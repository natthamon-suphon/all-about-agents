import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { loadCore } from "../../../installers/lib/load-core.mjs";
import { renderClaude } from "../../../adapters/claude/adapter.mjs";
import { renderCodex } from "../../../adapters/codex/adapter.mjs";
import { renderAntigravity } from "../../../adapters/antigravity-2/adapter.mjs";
import { renderAgy } from "../../../adapters/agy/adapter.mjs";

const routing = JSON.parse(await readFile(resolve(process.cwd(), "tests/behavioral/roles/routing.json"), "utf8"));

function filePath(surface, roleId) {
  return surface === "claude"
    ? `agents/${roleId}.md`
    : surface === "codex"
      ? `.codex/agents/${roleId}.toml`
      : surface === "antigravity-2"
        ? `.agents/plugins/all-about-agents/agents/${roleId}.md`
        : `agents/${roleId}/agent.md`;
}

test("critical canonical routing scenarios score 5/5 using the production routing seam", async () => {
  const { routeRole } = await import("../../../core/roles/router.mjs");
  const core = await loadCore(process.cwd());
  for (const scenario of routing.scenarios.filter((entry) => entry.critical === true)) {
    const results = scenario.cases.map((entry) => ({
      id: entry.id,
      expected: entry.expectedRole,
      actual: routeRole({ prompt: entry.prompt, roles: core.roles })
    }));
    assert.equal(results.length, 5, `${scenario.id} must contain five cases`);
    assert.equal(results.filter((entry) => entry.expected === entry.actual.roleId && entry.actual.status === "matched").length, 5, JSON.stringify({ scenario: scenario.id, results }));
  }
});

test("routing production seam reports ambiguity and no-route explicitly", async () => {
  const { routeRole } = await import("../../../core/roles/router.mjs");
  const core = await loadCore(process.cwd());
  const scenario = routing.scenarios.find((entry) => entry.id === "routing-edge-cases");
  assert.ok(scenario);
  for (const entry of scenario.cases) {
    const actual = routeRole({ prompt: entry.prompt, roles: core.roles });
    assert.equal(actual.status, entry.expectedStatus, entry.id);
    assert.equal(actual.roleId ?? null, entry.expectedRole ?? null, entry.id);
    if (entry.expectedCandidates) assert.deepEqual(actual.candidates, entry.expectedCandidates, entry.id);
  }
});

test("supported renderers preserve every production-selected canonical role id", async () => {
  const { routeRole } = await import("../../../core/roles/router.mjs");
  const core = await loadCore(process.cwd());
  const renders = [
    ["claude", renderClaude({ core, profile: "portable", statuslineName: "roles", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["codex", renderCodex({ core, profile: "portable", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["antigravity-2", renderAntigravity({ core, profile: "portable", statuslineName: "roles" })],
    ["agy", renderAgy({ core, profile: "portable", statuslineName: "roles", platform: "win32" })]
  ].map(([surface, result]) => [surface, new Map(result.files.map((file) => [file.relativePath, new TextDecoder().decode(file.content)]))]);
  for (const scenario of routing.scenarios.filter((entry) => entry.critical === true)) {
    for (const entry of scenario.cases) {
      const route = routeRole({ prompt: entry.prompt, roles: core.roles });
      assert.equal(route.status, "matched");
      for (const [surface, files] of renders) {
        const artifact = files.get(filePath(surface, route.roleId));
        assert.ok(artifact, `${surface}/${route.roleId}`);
        const renderedId = surface === "codex"
          ? (await import("../../../adapters/codex/adapter.mjs")).parseCodexToml(artifact).name
          : /^name:\s*["']?([^"'\n]+)["']?/mu.exec(artifact)?.[1];
        assert.equal(renderedId, route.roleId, `${surface} must preserve the production-selected canonical role id`);
      }
    }
  }
});

test("production router validates canonical ingress and ignores negated generic words", async () => {
  const { routeRole } = await import("../../../core/roles/router.mjs");
  const core = await loadCore(process.cwd());
  assert.throws(() => routeRole({ prompt: "Review the source.", roles: [core.roles[0]] }), /canonical role|missing/iu);
  for (const prompt of ["Do not modify files; just answer.", "This has risk.", "Review the source.", "Do not write files."]) {
    const result = routeRole({ prompt, roles: core.roles });
    assert.notEqual(result.status, "matched", prompt);
  }
});

test("production router ignores explicitly negated role-intent signals", async () => {
  const { routeRole } = await import("../../../core/roles/router.mjs");
  const core = await loadCore(process.cwd());
  for (const prompt of [
    "Do not review the diff against the specification.",
    "Never apply the test-first vertical slice.",
    "Do not check privilege elevation and destructive-operation containment.",
    "Don't find the current official API specification.",
    "Do not trace this failing stack.",
    "Never, ever apply the test-first vertical slice.",
    "No need to run a fresh black-box check; just summarize the issue.",
    "I do not want you to review the diff against the specification."
  ]) {
    const result = routeRole({ prompt, roles: core.roles });
    assert.equal(result.status, "no-route", prompt);
    assert.equal(result.roleId, null, prompt);
  }
});
