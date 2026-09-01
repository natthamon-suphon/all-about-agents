import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { renderClaude } from "../../adapters/claude/adapter.mjs";
import { renderCodex } from "../../adapters/codex/adapter.mjs";
import { renderAntigravity } from "../../adapters/antigravity-2/adapter.mjs";
import { renderAgy } from "../../adapters/agy/adapter.mjs";
import { loadCore } from "../../installers/lib/load-core.mjs";
import { validateSchema } from "../../installers/lib/validate-schema.mjs";
import { PROFILE_MODEL_POLICY_REFS, resolveProfile } from "../../profiles/profile-contract.mjs";

const requiredOutputs = [
  "profiles/portable/profile.json",
  "profiles/template/profile.json",
  "profiles/profile-contract.mjs",
  "core/schemas/profile.schema.json",
  "tests/contracts/profiles.test.mjs"
];

const root = process.cwd();
const core = await loadCore(root);
const json = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));
const schema = await json("core/schemas/profile.schema.json");
const profiles = {
  portable: await json("profiles/portable/profile.json"),
  template: await json("profiles/template/profile.json")
};

const renderers = {
  claude: (profile) => renderClaude({ core, profile, statuslineName: "", env: { CLAUDE_CONFIG_DIR: "C:/disposable/claude" }, homeDir: "C:/Users/tester", platform: "win32" }),
  codex: (profile) => renderCodex({ core, profile, statuslineName: "", env: { CODEX_HOME: "C:/disposable/codex" }, homeDir: "C:/Users/tester", platform: "win32", targetRuntime: "cli" }),
  "antigravity-2": (profile) => renderAntigravity({ core, profile, statuslineName: "", platform: "win32" }),
  agy: (profile) => renderAgy({ core, profile, statuslineName: "", platform: "win32" })
};

function files(result) {
  return new Map(result.files.map((file) => [file.relativePath, new TextDecoder().decode(file.content)]));
}

function serializedFiles(result) {
  return [...files(result).values()].join("\n");
}

function skillPath(surface, skill) {
  if (surface === "claude") return `skills/${skill}/SKILL.md`;
  if (surface === "codex") return `.agents/skills/${skill}/SKILL.md`;
  if (surface === "antigravity-2") return `.agents/plugins/all-about-agents/skills/${skill}/SKILL.md`;
  return `skills/${skill}/SKILL.md`;
}

test("T045 creates every owned artifact", async () => {
  for (const relativePath of requiredOutputs) await access(resolve(root, relativePath));
});

test("portable and template records satisfy the strict vendor-neutral schema", () => {
  for (const [id, profile] of Object.entries(profiles)) {
    const validation = validateSchema({ schema, value: profile, sourcePath: `profiles/${id}/profile.json` });
    assert.deepEqual(validation.errors, []);
    assert.equal(validation.valid, true);
  }
  const invalid = { ...profiles.portable, statuslineName: "hard-coded" };
  const validation = validateSchema({ schema, value: invalid, sourcePath: "invalid-profile.json" });
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.keyword === "additionalProperties" && error.jsonPointer === "/statuslineName"));
});

test("portable is controlled and leaves personal choices to each installed surface", () => {
  assert.equal(profiles.portable.authority, "controlled");
  assert.equal(profiles.portable.reasoning, "surface-default");
  assert.equal(profiles.portable.advisor, "disabled");
  assert.deepEqual(Object.values(profiles.portable.modelPolicies), ["surface-default", "surface-default", "surface-default", "surface-default"]);
  const body = JSON.stringify(profiles.portable);
  for (const forbidden of ["statuslineName", "displayName", "skillPack", "skillPacks", "skills", "includeSkills", "excludeSkills", "toolPermission", "sandbox_mode", "defaultMode"]) {
    assert.equal(body.includes(forbidden), false, `portable profile stores forbidden selector/native key ${forbidden}`);
  }
});

test("template contains only semantic full-access, maximum-reasoning, model, and Fable values", () => {
  assert.equal(profiles.template.authority, "full");
  assert.equal(profiles.template.reasoning, "maximum-supported");
  assert.equal(profiles.template.advisor, "fable");
  assert.deepEqual(profiles.template.modelPolicies, {
    claude: "approved-opus-sonnet",
    codex: "approved-sol-terra",
    "antigravity-2": "approved-desktop-flash",
    agy: "approved-cli-flash"
  });
  const body = JSON.stringify(profiles.template);
  for (const forbidden of ["claude-opus-5", "gpt-5.6-sol", "gemini-3.7-flash-high", "bypassPermissions", "danger-full-access", "statuslineName", "skills"]) {
    assert.equal(body.includes(forbidden), false, `template leaks native value ${forbidden}`);
  }
});

