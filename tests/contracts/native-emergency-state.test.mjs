import assert from "node:assert/strict";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
import { renderAgy } from "../../adapters/agy/adapter.mjs";
import { renderAntigravity } from "../../adapters/antigravity-2/adapter.mjs";
import { renderClaude } from "../../adapters/claude/adapter.mjs";
import { renderCodex } from "../../adapters/codex/adapter.mjs";
import { NATIVE_PHASES, validateNativeIntegrationRecord } from "../../adapters/shared/native-state.mjs";
import { DEFAULT_RULE_IDS } from "../../installers/lib/emergency-policy.mjs";

const core = await loadCore(process.cwd());
const template = { core, profile: { id: "template" }, statuslineName: "" };
const exactDesktopDenies = [
  "command(rm -rf)",
  "command(sudo)",
  "write_file(.git/)",
  "write_file(/home/user/.ssh)"
];

function emergencyRecord(result, label) {
  const records = result.registrations.filter((entry) => entry.kind === "native-integration" && entry.feature === "emergency-protection");
  assert.equal(records.length, 1, `${label} must emit one emergency-protection native record`);
  const [record] = records;
  assert.equal(validateNativeIntegrationRecord(record).valid, true, `${label} emergency record must satisfy the shared lifecycle contract`);
  assert.deepEqual(Object.keys(record.phases), NATIVE_PHASES, `${label} phases must use the fixed lifecycle order`);
  return record;
}

function fileMap(result) {
  return new Map(result.files.map((file) => [file.relativePath, new TextDecoder().decode(file.content)]));
}

test("all four adapters and both profiles emit one truthful emergency lifecycle record", () => {
  for (const profile of ["portable", "template"]) {
    const input = { core, profile: { id: profile }, statuslineName: "" };
    const cases = [
    {
      label: `${profile} Claude`,
      result: renderClaude(input),
      surface: "claude",
      expected: { rendered: "pass", validated: "not-run", registered: "not-run", trusted: "not-run-unavailable", active: "not-run", runtimeVerified: "not-run" }
    },
    {
      label: `${profile} Codex CLI`,
      result: renderCodex({ core, profile: { id: profile }, targetRuntime: "cli" }),
      surface: "codex",
      expected: { rendered: "pass", validated: "not-run", registered: "not-run", trusted: "not-run", active: "not-run", runtimeVerified: "not-run" }
    },
    {
      label: `${profile} Codex Desktop`,
      result: renderCodex({ core, profile: { id: profile }, targetRuntime: "desktop" }),
      surface: "codex",
      expected: { rendered: "pass", validated: "not-run", registered: "not-run", trusted: "not-run", active: "not-run", runtimeVerified: "not-run" }
    },
    {
      label: `${profile} agy`,
      result: renderAgy({ ...input, platform: "win32", configRoot: "C:/fixtures/agy-config" }),
      surface: "agy",
      expected: { rendered: "pass", validated: "not-run", registered: "not-run", trusted: "not-run", active: "not-run", runtimeVerified: "not-run" }
    },
    {
      label: `${profile} Antigravity Desktop`,
      result: renderAntigravity(input),
      surface: "antigravity-2",
      expected: { rendered: "pass", validated: "not-run", registered: "not-run", trusted: "not-run", active: "not-run", runtimeVerified: "not-run" }
    }
    ];

    for (const { label, result, surface, expected } of cases) {
      const record = emergencyRecord(result, label);
      assert.equal(record.surface, surface, `${label} surface must be canonical`);
      assert.deepEqual(Object.fromEntries(NATIVE_PHASES.map((phase) => [phase, record.phases[phase].status])), expected, `${label} lifecycle status is truthful`);
      assert.ok(record.manualSteps.length > 0, `${label} must describe the manual/native next step`);
      if (profile === "portable" && label.includes("agy")) {
        assert.doesNotMatch(`${record.phases.rendered.evidence} ${record.manualSteps.join(" ")}`, /always-proceed|per-run skip/iu, "portable agy must not claim template-only full access");
      }
      if (profile === "portable" && label.includes("Codex")) {
        assert.doesNotMatch(record.manualSteps.join(" "), /danger-full-access|approvals never|approvals-never/iu, "portable Codex must not claim template-only full access");
      }
      if (label.includes("Desktop")) {
        for (const deny of exactDesktopDenies) assert.ok(record.manualSteps.some((step) => step.includes(deny)), `${label} must list exact deny ${deny}`);
      }
    }
  }
});

