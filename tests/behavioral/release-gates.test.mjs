import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { access, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, posix, resolve, win32 } from "node:path";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
import { validateSkillArtifacts } from "../../installers/lib/validate-skill.mjs";
import { materializeRenderResult, renderForSurface } from "../../installers/lib/render.mjs";
import { validateRenderResult } from "../../adapters/shared/adapter-contract.mjs";
import { nativeIntegrationStatus } from "../../adapters/shared/native-state.mjs";
import { CANONICAL_ROLE_IDS, assertNativeRoleSemantics, isRoleReadOnly } from "../../core/roles/contract.mjs";
import { isContained, assertSafeDestinationRoot } from "../../installers/lib/roots.mjs";
import { auditPresentationTrace } from "../../core/evals/presentation-trace.mjs";
import presentationScenarios from "../../core/evals/scenarios/presentation-contract.json" with { type: "json" };
import { withTempRoot } from "../helpers/temp-root.mjs";
import { main } from "../../scripts/aaa.mjs";

const requiredOutputs = [
  "core/evals/rubric.json",
  "core/evals/presentation-trace.mjs",
  "core/evals/presentation-trace.schema.json",
  "core/evals/scenarios/presentation-contract.json",
  "tests/behavioral/presentation-contract.test.mjs",
  "tests/behavioral/release-gates.test.mjs",
  "docs/evaluations/method.md"
];

test("T050 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) {
    await access(resolve(process.cwd(), relativePath));
  }
});

test("every canonical skill owns its source, inventory, companions, routing cases, and behavioral test", async () => {
  const core = await loadCore(process.cwd());
  const results = [];
  for (const skillId of core.inventory.skills) {
    results.push(await validateSkillArtifacts({ repositoryRoot: process.cwd(), core, skillId }));
  }
  const failures = results.flatMap((result) => result.errors.map((entry) => `${result.skillId}:${entry.code}:${entry.path}`));
  assert.deepEqual(failures, []);
  assert.equal(results.length, core.inventory.skills.length);
  assert.ok(results.every((result) => result.valid));
});

test("emergency protection remains a non-runtime claim across rendered surfaces", async () => {
  const core = await loadCore(process.cwd());
  const renders = [
    await renderForSurface({ repositoryRoot: process.cwd(), core, surface: "claude", profile: "template", statuslineName: "", platform: process.platform }),
    await renderForSurface({ repositoryRoot: process.cwd(), core, surface: "codex", profile: "template", targetRuntime: "cli", platform: process.platform }),
    await renderForSurface({ repositoryRoot: process.cwd(), core, surface: "codex", profile: "template", targetRuntime: "desktop", platform: process.platform })
  ];
  for (const rendered of renders) {
    const records = rendered.registrations.filter((entry) => entry.kind === "native-integration" && entry.feature === "emergency-protection");
    assert.equal(records.length, 1);
    assert.notEqual(nativeIntegrationStatus(records[0]), "pass");
    assert.doesNotMatch(JSON.stringify(records[0]), /"(?:automatic|enabled|active|ready)"\s*:\s*true/iu);
  }
});

test("T07 structured presentation scenarios are deterministic and do not make native claims", async () => {
  const core = await loadCore(process.cwd());
  assert.equal(presentationScenarios.scenarios.length, 9);
  for (const scenario of presentationScenarios.scenarios) {
    for (const entry of scenario.cases) {
      const first = auditPresentationTrace({ trace: entry.trace, presentation: core.presentation });
      const second = auditPresentationTrace({ trace: entry.trace, presentation: core.presentation });
      assert.deepEqual(first, second, `${scenario.id}/${entry.id} must be deterministic`);
      assert.equal(first.valid, entry.expectedValid, `${scenario.id}/${entry.id}: ${JSON.stringify(first.errors)}`);
      if (entry.expectedValid) assert.deepEqual(first.errors, []);
    }
  }
  const exceptional = auditPresentationTrace({ trace: presentationScenarios.scenarios.find((entry) => entry.id === "exceptional-terminal-reasons").cases[0].trace, presentation: core.presentation });
  assert.equal(exceptional.summary.terminalExceptionalStates.length, 4);
});

