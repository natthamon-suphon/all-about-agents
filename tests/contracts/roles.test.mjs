import assert from "node:assert/strict";
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
import { renderClaude } from "../../adapters/claude/adapter.mjs";
import { parseCodexToml, renderCodex } from "../../adapters/codex/adapter.mjs";
import { renderAntigravity } from "../../adapters/antigravity-2/adapter.mjs";
import { renderAgy } from "../../adapters/agy/adapter.mjs";

const ROLE_IDS = [
  "researcher",
  "investigator",
  "architect",
  "implementer",
  "verifier",
  "reviewer",
  "security-reviewer"
];

const ROLE_ROOT = resolve(process.cwd(), "core/roles");

async function mutateRole(root, roleId, mutate) {
  const path = resolve(root, "core/roles", roleId, "role.json");
  const role = JSON.parse(await readFile(path, "utf8"));
  mutate(role);
  await writeFile(path, `${JSON.stringify(role, null, 2)}\n`, "utf8");
}

test("T012 creates one metadata and prompt artifact for every canonical role", async () => {
  for (const roleId of ROLE_IDS) {
    await access(resolve(ROLE_ROOT, roleId, "role.json"));
    await access(resolve(ROLE_ROOT, roleId, "prompt.md"));
  }
});

test("canonical roles load with distinct prompts and explicit evidence contracts", async () => {
  const core = await loadCore(process.cwd());
  const roles = new Map(core.roles.map((role) => [role.id, role]));
  assert.deepEqual([...roles.keys()], [...ROLE_IDS].sort());
  assert.equal(new Set(core.roles.map((role) => role.id)).size, ROLE_IDS.length);
  assert.equal(new Set(core.roles.map((role) => role.prompt)).size, ROLE_IDS.length);
  for (const roleId of ROLE_IDS) {
    const role = roles.get(roleId);
    assert.ok(role.prompt?.trim(), `${roleId} must have a prompt body`);
    assert.ok(role.outputContract?.evidence, `${roleId} must declare output evidence`);
    assert.ok(role.evidenceContract?.required?.length > 0, `${roleId} must declare required evidence`);
    assert.equal(roleId === "implementer", role.mutationScope !== "none");
    if (roleId !== "implementer") {
      assert.equal(role.mutationScope, "none");
      assert.equal(role.capabilities.some((capability) => /(?:write|command-execution)/u.test(capability)), false);
    }
  }
});

function textFiles(result) {
  return new Map(result.files.map((file) => [file.relativePath, new TextDecoder().decode(file.content)]));
}

function roleFilePath(surface, roleId) {
  return surface === "claude"
    ? `agents/${roleId}.md`
    : surface === "codex"
      ? `.codex/agents/${roleId}.toml`
      : surface === "antigravity-2"
        ? `.agents/plugins/all-about-agents/agents/${roleId}.md`
        : `agents/${roleId}/agent.md`;
}

function mutableArtifact(surface, content) {
  if (surface === "claude") {
    const tools = content.match(/^tools:\n([\s\S]*?)(?:^disallowedTools:|^---$)/mu)?.[1] || "";
    return /(?:^|\n)[ \t]*- (?:Bash|Write|Edit)\b/u.test(tools);
  }
  if (surface === "antigravity-2") return /(?:write_to_file|replace_file_content|run_command|multi_replace_file_content)/u.test(content);
  if (surface === "agy") return /(?:write_to_file|replace_file_content|run_command|multi_replace_file_content|commandExecutionPolicy: (?!off))/u.test(content);
  return /sandbox_mode\s*=\s*"(?:workspace-write|danger-full-access)"/u.test(content);
}

function attemptArtifactWrite(surface, content, writeTrap) {
  if (!mutableArtifact(surface, content)) return;
  writeTrap.writeFile(`${surface}/artifact`, "artifact-exposed-write");
}

function cloneCoreWithRole(core, roleId, mutate) {
  return {
    ...core,
    roles: core.roles.map((role) => role.id === roleId ? mutate(structuredClone(role)) : role)
  };
}