test("full-access profiles retain canonical emergency denies on every surface", () => {
  const claudeSettings = JSON.parse(fileMap(renderClaude(template)).get("config/settings.json"));
  assert.equal(claudeSettings.permissions.defaultMode, "bypassPermissions");
  assert.deepEqual(claudeSettings.permissions.deny, ["Bash(rm -rf /)", "Bash(rm -rf ~)", "Bash(git push --force*)", "Bash(git reset --hard*)"]);

  for (const targetRuntime of ["cli", "desktop"]) {
    const codexFiles = fileMap(renderCodex({ core, profile: { id: "template" }, targetRuntime }));
    const config = codexFiles.get("config.toml");
    assert.match(config, /sandbox_mode\s*=\s*"danger-full-access"/u, `Codex ${targetRuntime} full-access mode`);
    assert.match(config, /approval_policy\s*=\s*"never"/u, `Codex ${targetRuntime} approval policy`);
    if (targetRuntime === "cli") {
      assert.deepEqual(JSON.parse(codexFiles.get("hooks/emergency-guard.json")).orderedRuleIds, DEFAULT_RULE_IDS, `Codex ${targetRuntime} emergency policy`);
    } else {
      assert.equal(codexFiles.has("hooks/emergency-guard.json"), false, "Codex Desktop must not copy an unverified emergency runtime");
    }
  }

  const agy = renderAgy(template);
  const agySettings = JSON.parse(fileMap(agy).get("settings.overlay.json"));
  assert.equal(agySettings.toolPermission, "always-proceed");
  assert.equal(agySettings.artifactReviewPolicy, "always-proceed");
  assert.deepEqual(agySettings.permissions.deny, ["command(rm -rf)", "command(sudo)", "write_file(.git/)", "write_file(/home/user/.ssh)"]);
  assert.ok(agy.registrations.find((entry) => entry.kind === "full-access-per-run").args.includes("--dangerously-skip-permissions"));

  const antigravity = renderAntigravity(template);
  const permission = antigravity.registrations.find((entry) => entry.kind === "permission-ui");
  assert.equal(permission.preset, "Custom");
  assert.deepEqual(permission.deny, ["command(rm -rf)", "command(sudo)", "write_file(.git/)", "write_file(/home/user/.ssh)"]);
});

test("disabled or untrusted emergency fixtures reject false automatic, enabled, trusted, active, and runtime-verified claims", () => {
  const base = {
    kind: "native-integration",
    surface: "claude",
    feature: "emergency-protection",
    phases: Object.fromEntries(NATIVE_PHASES.map((phase) => [phase, { status: "not-run", evidence: `${phase} was not run` }])),
    sourcePath: "adapters/claude/adapter.mjs",
    manualSteps: ["Run a fresh native emergency probe."]
  };

  for (const field of ["automatic", "enabled", "trusted", "active", "runtimeVerified", "ready"]) {
    const forged = { ...base, [field]: true };
    const validation = validateNativeIntegrationRecord(forged);
    assert.equal(validation.valid, false, `${field}: true must not be accepted as native lifecycle state`);
    assert.ok(validation.errors.some((error) => error.code === "unexpected-field" && error.path === `/${field}`), `${field} must be rejected as an untyped claim`);
  }

  const disabledSurfaces = [
    { label: "Codex Desktop", result: renderCodex({ core, profile: { id: "template" }, targetRuntime: "desktop" }) },
    { label: "agy", result: renderAgy(template) },
    { label: "Antigravity Desktop", result: renderAntigravity(template) }
  ];
  for (const { label, result } of disabledSurfaces) {
    const emergencyClaims = result.registrations.filter((entry) => entry.kind === "emergency-guard" || entry.feature === "emergency-protection");
    assert.ok(emergencyClaims.length > 0, `${label} must expose its emergency state`);
    assert.doesNotMatch(JSON.stringify(emergencyClaims), /"(?:automatic|enabled|active|ready|trusted|runtimeVerified)"\s*:\s*true/iu, `${label} must not claim disabled emergency protection is active`);
  }
});