const rubricPath = resolve(process.cwd(), "core/evals/rubric.json");
const evidenceDirectory = resolve(process.cwd(), "tests", ".tmp", "t050-release-gates");
const surfaces = ["claude", "codex"];
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
  if (surface === "claude") return `skills/${skillId}/SKILL.md`;
  return `.agents/skills/${skillId}/SKILL.md`;
}

function rolePath(surface, roleId) {
  if (surface === "claude") return `agents/${roleId}.md`;
  return `.codex/agents/${roleId}.toml`;
}

async function removeReleaseGateEvidence() {
  const expectedParent = resolve(process.cwd(), "tests", ".tmp");
  if (dirname(evidenceDirectory) !== expectedParent || basename(evidenceDirectory) !== "t050-release-gates") {
    throw new Error("Refusing to remove an unexpected release-gate evidence path");
  }
  try {
    const metadata = await lstat(evidenceDirectory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("Refusing to remove release-gate evidence that is not a real directory");
    }
    await rm(evidenceDirectory, { recursive: true, force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
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
    "containment-miss",
    "read-only-miss",
    "missing-skill",
    "active-unsupported",
    "flake",
    "threshold-miss"
  ]);
  assert.equal(rubric.qualification["gate-2-native"].status, "NOT_RUN_UNAVAILABLE");
  assert.equal(rubric.qualification["gate-3-external-sessions"].status, "NOT_RUN_UNAVAILABLE");
  assert.match(rubric.qualification["gate-2-native"].reason, /Partial Windows native evidence/u);
  assert.match(rubric.qualification["gate-3-external-sessions"].reason, /No complete cross-surface fresh-session behavioral evaluation/u);
  assert.doesNotMatch(JSON.stringify(rubric.qualification), /Native product sessions and a macOS host are unavailable|No truthful external fresh-session model transport is available/u);
});

test("deterministic Gate 0/1 report proves portable seams without native claims", async (t) => {
  t.after(removeReleaseGateEvidence);
  const core = await loadCore(process.cwd());
  const checks = [];
  const surfaceEvidence = [];
  assert.equal(core.skills.length, 28);
  assert.equal(core.roles.length, CANONICAL_ROLE_IDS.length);
  assert.equal(core.rules.length, 9);
  const validationResult = parseCliJson(await captureCli(["validate", "--scope", "all", "--format", "json"]), 0, "Gate 0 validate --scope all");
  assert.equal(validationResult.status, "pass");
  checks.push({ id: "load-core-and-validate", status: "PASS", evidence: { validationStatus: validationResult.status, skills: core.skills.length, roles: core.roles.length, rules: core.rules.length } });

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

  const disposableRoot = resolve(process.cwd(), "tests", ".tmp", "t050-release-gates");
  const pathModule = process.platform === "win32" ? win32 : posix;
  assert.equal(isContained(resolve(process.cwd(), "tests", ".tmp"), disposableRoot, pathModule), true);
  assert.equal(isContained(resolve(process.cwd(), "tests", ".tmp"), resolve(process.cwd(), "tests", "outside"), pathModule), false);
  assert.doesNotThrow(() => assertSafeDestinationRoot(disposableRoot, { allowedProductRoots: [disposableRoot] }));
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
      "tests/.tmp/t050-release-gates/gate-1-eval-result.json"
    ],
    gates: [
      { id: "gate-0-static", status: "PASS", passRate: 100, evidence: checks.slice(0, 7).map((check) => check.id) },
      { id: "gate-1-deterministic", status: "PASS", passRate: 100, evidence: checks.at(-1).evidence },
      ...checks.slice(2).map((check) => ({ id: check.id, status: check.status, passRate: 100, evidence: check.evidence }))
    ],
    surfaces: surfaceEvidence,
    notRun: [
      { id: "gate-2-native", status: "NOT_RUN_UNAVAILABLE", evidence: "Partial Windows native checks passed; remaining authenticated, behavioral, Desktop/IDE, and macOS checks are unavailable or not run; follow tests/integration/manual-desktop-checklist.json." },
      { id: "gate-3-external-sessions", status: "NOT_RUN_UNAVAILABLE", evidence: "No complete cross-surface fresh-session behavioral evaluation is retained; follow docs/evaluations/method.md." },
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