test("rendered role artifacts drive the write trap, including a negative mutable-artifact control", async () => {
  const core = await loadCore(process.cwd());
  const writeTrap = {
    calls: [],
    writeFile(path, operation) {
      this.calls.push({ path, operation });
      throw new Error("write-trapped");
    }
  };
  const renders = [
    ["claude", renderClaude({ core, profile: "portable", statuslineName: "roles", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["codex", renderCodex({ core, profile: "portable", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["antigravity-2", renderAntigravity({ core, profile: "portable", statuslineName: "roles" })],
    ["agy", renderAgy({ core, profile: "portable", statuslineName: "roles", platform: "win32" })]
  ];
  for (const [surface, result] of renders) {
    const files = textFiles(result);
    for (const roleId of ROLE_IDS.filter((id) => id !== "implementer")) {
      const artifact = surface === "codex"
        ? `${files.get(roleFilePath(surface, roleId))}\n${files.get(`.codex/agents/${roleId}.config.toml`)}`
        : files.get(roleFilePath(surface, roleId));
      assert.doesNotThrow(() => attemptArtifactWrite(surface, artifact, writeTrap), `${surface}/${roleId}`);
    }
    const implementerArtifact = surface === "codex"
      ? `${files.get(roleFilePath(surface, "implementer"))}\n${files.get(".codex/agents/implementer.config.toml")}`
      : files.get(roleFilePath(surface, "implementer"));
    assert.throws(() => attemptArtifactWrite(surface, implementerArtifact, writeTrap), /write-trapped/u, `${surface}/implementer`);
  }
  assert.equal(writeTrap.calls.length, renders.length, "only implementer artifacts should reach the write seam");
  const negativeTrap = { calls: [], writeFile(path, operation) { this.calls.push({ path, operation }); throw new Error("write-trapped"); } };
  assert.throws(() => attemptArtifactWrite("claude", "---\ntools:\n- Write\n---\n", negativeTrap), /write-trapped/u);
  assert.equal(negativeTrap.calls.length, 1, "negative control must prove the trap is live");
});

test("role loading rejects a broad implementer scope", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-scope-"));
  try {
    await cp(resolve(process.cwd(), "core"), resolve(root, "core"), { recursive: true });
    await mutateRole(root, "implementer", (role) => { role.mutationScope = "full"; });
    await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "mutationScope"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("role loading rejects an uncontained implementer path", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-path-"));
  try {
    await cp(resolve(process.cwd(), "core"), resolve(root, "core"), { recursive: true });
    await mutateRole(root, "implementer", (role) => { role.mutationScope.paths = ["**"]; });
    await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "mutationScope"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("canonical core rejects a missing role instead of silently opting it out", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-missing-"));
  try {
    await cp(resolve(process.cwd(), "core"), resolve(root, "core"), { recursive: true });
    await rm(resolve(root, "core/roles/reviewer"), { recursive: true, force: true });
    await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "canonicalRole"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("canonical core rejects every unknown role record, including quarantined and arbitrary ids", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-unknown-"));
  try {
    await cp(resolve(process.cwd(), "core"), resolve(root, "core"), { recursive: true });
    const source = await readFile(resolve(root, "core/roles/reviewer/role.json"), "utf8");
    const role = JSON.parse(source);
    await mkdir(resolve(root, "core/roles/generalist"), { recursive: true });
    await writeFile(resolve(root, "core/roles/generalist/role.json"), `${JSON.stringify({ ...role, id: "generalist" }, null, 2)}\n`, "utf8");
    await writeFile(resolve(root, "core/roles/generalist/prompt.md"), "## Evidence contract\nlegacy\n", "utf8");
    await mkdir(resolve(root, "core/roles/evil"), { recursive: true });
    await writeFile(resolve(root, "core/roles/evil/role.json"), `${JSON.stringify({ ...role, id: "evil" }, null, 2)}\n`, "utf8");
    await writeFile(resolve(root, "core/roles/evil/prompt.md"), "## Evidence contract\nunknown\n", "utf8");
    await assert.rejects(loadCore(root), (error) => {
      const errors = error.errors.filter((entry) => entry.keyword === "canonicalRole");
      return errors.some((entry) => /generalist/u.test(entry.message)) && errors.some((entry) => /evil/u.test(entry.message));
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("canonical core rejects duplicate canonical role records deterministically", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-duplicate-"));
  try {
    await cp(resolve(process.cwd(), "core"), resolve(root, "core"), { recursive: true });
    const source = await readFile(resolve(root, "core/roles/reviewer/role.json"), "utf8");
    await mkdir(resolve(root, "core/roles/reviewer-copy"), { recursive: true });
    await writeFile(resolve(root, "core/roles/reviewer-copy/role.json"), source, "utf8");
    await writeFile(resolve(root, "core/roles/reviewer-copy/prompt.md"), await readFile(resolve(root, "core/roles/reviewer/prompt.md"), "utf8"), "utf8");
    await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "duplicateId" && /duplicate id reviewer/u.test(entry.message)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("implementer must declare an allowed write capability as well as a constrained scope", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-implementer-capability-"));
  try {
    await cp(resolve(process.cwd(), "core"), resolve(root, "core"), { recursive: true });
    await mutateRole(root, "implementer", (role) => { role.capabilities = ["repository-read"]; });
    await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "semanticCapability" || entry.keyword === "mutationScope"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("role loading rejects vendor-native mutable instructions in an actual read-only prompt", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-prompt-safety-"));
  try {
    await cp(resolve(process.cwd(), "core"), resolve(root, "core"), { recursive: true });
    await writeFile(resolve(root, "core/roles/investigator/prompt.md"), "## Evidence contract\nUse Bash to inspect the repository.\n", "utf8");
    await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "promptSafety"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("read-only prompt validation covers Claude and Antigravity mutable token forms", async () => {
  for (const [index, prompt] of [
    "Use bash to inspect the repository.\n## Evidence contract\nreport only.\n",
    "Claude Edit and Write tools are forbidden here.\n## Evidence contract\nreport only.\n",
    "Do not call write_to_file or replace_file_content.\n## Evidence contract\nreport only.\n",
    "Do not call run_command or manage_subagents.\n## Evidence contract\nreport only.\n"
  ].entries()) {
    const root = await mkdtemp(resolve(tmpdir(), `aaa-t012-roles-prompt-native-${index}-`));
    try {
      await cp(resolve(process.cwd(), "core"), resolve(root, "core"), { recursive: true });
      await writeFile(resolve(root, "core/roles/investigator/prompt.md"), prompt, "utf8");
      await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "promptSafety"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("implementer mutation scope rejects traversal, absolute, and Windows paths", async () => {
  const paths = ["../outside", "/tmp/outside", "C:\\outside", "workspace\\..\\outside"];
  for (const path of paths) {
    const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-containment-"));
    try {
      await cp(resolve(process.cwd(), "core"), resolve(root, "core"), { recursive: true });
      await mutateRole(root, "implementer", (role) => { role.mutationScope.paths = [path]; });
      await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "mutationScope"), path);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("implementer mutation scope rejects a symlink that escapes the repository root", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-symlink-"));
  const outside = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-outside-"));
  const link = resolve(root, "workspace/link");
  try {
    await cp(resolve(process.cwd(), "core"), resolve(root, "core"), { recursive: true });
    await mkdir(resolve(root, "workspace"), { recursive: true });
    try {
      await symlink(outside, link, "junction");
    } catch (error) {
      assert.match(String(error?.message || error), /(?:privilege|operation|symlink|not supported|access)/iu, "symlink setup failure must be explicit");
      return;
    }
    await mutateRole(root, "implementer", (role) => { role.mutationScope.paths = ["workspace/link/**"]; });
    await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "mutationScopeContainment"));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("role loading rejects write capabilities on a read-only role", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-capability-"));
  try {
    await cp(resolve(process.cwd(), "core"), resolve(root, "core"), { recursive: true });
    await mutateRole(root, "investigator", (role) => { role.capabilities = ["repository-read", "repository-write"]; });
    await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "mutationScope"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("role loading rejects vendor or unknown capability names", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-vendor-capability-"));
  try {
    await cp(resolve(process.cwd(), "core"), resolve(root, "core"), { recursive: true });
    await mutateRole(root, "researcher", (role) => { role.capabilities = ["repository-read", "vendor-web-search"]; });
    await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "semanticCapability"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("role loading rejects duplicate prompt bodies", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-prompt-"));
  try {
    await cp(resolve(process.cwd(), "core"), resolve(root, "core"), { recursive: true });
    const source = await readFile(resolve(root, "core/roles/architect/prompt.md"), "utf8");
    await writeFile(resolve(root, "core/roles/reviewer/prompt.md"), source, "utf8");
    await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "promptDivergence"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy generalist is quarantined from canonical role routing", async () => {
  const routing = JSON.parse(await readFile(resolve(process.cwd(), "tests/behavioral/roles/routing.json"), "utf8"));
  assert.ok(routing.quarantinedLegacyRoles.includes("generalist"));
  assert.equal(routing.quarantinedLegacyRoles.includes("implementer"), false);
  assert.ok(routing.scenarios.filter((scenario) => scenario.critical === true).length >= 5);
  for (const scenario of routing.scenarios.filter((entry) => entry.critical === true)) {
    assert.equal(scenario.cases.length, 5);
    assert.equal(scenario.cases.filter((entry) => entry.expectedRole).length, 5);
  }
  const edgeCases = routing.scenarios.find((scenario) => scenario.id === "routing-edge-cases");
  assert.ok(edgeCases.cases.some((entry) => entry.expectedStatus === "ambiguous"));
  assert.ok(edgeCases.cases.some((entry) => entry.expectedStatus === "no-route" && entry.expectedRole === null));
});

test("native mutation policy is derived from implementer metadata rather than a role-name default", async () => {
  const core = await loadCore(process.cwd());
  const minimalImplementer = cloneCoreWithRole(core, "implementer", (role) => ({
    ...role,
    capabilities: ["repository-read", "repository-write"],
    mutationScope: { paths: ["workspace/docs/**"], operations: ["modify"] }
  }));
  const claude = textFiles(renderClaude({ core: minimalImplementer, profile: "portable", statuslineName: "roles", env: {}, homeDir: "C:/Users/tester", platform: "win32" })).get("agents/implementer.md");
  const antigravity = textFiles(renderAntigravity({ core: minimalImplementer, profile: "portable", statuslineName: "roles" })).get(".agents/plugins/all-about-agents/agents/implementer.md");
  assert.match(claude, /(?:^|\n)\s+- (?:Write|Edit)\b/u);
  assert.doesNotMatch(claude, /(?:^|\n)\s+- Bash\b/u);
  assert.match(antigravity, /(?:write_to_file|replace_file_content)/u);
  assert.doesNotMatch(antigravity, /(?:run_command|invoke_subagent)/u);
});

test("Codex registers every role with a role-specific effective sandbox config", async () => {
  const { parseCodexToml } = await import("../../adapters/codex/adapter.mjs");
  const core = await loadCore(process.cwd());
  for (const profile of ["portable", "template"]) {
    const result = renderCodex({ core, profile, env: {}, homeDir: "C:/Users/tester", platform: "win32" });
    const files = textFiles(result);
    const delivery = result.registrations.find((entry) => entry.kind === "agents" && entry.rootEnv === "CODEX_HOME" && entry.destination === "agents");
    assert.ok(delivery, "Codex must declare the CODEX_HOME agents delivery mapping");
    const config = parseCodexToml(files.get("config.toml"));
    assert.deepEqual(Object.keys(config.agents).sort(), [...ROLE_IDS].sort());
    const alternateConfig = parseCodexToml(files.get("terra-max.config.toml"));
    assert.deepEqual(Object.keys(alternateConfig.agents).sort(), [...ROLE_IDS].sort());
    for (const roleId of ROLE_IDS) {
      const registration = config.agents[roleId];
      assert.equal(typeof registration.config_file, "string");
      assert.ok(registration.config_file.startsWith(`${delivery.destination}/`), registration.config_file);
      const packageRoleConfigPath = `${delivery.relativeDirectory}/${registration.config_file.slice(delivery.destination.length + 1)}`;
      assert.ok(files.has(packageRoleConfigPath), packageRoleConfigPath);
      const roleConfig = parseCodexToml(files.get(packageRoleConfigPath));
      assert.equal(roleConfig.sandbox_mode, roleId === "implementer" ? "workspace-write" : "read-only");
      assert.notEqual(roleConfig.sandbox_mode, "danger-full-access");
      const alternateRegistration = alternateConfig.agents[roleId];
      assert.equal(alternateRegistration.config_file, registration.config_file);
      const alternateRoleConfig = parseCodexToml(files.get(`${delivery.relativeDirectory}/${alternateRegistration.config_file.slice(delivery.destination.length + 1)}`));
      assert.equal(alternateRoleConfig.sandbox_mode, roleId === "implementer" ? "workspace-write" : "read-only");
      assert.notEqual(alternateRoleConfig.sandbox_mode, "danger-full-access");
    }
  }
});

test("renderers fail closed for an unknown role instead of making it editable", async () => {
  const role = { id: "evil", description: "unknown", prompt: "## Evidence contract\nunknown", capabilities: ["repository-write"], mutationScope: { paths: ["workspace/**"], operations: ["modify"] } };
  const base = await loadCore(process.cwd());
  const core = { ...base, roles: [role] };
  const renders = [
    ["claude", () => renderClaude({ core, profile: "portable", statuslineName: "roles", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["codex", () => renderCodex({ core, profile: "portable", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["antigravity-2", () => renderAntigravity({ core, profile: "portable", statuslineName: "roles" })],
    ["agy", () => renderAgy({ core, profile: "portable", statuslineName: "roles", platform: "win32" })]
  ];
  for (const [surface, render] of renders) assert.throws(render, (error) => error.name === "CanonicalRoleContractError" && error.errors.some((entry) => entry.code === "canonical-role"), surface);
});

test("all renderers reject an incomplete canonical role collection deterministically", async () => {
  const base = await loadCore(process.cwd());
  const core = { ...base, roles: [base.roles[0]] };
  const renderers = [
    ["claude", () => renderClaude({ core, profile: "portable", statuslineName: "roles", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["codex", () => renderCodex({ core, profile: "portable", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["antigravity-2", () => renderAntigravity({ core, profile: "portable", statuslineName: "roles" })],
    ["agy", () => renderAgy({ core, profile: "portable", statuslineName: "roles", platform: "win32" })]
  ];
  const expectedMissing = ROLE_IDS.filter((roleId) => roleId !== base.roles[0].id).sort();
  for (const [surface, render] of renderers) {
    assert.throws(render, (error) => {
      if (error.name !== "CanonicalRoleContractError") return false;
      const missing = error.errors
        .filter((entry) => entry.code === "canonical-role" && entry.message.startsWith("missing canonical role "))
        .map((entry) => entry.message.replace("missing canonical role ", ""));
      return JSON.stringify(missing) === JSON.stringify(expectedMissing);
    }, surface);
  }
});

test("all renderers reject forged canonical mutation semantics at the native boundary", async () => {
  const base = await loadCore(process.cwd());
  const forgedResearcher = cloneCoreWithRole(base, "researcher", (role) => ({
    ...role,
    mutationScope: { paths: ["workspace/docs/**"], operations: ["modify"] },
    capabilities: [...role.capabilities, "repository-write"]
  }));
  const nonWritingImplementer = cloneCoreWithRole(base, "implementer", (role) => ({
    ...role,
    capabilities: role.capabilities.filter((capability) => !["repository-write", "isolated-write", "command-execution"].includes(capability))
  }));
  const malformedImplementer = cloneCoreWithRole(base, "implementer", (role) => ({
    ...role,
    mutationScope: { paths: ["../outside"], operations: ["modify"] }
  }));
  const cases = [
    ["forged researcher", forgedResearcher, "mutation-scope"],
    ["non-writing implementer", nonWritingImplementer, "semantic-capability"],
    ["malformed implementer", malformedImplementer, "mutation-scope"]
  ];
  const renderers = [
    ["claude", (core) => renderClaude({ core, profile: "portable", statuslineName: "roles", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["codex", (core) => renderCodex({ core, profile: "portable", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["antigravity-2", (core) => renderAntigravity({ core, profile: "portable", statuslineName: "roles" })],
    ["agy", (core) => renderAgy({ core, profile: "portable", statuslineName: "roles", platform: "win32" })]
  ];
  for (const [caseName, core, code] of cases) {
    for (const [surface, render] of renderers) {
      assert.throws(() => render(core), (error) => error.name === "CanonicalRoleContractError" && error.errors.some((entry) => entry.code === code), `${surface}/${caseName}`);
    }
  }
});

test("all native surfaces consume canonical role semantics with read-only safety", async () => {
  const core = await loadCore(process.cwd());
  const renders = [
    ["claude", renderClaude({ core, profile: "portable", statuslineName: "roles", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["codex", renderCodex({ core, profile: "portable", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["antigravity-2", renderAntigravity({ core, profile: "portable", statuslineName: "roles" })],
    ["agy", renderAgy({ core, profile: "portable", statuslineName: "roles", platform: "win32" })]
  ];
  for (const [surface, result] of renders) {
    const files = textFiles(result);
    for (const roleId of ROLE_IDS) {
      const path = surface === "claude"
        ? `agents/${roleId}.md`
        : surface === "codex"
          ? `.codex/agents/${roleId}.toml`
          : surface === "antigravity-2"
            ? `.agents/plugins/all-about-agents/agents/${roleId}.md`
            : `agents/${roleId}/agent.md`;
      assert.ok(files.has(path), `${surface} missing ${roleId}`);
      const content = files.get(path);
      if (surface === "codex") assert.equal(parseCodexToml(content).name, roleId);
      else assert.match(content, new RegExp(`name: [\"']?${roleId}[\"']?`, "u"));
      if (surface === "claude") assert.doesNotMatch(content, /(?:sandbox_mode|commandExecutionPolicy|write_to_file)/u);
      if (surface === "antigravity-2" || surface === "agy") assert.doesNotMatch(content, /(?:disallowedTools|sandbox_mode)/u);
      if (surface === "codex") assert.doesNotMatch(content, /(?:commandExecutionPolicy|write_to_file|replace_file_content)/u);
      if (roleId !== "implementer") {
        const toolDeclaration = surface === "claude"
          ? content.match(/^tools:\n([\s\S]*?)(?:^disallowedTools:|^---$)/mu)?.[1] || ""
          : content.match(/^(?:tools:|developer_instructions\s*=)[\s\S]*?(?:^---$|\n\n|$)/mu)?.[0] || content;
        assert.doesNotMatch(toolDeclaration, /(?:run_command|write_to_file|replace_file_content|multi_replace_file_content|(?:^|\s)(?:Bash|Write|Edit)(?:\s|$))/u, `${surface}/${roleId} exposes a mutation or command tool`);
        if (surface === "antigravity-2" || surface === "agy") assert.match(content, /^commandExecutionPolicy: off$/mu);
      }
    }
    const implementer = files.get(surface === "claude" ? "agents/implementer.md" : surface === "codex" ? ".codex/agents/implementer.toml" : surface === "antigravity-2" ? ".agents/plugins/all-about-agents/agents/implementer.md" : "agents/implementer/agent.md");
    assert.match(implementer, /approved|scoped|workspace/u, `${surface} lost implementer scope semantics`);
  }
});