test("profile seam rejects unavailable model-policy evidence and inconsistent semantic pairings", () => {
  for (const surface of Object.keys(renderers)) {
    assert.throws(() => resolveProfile(profiles.template, { surface, modelPolicyRefs: [] }), /no verified native capability evidence/u);
  }
  assert.throws(
    () => resolveProfile({ ...profiles.template, authority: "controlled" }, { surface: "claude", modelPolicyRefs: PROFILE_MODEL_POLICY_REFS.claude }),
    /invalid authority\/advisor\/model pairing/u
  );
  const reordered = {
    ...profiles.template,
    modelPolicies: {
      agy: "approved-cli-flash",
      "antigravity-2": "approved-desktop-flash",
      codex: "approved-sol-terra",
      claude: "approved-opus-sonnet"
    }
  };
  assert.equal(resolveProfile(reordered, { surface: "claude", modelPolicyRefs: PROFILE_MODEL_POLICY_REFS.claude }).id, "template");
  const builtin = resolveProfile("portable", { surface: "claude", modelPolicyRefs: PROFILE_MODEL_POLICY_REFS.claude });
  assert.equal(Object.isFrozen(builtin), true);
  assert.equal(Object.isFrozen(builtin.modelPolicies), true);
});

test("every adapter translates both complete profiles and keeps all skills implicit", () => {
  for (const [surface, render] of Object.entries(renderers)) {
    for (const profile of Object.values(profiles)) {
      const result = render(profile);
      const translation = result.registrations.find((entry) => entry.kind === "profile-translation");
      assert.deepEqual(translation, {
        kind: "profile-translation",
        surface,
        profile: profile.id,
        authority: profile.authority,
        reasoning: profile.reasoning,
        advisor: profile.advisor,
        modelPolicyRef: profile.modelPolicies[surface],
        skillSelection: "all-implicit"
      });
      const renderedPaths = new Set(result.files.map((file) => file.relativePath));
      for (const skill of core.inventory.skills) assert.ok(renderedPaths.has(skillPath(surface, skill)), `${surface}/${profile.id} omitted ${skill}`);
    }
  }
});

test("portable renders safe permissions without pinning personal model choices", () => {
  const outputs = Object.fromEntries(Object.entries(renderers).map(([surface, render]) => [surface, render(profiles.portable)]));
  const claudeSettings = JSON.parse(files(outputs.claude).get("config/settings.json"));
  assert.deepEqual(claudeSettings.permissions, {
    defaultMode: "default",
    deny: ["Bash(rm -rf /)", "Bash(rm -rf ~)", "Bash(git push --force*)", "Bash(git reset --hard*)"]
  });
  assert.equal(claudeSettings.statusLine.type, "command");
  assert.equal(typeof claudeSettings.statusLine.command, "string");
  assert.doesNotMatch(serializedFiles(outputs.claude), /claude-(?:opus|sonnet|fable)-5|CLAUDE_CODE_EFFORT_LEVEL/u);
  assert.doesNotMatch(serializedFiles(outputs.codex), /gpt-5\.6-(?:sol|terra)|model_reasoning_effort/u);
  assert.equal(files(outputs.codex).has("terra-max.config.toml"), false);
  assert.doesNotMatch(serializedFiles(outputs["antigravity-2"]), /Gemini 3\.7 Flash (?:Medium|High)/u);
  assert.equal(outputs["antigravity-2"].registrations.some((entry) => entry.kind === "manual-model-selection"), false);
  assert.doesNotMatch(serializedFiles(outputs.agy), /gemini-3\.7-flash-high|--effort\s+high/u);
  assert.equal(outputs.agy.registrations.some((entry) => entry.kind === "model-selection"), false);
});

