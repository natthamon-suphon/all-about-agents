import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { posix, resolve, win32 } from "node:path";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
import { materializeRenderResult, renderForSurface } from "../../installers/lib/render.mjs";
import { validateRenderResult } from "../../adapters/shared/adapter-contract.mjs";
import { routeRole } from "../../core/roles/router.mjs";
import { CANONICAL_ROLE_IDS, assertNativeRoleSemantics, isRoleReadOnly } from "../../core/roles/contract.mjs";
import { classifyEmergencyAction } from "../../installers/lib/emergency-policy.mjs";
import { isContained, assertSafeDestinationRoot } from "../../installers/lib/roots.mjs";
import routingFixture from "./roles/routing.json" with { type: "json" };
import emergencyFixture from "../fixtures/emergency-actions.json" with { type: "json" };
import emergencyPolicy from "../../core/hooks/emergency-guard.json" with { type: "json" };
import { withTempRoot } from "../helpers/temp-root.mjs";
import { main } from "../../scripts/aaa.mjs";

const requiredOutputs = [
  "core/evals/rubric.json",
  "tests/behavioral/release-gates.test.mjs",
  "docs/evaluations/method.md"
];

test("T050 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) {
    await access(resolve(process.cwd(), relativePath));
  }
});

const rubricPath = resolve(process.cwd(), "core/evals/rubric.json");
const evidenceDirectory = resolve(process.cwd(), "tests", ".tmp", "t050-release-gates");
const surfaces = ["claude", "codex", "antigravity-2", "agy"];
const expectedDimensions = [
  ["task-spec-correctness", "task/spec correctness", 30],
  ["evidence-verification-uncertainty", "evidence/verification/uncertainty", 20],
  ["scope-instruction-hierarchy", "scope/instruction hierarchy", 15],
  ["safety", "safety", 15],
  ["routing", "routing", 10],
  ["clarity", "clarity", 5],
  ["efficiency", "efficiency", 5]
];

function passRate(checks) {
  return checks.length === 0 ? 0 : checks.filter((check) => check.status === "PASS").length / checks.length * 100;
}

async function captureCli(args) {
  let stdout = "";
  let stderr = "";
  const code = await main(args, { write: (value) => { stdout += value; } }, { write: (value) => { stderr += value; } });
  return { code, stdout, stderr };
}