test("template renders approved native model contracts and Fable only where supported", () => {
  const outputs = Object.fromEntries(Object.entries(renderers).map(([surface, render]) => [surface, render(profiles.template)]));
  const claude = JSON.parse(files(outputs.claude).get("config/settings.json"));
  assert.equal(claude.model, "claude-opus-5");
  assert.deepEqual(claude.fallbackModel, ["claude-sonnet-5"]);
  assert.equal(claude.advisorModel, "claude-fable-5");
  assert.equal(claude.env.CLAUDE_CODE_EFFORT_LEVEL, "max");
  assert.match(files(outputs.codex).get("config.toml"), /model = "gpt-5\.6-sol"[\s\S]*model_reasoning_effort = "max"/u);
  assert.match(files(outputs.codex).get("terra-max.config.toml"), /model = "gpt-5\.6-terra"[\s\S]*model_reasoning_effort = "max"/u);
  const desktopModel = outputs["antigravity-2"].registrations.find((entry) => entry.kind === "manual-model-selection");
  assert.equal(desktopModel.model, "Gemini 3.7 Flash High");
  assert.equal(outputs["antigravity-2"].diagnostics.some((entry) => entry.code === "desktop-model-high-unsupported"), false);
  const agyModel = outputs.agy.registrations.find((entry) => entry.kind === "model-selection");
  assert.equal(agyModel.model, "gemini-3.7-flash-high");
  assert.equal(agyModel.effort, "high");
});

test("template full access never removes emergency denies", () => {
  const outputs = Object.fromEntries(Object.entries(renderers).map(([surface, render]) => [surface, render(profiles.template)]));
  const claude = JSON.parse(files(outputs.claude).get("config/settings.json"));
  assert.equal(claude.permissions.defaultMode, "bypassPermissions");
  assert.ok(claude.permissions.deny.length >= 4);
  const codexConfig = files(outputs.codex).get("config.toml");
  assert.match(codexConfig, /sandbox_mode = "danger-full-access"/u);
  assert.match(codexConfig, /approval_policy = "never"/u);
  const codexEmergency = outputs.codex.registrations.find((entry) => entry.kind === "native-integration" && entry.feature === "emergency-protection");
  assert.ok(codexEmergency);
  assert.equal(codexEmergency.phases.rendered.status, "pass");
  assert.equal(codexEmergency.phases.trusted.status, "not-run");
  assert.ok(codexEmergency.manualSteps.some((step) => step.includes("command(rm -rf)") && step.includes("write_file(/home/user/.ssh)")));
  const desktopPermission = outputs["antigravity-2"].registrations.find((entry) => entry.kind === "permission-ui");
  assert.equal(desktopPermission.preset, "Custom");
  assert.equal(desktopPermission.accessIntent, "full");
  assert.equal(desktopPermission.turboMode, false);
  assert.ok(desktopPermission.deny.includes("command(rm -rf)"));
  const agy = JSON.parse(files(outputs.agy).get("settings.overlay.json"));
  assert.equal(agy.toolPermission, "always-proceed");
  assert.ok(agy.permissions.deny.includes("command(rm -rf)"));
  assert.ok(outputs.agy.registrations.some((entry) => entry.kind === "full-access-per-run" && entry.emergencyDeny.length >= 4));
});

test("both profiles render deterministically and match all eight checked-in snapshots", async () => {
  for (const [surface, render] of Object.entries(renderers)) {
    for (const profile of Object.values(profiles)) {
      const first = render(profile);
      const second = render(profile);
      assert.deepEqual(first, second, `${surface}/${profile.id} render drift`);
      const snapshot = await json(`tests/snapshots/${surface}/${profile.id}.json`);
      const snapshotPaths = snapshot.paths ?? snapshot.files?.map((file) => file.relativePath);
      assert.equal(snapshot.fileCount, first.files.length, `${surface}/${profile.id} snapshot count drift`);
      assert.deepEqual(snapshotPaths, first.files.map((file) => file.relativePath), `${surface}/${profile.id} snapshot path drift`);
    }
  }
});

test("adapter manifests declare exactly the portable model-policy evidence they support", async () => {
  for (const [surface, expectedRefs] of Object.entries(PROFILE_MODEL_POLICY_REFS)) {
    const manifest = await json(`installers/manifests/${surface}.json`);
    assert.equal(manifest.profileContract.source, "profiles/{profile}/profile.json");
    assert.deepEqual(manifest.profileContract.modelPolicyRefs, expectedRefs);
  }
});