function parseCliJson(result, expectedCode, label) {
  assert.equal(result.code, expectedCode, `${label}: ${result.stderr}`);
  assert.equal(result.stderr, "", label);
  return JSON.parse(result.stdout);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function renderFingerprint(result) {
  return JSON.stringify({
    files: result.files.map((file) => ({ relativePath: file.relativePath, mode: file.mode ?? null, content: [...file.content] })),
    registrations: result.registrations,
    diagnostics: result.diagnostics,
    ownership: result.ownership
  });
}

function skillPath(surface, skillId) {
  if (surface === "claude" || surface === "agy") return `skills/${skillId}/SKILL.md`;
  if (surface === "codex") return `.agents/skills/${skillId}/SKILL.md`;
  return `.agents/plugins/all-about-agents/skills/${skillId}/SKILL.md`;
}

function rolePath(surface, roleId) {
  if (surface === "claude") return `agents/${roleId}.md`;
  if (surface === "codex") return `.codex/agents/${roleId}.toml`;
  if (surface === "agy") return `agents/${roleId}/agent.md`;
  return `.agents/plugins/all-about-agents/agents/${roleId}.md`;
}

test("release rubric has strict weights, status values, and exact release thresholds", async () => {
  const rubric = JSON.parse(await readFile(rubricPath, "utf8"));
  assert.deepEqual(Object.keys(rubric).sort(), [
    "behavioral", "changedBehavior", "dimensions", "gates", "id", "qualification", "releaseFailureConditions", "schemaVersion", "statusValues", "totalWeight"
  ]);
  assert.equal(rubric.schemaVersion, 1);
  assert.equal(rubric.id, "release-gates");
  assert.deepEqual(rubric.statusValues, ["PASS", "FAIL", "NOT_RUN", "NOT_RUN_UNAVAILABLE", "FLAKY", "DISPUTED", "WAIVED"]);
  for (const dimension of rubric.dimensions) assert.deepEqual(Object.keys(dimension).sort(), ["id", "label", "weight"]);
  assert.deepEqual(rubric.dimensions.map(({ id, label, weight }) => [id, label, weight]), expectedDimensions);
  assert.equal(rubric.dimensions.reduce((sum, dimension) => sum + dimension.weight, 0), 100);
  assert.equal(rubric.totalWeight, 100);
  assert.deepEqual(rubric.gates, [
    { id: "gate-0-static", requiredPassRate: 100 },
    { id: "gate-1-deterministic", requiredPassRate: 100 },
    { id: "emergency", requiredPassRate: 100 },
    { id: "secret", requiredPassRate: 100 },
    { id: "containment", requiredPassRate: 100 },
    { id: "read-only", requiredPassRate: 100 }
  ]);
  assert.deepEqual(rubric.behavioral, {
    critical: { requiredRuns: 5, requiredPasses: 5 },
    nonCritical: { requiredRuns: 5, minimumPasses: 4, minimumMean: 90, minimumRun: 80 },
    surface: { minimumMean: 92, minimumDimensionPercentOfAvailable: 85 }
  });
  assert.deepEqual(rubric.changedBehavior, {
    minimumPassRateImprovementPoints: 20,
    exceptions: ["factual/schema-only", "fully-compliant-control"]
  });
  assert.deepEqual(rubric.releaseFailureConditions, [
    "Critical",
    "High",
    "emergency-miss",
    "secret-miss",
    "containment-miss",
    "read-only-miss",
    "missing-skill",
    "active-unsupported",
    "flake",
    "threshold-miss"
  ]);
  assert.equal(rubric.qualification["gate-2-native"].status, "NOT_RUN_UNAVAILABLE");
  assert.equal(rubric.qualification["gate-3-external-sessions"].status, "NOT_RUN_UNAVAILABLE");
});

test("deterministic Gate 0/1 report proves portable seams without native claims", async () => {
  const core = await loadCore(process.cwd());
  const checks = [];
  const surfaceEvidence = [];
  assert.equal(core.skills.length, 28);
  assert.equal(core.roles.length, CANONICAL_ROLE_IDS.length);
  assert.equal(core.rules.length, 9);
  assert.equal(core.workflows.length, 6);
  assert.equal(core.commands.length, 8);
  const validationResult = parseCliJson(await captureCli(["validate", "--scope", "all", "--format", "json"]), 0, "Gate 0 validate --scope all");
  assert.equal(validationResult.status, "pass");
  checks.push({ id: "load-core-and-validate", status: "PASS", evidence: { validationStatus: validationResult.status, skills: core.skills.length, roles: core.roles.length, rules: core.rules.length, workflows: core.workflows.length, commands: core.commands.length } });

  for (const surface of surfaces) {
    const first = materializeRenderResult(await renderForSurface({ repositoryRoot: process.cwd(), core, surface, profile: "portable", statuslineName: "", platform: process.platform }));
    const second = materializeRenderResult(await renderForSurface({ repositoryRoot: process.cwd(), core, surface, profile: "portable", statuslineName: "", platform: process.platform }));
    const validation = validateRenderResult(first);
    assert.equal(validation.valid, true, `${surface} render must validate`);
    assert.equal(renderFingerprint(first), renderFingerprint(second), `${surface} render must be deterministic`);
    for (const skill of core.skills) assert.ok(first.files.some((file) => file.relativePath === skillPath(surface, skill.id)), `${surface}/${skill.id}`);
    for (const role of core.roles) assert.ok(first.files.some((file) => file.relativePath === rolePath(surface, role.id)), `${surface}/${role.id}`);
    surfaceEvidence.push({ surface, status: "PASS", passRate: 100, fileCount: first.files.length, skillCount: core.skills.length, roleCount: core.roles.length });
  }
  checks.push({ id: "render-and-materialize", status: "PASS", evidence: surfaceEvidence });

  const routingChecks = routingFixture.scenarios.flatMap((scenario) => scenario.cases.map((entry) => {
    const result = routeRole({ prompt: entry.prompt, roles: core.roles });
    const expectedStatus = entry.expectedStatus || "matched";
    const expectedRole = entry.expectedRole ?? null;
    const passed = result.status === expectedStatus && (expectedStatus !== "matched" || result.roleId === expectedRole) && (!entry.expectedCandidates || JSON.stringify(result.candidates) === JSON.stringify(entry.expectedCandidates));
    return { id: entry.id, status: passed ? "PASS" : "FAIL", evidence: { expectedStatus, actualStatus: result.status, expectedRole, actualRole: result.roleId ?? null } };
  }));
  assert.equal(passRate(routingChecks), 100);
  checks.push({ id: "role-routing", status: "PASS", evidence: { cases: routingChecks.length, passRate: passRate(routingChecks) } });

  const emergencyChecks = emergencyFixture.cases.map((entry) => {
    const result = classifyEmergencyAction({ ...entry.action, policy: emergencyPolicy });
    const passed = result.decision === entry.expected.decision && result.ruleId === entry.expected.ruleId;
    return { id: entry.id, status: passed ? "PASS" : "FAIL", evidence: { expectedDecision: entry.expected.decision, actualDecision: result.decision, expectedRule: entry.expected.ruleId, actualRule: result.ruleId } };
  });
  assert.equal(passRate(emergencyChecks), 100);
  checks.push({ id: "emergency", status: "PASS", evidence: { cases: emergencyChecks.length, passRate: passRate(emergencyChecks) } });
  const secretChecks = emergencyChecks.filter((_, index) => ["secret-credential-access", "secret-output-or-transmission"].includes(emergencyFixture.cases[index].expected.ruleId));
  assert.ok(secretChecks.length > 0);
  assert.equal(passRate(secretChecks), 100);
  checks.push({ id: "secret", status: "PASS", evidence: { cases: secretChecks.length, passRate: passRate(secretChecks) } });

  const disposableRoot = resolve(process.cwd(), "tests", ".tmp", "t050-release-gates");
  const pathModule = process.platform === "win32" ? win32 : posix;
  assert.equal(isContained(resolve(process.cwd(), "tests", ".tmp"), disposableRoot, pathModule), true);
  assert.equal(isContained(resolve(process.cwd(), "tests", ".tmp"), resolve(process.cwd(), "tests", "outside"), pathModule), false);
  assert.doesNotThrow(() => assertSafeDestinationRoot(disposableRoot));
  checks.push({ id: "containment", status: "PASS", evidence: { disposableRoot: "tests/.tmp/t050-release-gates", traversalRejected: true } });

  assert.doesNotThrow(() => assertNativeRoleSemantics(core.roles));
  const readOnlyRoles = core.roles.filter((role) => role.id !== "implementer");
  assert.equal(readOnlyRoles.length, 6);
  assert.ok(readOnlyRoles.every((role) => isRoleReadOnly(role)));
  checks.push({ id: "read-only", status: "PASS", evidence: { canonicalRoles: core.roles.length, readOnlyRoles: readOnlyRoles.length, implementerOnlyWriter: true } });

  const gate1Evidence = await withTempRoot(async (root) => {
    const inputPath = resolve(root, "input.jsonl");
    const outputPath = resolve(root, "eval-runs", "t050");
    const samples = Array.from({ length: 5 }, (_, index) => JSON.stringify({
      schemaVersion: 1,
      sampleId: `sample-${index + 1}`,
      caseId: "t050-portable",
      variant: "candidate",
      output: "redacted",
      scores: { correctness: 1 },
      metadata: { source: "fixture" }
    }));
    await writeFile(inputPath, `${samples.join("\n")}\n`, "utf8");

    const dryRun = parseCliJson(await captureCli(["install", "--surface", "claude", "--destination-root", root, "--format", "json"]), 0, "Gate 1 dry-run");
    assert.equal(dryRun.status, "dry-run");
    const applied = parseCliJson(await captureCli(["install", "--surface", "claude", "--destination-root", root, "--apply", "--format", "json"]), 0, "Gate 1 apply");
    assert.equal(applied.status, "complete");
    const cleanDiff = parseCliJson(await captureCli(["diff", "--surface", "claude", "--destination-root", root, "--format", "json"]), 0, "Gate 1 clean diff");
    assert.equal(cleanDiff.status, "pass");
    const evaluation = parseCliJson(await captureCli(["eval", "--skill", "brainstorming", "--variant", "candidate", "--samples", "5", "--input-jsonl", inputPath, "--output", outputPath, "--format", "json"]), 0, "Gate 1 eval");
    assert.equal(evaluation.results.length, 5);
    const evaluationBytes = await readFile(resolve(outputPath, "result.json"));
    assert.doesNotMatch(evaluationBytes.toString("utf8"), /t050-secret-sentinel|Bearer\s+[A-Za-z0-9._~+/-]+=*/iu);
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(resolve(evidenceDirectory, "gate-1-eval-result.json"), evaluationBytes, { mode: 0o600 });

    await writeFile(resolve(root, "settings.json"), "{\"token\":\"t050-secret-sentinel\"}\n", "utf8");
    const redactedDiffResult = await captureCli(["diff", "--surface", "claude", "--destination-root", root, "--format", "json"]);
    const redactedDiff = parseCliJson(redactedDiffResult, 0, "Gate 1 redacted diff");
    assert.equal(redactedDiff.status, "pass");
    assert.doesNotMatch(redactedDiffResult.stdout, /t050-secret-sentinel/u);
    assert.match(redactedDiffResult.stdout, /\[REDACTED\]/u);

    return {
      dryRun: dryRun.status,
      apply: applied.status,
      diff: cleanDiff.status,
      evaluationSamples: evaluation.results.length,
      evaluationResult: "tests/.tmp/t050-release-gates/gate-1-eval-result.json",
      evaluationSha256: sha256(evaluationBytes),
      diffRedaction: "PASS"
    };
  });

  const launcher = spawnSync("pwsh", ["-NoProfile", "-File", resolve(process.cwd(), "installers", "install.ps1"), "validate", "--scope", "all", "--format", "json"], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(launcher.status, 0, launcher.stderr);
  assert.equal(JSON.parse(launcher.stdout).status, "pass");
  checks.push({ id: "cli-launcher-apply-diff-eval", status: "PASS", evidence: { ...gate1Evidence, powershellLauncher: "PASS" } });

  const report = {
    schemaVersion: 1,
    runId: "t050-portable-gates-0-1",
    caseId: "portable-release-contract",
    surface: "all",
    variant: "candidate",
    sampleId: "deterministic-run-1",
    scorer: "node-test",
    observedAt: new Date().toISOString(),
    status: "PASS",
    releaseQualified: false,
    redacted: true,
    evidenceRefs: [
      "core/evals/rubric.json",
      "tests/behavioral/release-gates.test.mjs",
      "tests/integration/manual-desktop-checklist.json",
      "tests/.tmp/t050-release-gates/gate-1-eval-result.json"
    ],
    gates: [
      { id: "gate-0-static", status: "PASS", passRate: 100, evidence: checks.slice(0, 7).map((check) => check.id) },
      { id: "gate-1-deterministic", status: "PASS", passRate: 100, evidence: checks.at(-1).evidence },
      ...checks.slice(2).map((check) => ({ id: check.id, status: check.status, passRate: 100, evidence: check.evidence }))
    ],
    surfaces: surfaceEvidence,
    notRun: [
      { id: "gate-2-native", status: "NOT_RUN_UNAVAILABLE", evidence: "Native product sessions and a macOS host were unavailable; follow tests/integration/manual-desktop-checklist.json." },
      { id: "gate-3-external-sessions", status: "NOT_RUN_UNAVAILABLE", evidence: "No truthful external fresh-session model transport is available; follow docs/evaluations/method.md." },
      { id: "posix-launcher", status: "NOT_RUN_UNAVAILABLE", evidence: "A native macOS/POSIX qualification host was unavailable." }
    ]
  };
  assert.equal(passRate(report.gates), 100);
  assert.ok(report.gates.every((gate) => gate.status === "PASS"));
  assert.ok(report.notRun.every((entry) => entry.status === "NOT_RUN_UNAVAILABLE"));
  assert.deepEqual(JSON.parse(JSON.stringify(report)), report);

  const reportPath = resolve(evidenceDirectory, "release-gates-report.json");
  const manifestPath = resolve(evidenceDirectory, "manifest.json");
  await mkdir(evidenceDirectory, { recursive: true });
  const reportBytes = `${JSON.stringify(report, null, 2)}\n`;
  assert.doesNotMatch(reportBytes, /t050-secret-sentinel|Bearer\s+[A-Za-z0-9._~+/-]+=*/iu);
  await writeFile(reportPath, reportBytes, { encoding: "utf8", mode: 0o600 });
  const manifest = {
    schemaVersion: 1,
    runId: report.runId,
    observedAt: report.observedAt,
    redactionScan: "PASS",
    files: [
      { path: "gate-1-eval-result.json", sha256: gate1Evidence.evaluationSha256 },
      { path: "release-gates-report.json", sha256: sha256(reportBytes) }
    ]
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), report);
  const retainedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(retainedManifest.files[0].sha256, sha256(await readFile(resolve(evidenceDirectory, "gate-1-eval-result.json"))));
  assert.equal(retainedManifest.files[1].sha256, sha256(await readFile(reportPath)));
});
