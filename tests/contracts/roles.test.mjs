import assert from "node:assert/strict";
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { loadCore, resolveWorkspaceScopePath, VENDOR_NATIVE_TOOL_NAMES } from "../../installers/lib/load-core.mjs";
import { CLAUDE_SEMANTIC_MAPPINGS, renderClaude } from "../../adapters/claude/adapter.mjs";
import { parseCodexToml, renderCodex } from "../../adapters/codex/adapter.mjs";
import { ANTIGRAVITY_SEMANTIC_MAPPINGS, renderAntigravity } from "../../adapters/antigravity-2/adapter.mjs";
import { AGY_SEMANTIC_MAPPINGS, renderAgy } from "../../adapters/agy/adapter.mjs";
import { CANONICAL_ROLE_CAPABILITIES } from "../../core/roles/contract.mjs";

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
const EMITTED_NATIVE_TOOL_VOCABULARY = Object.freeze({
  claude: new Set(Object.values(CLAUDE_SEMANTIC_MAPPINGS).flat()),
  codex: new Set(["read-only", "workspace-write", "danger-full-access"]),
  "antigravity-2": new Set(Object.values(ANTIGRAVITY_SEMANTIC_MAPPINGS).flat()),
  agy: new Set(Object.values(AGY_SEMANTIC_MAPPINGS).flat())
});

async function mutateRole(root, roleId, mutate) {
  const path = resolve(root, "core/roles", roleId, "role.json");
  const role = JSON.parse(await readFile(path, "utf8"));
  mutate(role);
  await writeFile(path, `${JSON.stringify(role, null, 2)}\n`, "utf8");
}

async function copyCoreFixture(root) {
  await cp(resolve(process.cwd(), "core"), resolve(root, "core"), { recursive: true });
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

test("canonical role capability allowlists stay aligned with role metadata", async () => {
  const core = await loadCore(process.cwd());
  for (const role of core.roles) {
    assert.deepEqual([...role.capabilities].sort(), [...CANONICAL_ROLE_CAPABILITIES[role.id]].sort(), role.id);
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

function parseNativeArtifact(surface, content) {
  if (surface === "claude") {
    const tools = content.match(/^tools:\n([\s\S]*?)(?:^disallowedTools:|^---$)/mu)?.[1] || "";
    const parsedTools = [...tools.matchAll(/(?:^|\n)[ \t]*- ([A-Za-z][A-Za-z0-9]*)\b/gu)].map((match) => match[1]);
    return { tools: parsedTools, writeTools: parsedTools.filter((tool) => ["Bash", "Write", "Edit"].includes(tool)), dispatchTools: parsedTools.filter((tool) => tool === "Agent") };
  }
  if (surface === "antigravity-2" || surface === "agy") {
    const toolsLine = content.match(/^tools:\s*\[(.*?)\]$/mu)?.[1] || "";
    const tools = [...toolsLine.matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
    const commandExecution = /^commandExecutionPolicy:\s*(\w+)$/mu.exec(content)?.[1] || "off";
    return { tools, writeTools: tools.filter((tool) => ["write_to_file", "replace_file_content", "multi_replace_file_content"].includes(tool)), dispatchTools: tools.filter((tool) => ["invoke_subagent", "define_subagent", "manage_subagents"].includes(tool)), commandExecution };
  }
  const parsed = parseCodexToml(content);
  return { tools: parsed.sandbox_mode ? [parsed.sandbox_mode] : [], writeTools: parsed.sandbox_mode === "workspace-write" || parsed.sandbox_mode === "danger-full-access" ? [parsed.sandbox_mode] : [], dispatchTools: [] };
}

function executeNativeArtifact(surface, content, writeTrap) {
  const artifact = parseNativeArtifact(surface, content);
  if (artifact.writeTools.length > 0) writeTrap.writeFile(`${surface}/artifact`, "artifact-exposed-write");
  if (artifact.dispatchTools.length > 0) writeTrap.invokeSubagent(`${surface}/dispatch`, "artifact-exposed-dispatch");
  return artifact;
}

function cloneCoreWithRole(core, roleId, mutate) {
  return {
    ...core,
    roles: core.roles.map((role) => role.id === roleId ? mutate(structuredClone(role)) : role)
  };
}

test("rendered role artifacts drive the write trap, including a negative mutable-artifact control", async () => {
  const core = await loadCore(process.cwd());
  const renders = [
    ["claude", renderClaude({ core, profile: "portable", statuslineName: "roles", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["codex", renderCodex({ core, profile: "portable", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["antigravity-2", renderAntigravity({ core, profile: "portable", statuslineName: "roles" })],
    ["agy", renderAgy({ core, profile: "portable", statuslineName: "roles", platform: "win32" })]
  ];
  const temp = await mkdtemp(resolve(tmpdir(), "aaa-t012-artifact-executor-"));
  const writeTrap = {
    calls: [],
    writeFile(path, operation) {
      const target = resolve(temp, `${path.replaceAll("/", "-")}.txt`);
      writeFileSync(target, operation, "utf8");
      this.calls.push({ path, operation, target });
      throw new Error("write-trapped");
    },
    invokeSubagent(path, operation) {
      this.calls.push({ path, operation });
      throw new Error("dispatch-trapped");
    }
  };
  try {
  for (const [surface, result] of renders) {
    const files = textFiles(result);
    for (const roleId of ROLE_IDS.filter((id) => id !== "implementer")) {
      const artifact = files.get(roleFilePath(surface, roleId));
      let parsedArtifact;
      assert.doesNotThrow(() => { parsedArtifact = executeNativeArtifact(surface, artifact, writeTrap); }, `${surface}/${roleId}`);
      assert.ok(parsedArtifact.tools.every((tool) => EMITTED_NATIVE_TOOL_VOCABULARY[surface].has(tool)), `${surface}/${roleId} emitted an undeclared native tool`);
    }
    const implementerArtifact = files.get(roleFilePath(surface, "implementer"));
    const parsedImplementer = parseNativeArtifact(surface, implementerArtifact);
    assert.throws(() => executeNativeArtifact(surface, implementerArtifact, writeTrap), /write-trapped/u, `${surface}/implementer`);
    assert.ok(parsedImplementer.tools.every((tool) => EMITTED_NATIVE_TOOL_VOCABULARY[surface].has(tool)), `${surface}/implementer emitted an undeclared native tool`);
  }
  assert.equal(writeTrap.calls.length, renders.length, "every documented implementer write artifact should reach the write seam");
  assert.ok(await access(writeTrap.calls[0].target).then(() => true).catch(() => false), "artifact executor must attempt a real temporary filesystem write");
  const negativeTrap = { calls: [], writeFile(path, operation) { this.calls.push({ path, operation }); throw new Error("write-trapped"); }, invokeSubagent(path, operation) { this.calls.push({ path, operation }); throw new Error("dispatch-trapped"); } };
  assert.throws(() => executeNativeArtifact("claude", "---\ntools:\n  - Write\n---\n", negativeTrap), /write-trapped/u);
  assert.throws(() => executeNativeArtifact("antigravity-2", "---\ntools: [\"invoke_subagent\"]\n---\n", negativeTrap), /dispatch-trapped/u);
  assert.equal(negativeTrap.calls.length, 2, "negative controls must prove write and dispatch traps are live");
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("role loading rejects a broad implementer scope", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-scope-"));
  try {
    await copyCoreFixture(root);
    await mutateRole(root, "implementer", (role) => { role.mutationScope = "full"; });
    await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "mutationScope"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("role loading rejects an uncontained implementer path", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-path-"));
  try {
    await copyCoreFixture(root);
    await mutateRole(root, "implementer", (role) => { role.mutationScope.paths = ["**"]; });
    await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "mutationScope"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("canonical core rejects a missing role instead of silently opting it out", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-missing-"));
  try {
    await copyCoreFixture(root);
    await rm(resolve(root, "core/roles/reviewer"), { recursive: true, force: true });
    await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "canonicalRole"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("canonical core rejects every unknown role record, including quarantined and arbitrary ids", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-unknown-"));
  try {
    await copyCoreFixture(root);
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
    await copyCoreFixture(root);
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
    await copyCoreFixture(root);
    await mutateRole(root, "implementer", (role) => { role.capabilities = ["repository-read"]; });
    await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "semanticCapability" || entry.keyword === "mutationScope"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("role loading rejects vendor-native mutable instructions in an actual read-only prompt", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-prompt-safety-"));
  try {
    await copyCoreFixture(root);
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
    "Do not call run_command or manage_subagents.\n## Evidence contract\nreport only.\n",
    "Use Glob to inspect the repository.\n## Evidence contract\nreport only.\n",
    "Use Grep to inspect the repository.\n## Evidence contract\nreport only.\n",
    "Use WebFetch to retrieve the source.\n## Evidence contract\nreport only.\n",
    "Use Task to delegate the work.\n## Evidence contract\nreport only.\n",
    "Use MultiEdit to change the files.\n## Evidence contract\nreport only.\n"
  ].entries()) {
    const root = await mkdtemp(resolve(tmpdir(), `aaa-t012-roles-prompt-native-${index}-`));
    try {
      await copyCoreFixture(root);
      await writeFile(resolve(root, "core/roles/investigator/prompt.md"), prompt, "utf8");
      await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "promptSafety"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("portable prompt validation catches native command forms but permits generic implementation prose", async () => {
  for (const [index, prompt] of [
    "Run Bash to edit the repository.\n## Evidence contract\nreport only.\n",
    "Invoke Edit and then use PowerShell to save the result.\n## Evidence contract\nreport only.\n",
    "Use Git Bash to run the mutation command.\n## Evidence contract\nreport only.\n",
    "Invoke Subagent to perform the task.\n## Evidence contract\nreport only.\n"
  ].entries()) {
    const root = await mkdtemp(resolve(tmpdir(), `aaa-t012-roles-prompt-casing-${index}-`));
    try {
      await copyCoreFixture(root);
      await writeFile(resolve(root, "core/roles/investigator/prompt.md"), prompt, "utf8");
      await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "promptSafety"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-prompt-generic-"));
  try {
    await copyCoreFixture(root);
    await writeFile(resolve(root, "core/roles/implementer/prompt.md"), "Write a failing test, then write the smallest scoped change.\n## Evidence contract\nreport only.\n", "utf8");
    const core = await loadCore(root);
    assert.match(core.roles.find((role) => role.id === "implementer").prompt, /failing test/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("role loading rejects an external prompt symlink before reading its body", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-prompt-link-"));
  const outside = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-prompt-link-outside-"));
  try {
    await copyCoreFixture(root);
    const external = resolve(outside, "prompt.md");
    await writeFile(external, "## Evidence contract\nexternal body must not load.\n", "utf8");
    const prompt = resolve(root, "core/roles/investigator/prompt.md");
    await rm(prompt);
    try {
      await symlink(external, prompt, "file");
    } catch (error) {
      assert.match(String(error?.message || error), /(?:privilege|operation|symlink|not supported|access)/iu, "symlink setup failure must be explicit");
      return;
    }
    await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "promptContainment"));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("implementer mutation scope rejects traversal, absolute, and Windows paths", async () => {
  const paths = ["../outside", "/tmp/outside", "C:\\outside", "workspace\\..\\outside"];
  for (const path of paths) {
    const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-containment-"));
    try {
      await copyCoreFixture(root);
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
  const link = resolve(root, "link");
  try {
    await copyCoreFixture(root);
    await mkdir(resolve(root), { recursive: true });
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

test("workspace containment maps the virtual root and rejects cross-volume Windows paths", async () => {
  assert.equal(resolveWorkspaceScopePath({ repositoryRoot: "C:\\repo", scopePath: "workspace" }), "C:\\repo");
  assert.equal(resolveWorkspaceScopePath({ repositoryRoot: "C:\\repo", scopePath: "workspace/docs/**" }), "C:\\repo\\docs");
  for (const scopePath of ["../outside", "/tmp/outside", "C:\\outside", "D:\\other\\outside", "workspace\\..\\outside", "workspace/C:\\outside", "workspace/docs?:/**", "workspace//docs/**", "workspace/docs/**/later", "workspace/./docs/**"]) {
    assert.throws(() => resolveWorkspaceScopePath({ repositoryRoot: "C:\\repo", scopePath }), /outside|absolute|containment|workspace|traversal/u, scopePath);
  }
});

test("implementer descendant containment rejects an escaping symlink below a glob", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-descendant-link-"));
  const outside = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-descendant-outside-"));
  const link = resolve(root, "docs/link");
  try {
    await copyCoreFixture(root);
    await mkdir(resolve(root, "docs"), { recursive: true });
    try {
      await symlink(outside, link, "junction");
    } catch (error) {
      assert.match(String(error?.message || error), /(?:privilege|operation|symlink|not supported|access)/iu, "symlink setup failure must be explicit");
      return;
    }
    await mutateRole(root, "implementer", (role) => { role.mutationScope.paths = ["workspace/**"]; });
    await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "mutationScopeContainment"));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("workspace root scope scans descendants for escaping symlinks", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-root-scope-"));
  const outside = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-root-scope-outside-"));
  const link = resolve(root, "escape");
  try {
    await copyCoreFixture(root);
    try {
      await symlink(outside, link, "junction");
    } catch (error) {
      assert.match(String(error?.message || error), /(?:privilege|operation|symlink|not supported|access)/iu, "symlink setup failure must be explicit");
      return;
    }
    await mutateRole(root, "implementer", (role) => { role.mutationScope.paths = ["workspace"]; });
    await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "mutationScopeContainment"));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("role loading rejects write capabilities on a read-only role", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-capability-"));
  try {
    await copyCoreFixture(root);
    await mutateRole(root, "investigator", (role) => { role.capabilities = ["repository-read", "repository-write"]; });
    await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "mutationScope"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("role loading rejects privileged dispatch capability on every specialized role", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-dispatch-capability-"));
  try {
    await copyCoreFixture(root);
    await mutateRole(root, "researcher", (role) => { role.capabilities = [...role.capabilities, "role-dispatch"]; });
    await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "privilegedCapability"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("role loading rejects vendor or unknown capability names", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-vendor-capability-"));
  try {
    await copyCoreFixture(root);
    await mutateRole(root, "researcher", (role) => { role.capabilities = ["repository-read", "vendor-web-search"]; });
    await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "semanticCapability"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("role loading rejects duplicate prompt bodies", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-prompt-"));
  try {
    await copyCoreFixture(root);
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
    mutationScope: { paths: ["workspace/docs/**"], operations: ["modify"] }
  }));
  const claude = textFiles(renderClaude({ core: minimalImplementer, profile: "portable", statuslineName: "roles", env: {}, homeDir: "C:/Users/tester", platform: "win32" })).get("agents/implementer.md");
  const antigravity = textFiles(renderAntigravity({ core: minimalImplementer, profile: "portable", statuslineName: "roles" })).get(".agents/plugins/all-about-agents/agents/implementer.md");
  assert.match(claude, /(?:^|\n)\s+- (?:Write|Edit)\b/u);
  assert.match(claude, /(?:^|\n)\s+- Bash\b/u);
  assert.match(antigravity, /(?:write_to_file|replace_file_content)/u);
  assert.match(antigravity, /(?:^|\n)tools: \[[^\]]*run_command/u);
  assert.doesNotMatch(antigravity, /(?:invoke_subagent)/u);
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
    const alternateConfigText = files.get("terra-max.config.toml");
    assert.equal(typeof alternateConfigText === "string", profile === "template");
    const alternateConfig = alternateConfigText === undefined ? null : parseCodexToml(alternateConfigText);
    if (alternateConfig !== null) assert.deepEqual(Object.keys(alternateConfig.agents).sort(), [...ROLE_IDS].sort());
    for (const roleId of ROLE_IDS) {
      const registration = config.agents[roleId];
      assert.equal(typeof registration.config_file, "string");
      assert.equal(registration.config_file, `${delivery.destination}/${roleId}.toml`);
      assert.ok(registration.config_file.startsWith(`${delivery.destination}/`), registration.config_file);
      const packageRoleConfigPath = `${delivery.relativeDirectory}/${registration.config_file.slice(delivery.destination.length + 1)}`;
      assert.ok(files.has(packageRoleConfigPath), packageRoleConfigPath);
      const roleConfig = parseCodexToml(files.get(packageRoleConfigPath));
      assert.equal(roleConfig.name, roleId);
      assert.equal(typeof roleConfig.developer_instructions, "string");
      assert.equal(roleConfig.sandbox_mode, roleId === "implementer" ? "workspace-write" : "read-only");
      assert.notEqual(roleConfig.sandbox_mode, "danger-full-access");
      assert.equal(files.has(`${delivery.relativeDirectory}/${roleId}.config.toml`), false);
      if (alternateConfig !== null) {
        const alternateRegistration = alternateConfig.agents[roleId];
        assert.equal(alternateRegistration.config_file, registration.config_file);
        const alternateRoleConfig = parseCodexToml(files.get(`${delivery.relativeDirectory}/${alternateRegistration.config_file.slice(delivery.destination.length + 1)}`));
        assert.equal(alternateRoleConfig.name, roleId);
        assert.equal(typeof alternateRoleConfig.developer_instructions, "string");
        assert.equal(alternateRoleConfig.sandbox_mode, roleId === "implementer" ? "workspace-write" : "read-only");
        assert.notEqual(alternateRoleConfig.sandbox_mode, "danger-full-access");
      }
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
    mutationScope: { paths: ["workspace/\u0000"], operations: ["modify"] }
  }));
  const forgedDispatcher = cloneCoreWithRole(base, "researcher", (role) => ({
    ...role,
    capabilities: [...role.capabilities, "role-dispatch"]
  }));
  const unknownCapability = cloneCoreWithRole(base, "researcher", (role) => ({
    ...role,
    capabilities: [...role.capabilities, "vendor-native-edit"]
  }));
  const extraValidCapability = cloneCoreWithRole(base, "researcher", (role) => ({
    ...role,
    capabilities: [...role.capabilities, "native-rendering"]
  }));
  const cases = [
    ["forged researcher", forgedResearcher, "mutation-scope"],
    ["non-writing implementer", nonWritingImplementer, "semantic-capability"],
    ["malformed implementer", malformedImplementer, "mutation-scope"],
    ["forged read-only dispatcher", forgedDispatcher, "privileged-capability"],
    ["unknown semantic capability", unknownCapability, "semantic-capability"],
    ["extra valid role capability", extraValidCapability, "role-capability"]
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

test("all renderers reject malformed canonical prompt and evidence contracts before artifact creation", async () => {
  const base = await loadCore(process.cwd());
  const malformed = cloneCoreWithRole(base, "reviewer", (role) => ({
    ...role,
    prompt: "",
    evidenceContract: { required: [], format: "", limitations: [] },
    outputContract: {}
  }));
  const renderers = [
    ["claude", (core) => renderClaude({ core, profile: "portable", statuslineName: "roles", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["codex", (core) => renderCodex({ core, profile: "portable", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["antigravity-2", (core) => renderAntigravity({ core, profile: "portable", statuslineName: "roles" })],
    ["agy", (core) => renderAgy({ core, profile: "portable", statuslineName: "roles", platform: "win32" })]
  ];
  for (const [surface, render] of renderers) {
    assert.throws(() => render(malformed), (error) => error.name === "CanonicalRoleContractError" && error.errors.some((entry) => ["prompt", "evidence-contract", "output-contract"].includes(entry.code)), surface);
  }
});

test("native boundary rejects malformed prompt documents and explicit native tool invocations", async () => {
  const base = await loadCore(process.cwd());
  const renderers = [
    ["claude", (core) => renderClaude({ core, profile: "portable", statuslineName: "roles", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["codex", (core) => renderCodex({ core, profile: "portable", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["antigravity-2", (core) => renderAntigravity({ core, profile: "portable", statuslineName: "roles" })],
    ["agy", (core) => renderAgy({ core, profile: "portable", statuslineName: "roles", platform: "win32" })]
  ];
  for (const prompt of [
    "---\nname: reviewer\n---\n## Evidence contract\nreport only.\n",
    "## Evidence contract\ninvalid\u0000body\n",
    "Use the Read tool to inspect the repository.\n## Evidence contract\nreport only.\n",
    "Invoke WebSearch to locate the source.\n## Evidence contract\nreport only.\n",
    "Call `view_file` for the requested path.\n## Evidence contract\nreport only.\n",
    "Run shell command to inspect the repository.\n## Evidence contract\nreport only.\n",
    "Invoke Skill to perform the workflow.\n## Evidence contract\nreport only.\n",
    "Use Glob to inspect the repository.\n## Evidence contract\nreport only.\n",
    "Use Grep to inspect the repository.\n## Evidence contract\nreport only.\n",
    "Use WebFetch to retrieve the source.\n## Evidence contract\nreport only.\n",
    "Use Task to delegate the work.\n## Evidence contract\nreport only.\n",
    "Use MultiEdit to change the files.\n## Evidence contract\nreport only.\n",
    ...VENDOR_NATIVE_TOOL_NAMES.map((tool) => `Use ${tool} to perform a native action.\n## Evidence contract\nreport only.\n`),
    "Use mcp__vendor_tool to perform a native action.\n## Evidence contract\nreport only.\n"
  ]) {
    const forged = cloneCoreWithRole(base, "reviewer", (role) => ({ ...role, prompt }));
    for (const [surface, render] of renderers) {
      assert.throws(() => render(forged), (error) => error.name === "CanonicalRoleContractError" && error.errors.some((entry) => ["prompt-format", "prompt-safety"].includes(entry.code)), `${surface}/${prompt}`);
    }
  }
  const normalProse = cloneCoreWithRole(base, "reviewer", (role) => ({
    ...role,
    prompt: "Read the evidence, use skill guidance, and report the shell command output.\n## Evidence contract\nreport only.\n"
  }));
  for (const [surface, render] of renderers) assert.doesNotThrow(() => render(normalProse), `${surface}/normal-prose`);
});

test("canonical loader rejects empty evidence fields before native rendering", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-evidence-loader-"));
  try {
    await copyCoreFixture(root);
    await mutateRole(root, "reviewer", (role) => {
      role.outputContract.evidence = "";
    });
    await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "evidenceContract"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("canonical loader rejects a valid capability outside a role allowlist", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "aaa-t012-roles-capability-allowlist-"));
  try {
    await copyCoreFixture(root);
    await mutateRole(root, "researcher", (role) => { role.capabilities.push("native-rendering"); });
    await assert.rejects(loadCore(root), (error) => error.errors.some((entry) => entry.keyword === "roleCapability"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("all renderers reject a forged vendor-native prompt before artifact creation", async () => {
  const base = await loadCore(process.cwd());
  const forgedPrompt = cloneCoreWithRole(base, "reviewer", (role) => ({
    ...role,
    prompt: "Use PowerShell to inspect the repository.\n\n## Evidence contract\nReport evidence only.\n"
  }));
  const renderers = [
    ["claude", (core) => renderClaude({ core, profile: "portable", statuslineName: "roles", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["codex", (core) => renderCodex({ core, profile: "portable", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["antigravity-2", (core) => renderAntigravity({ core, profile: "portable", statuslineName: "roles" })],
    ["agy", (core) => renderAgy({ core, profile: "portable", statuslineName: "roles", platform: "win32" })]
  ];
  for (const [surface, render] of renderers) {
    assert.throws(() => render(forgedPrompt), (error) => error.name === "CanonicalRoleContractError" && error.errors.some((entry) => entry.code === "prompt-safety"), surface);
  }
});

test("all renderers reject canonical roles missing portable input and routing contracts", async () => {
  const base = await loadCore(process.cwd());
  const malformed = cloneCoreWithRole(base, "reviewer", (role) => {
    const copy = { ...role };
    delete copy.inputContract;
    delete copy.routingKeywords;
    return copy;
  });
  const renderers = [
    ["claude", (core) => renderClaude({ core, profile: "portable", statuslineName: "roles", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["codex", (core) => renderCodex({ core, profile: "portable", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["antigravity-2", (core) => renderAntigravity({ core, profile: "portable", statuslineName: "roles" })],
    ["agy", (core) => renderAgy({ core, profile: "portable", statuslineName: "roles", platform: "win32" })]
  ];
  for (const [surface, render] of renderers) {
    assert.throws(() => render(malformed), (error) => error.name === "CanonicalRoleContractError" && error.errors.some((entry) => ["input-contract", "routing-keywords"].includes(entry.code)), surface);
  }
});

test("native adapters disclose only narrower implementer scopes instead of claiming path enforcement", async () => {
  const core = await loadCore(process.cwd());
  const canonicalRenders = [
    ["claude", renderClaude({ core, profile: "portable", statuslineName: "roles", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["codex", renderCodex({ core, profile: "portable", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["antigravity-2", renderAntigravity({ core, profile: "portable", statuslineName: "roles" })],
    ["agy", renderAgy({ core, profile: "portable", statuslineName: "roles", platform: "win32" })]
  ];
  for (const [surface, result] of canonicalRenders) {
    assert.equal(result.diagnostics.some((entry) => entry.code === "native-scope-not-enforced"), false, `${surface} must not warn when native workspace scope matches workspace/**`);
    const canonicalImplementer = textFiles(result).get(roleFilePath(surface, "implementer"));
    assert.doesNotMatch(canonicalImplementer, /declared task paths remain an outer approval boundary/u, `${surface} must not add narrower-scope guidance to workspace/**`);
  }
  const narrowedCore = cloneCoreWithRole(core, "implementer", (role) => ({
    ...role,
    mutationScope: { paths: ["workspace/docs/**"], operations: ["modify"] }
  }));
  const narrowedRenders = [
    ["claude", renderClaude({ core: narrowedCore, profile: "portable", statuslineName: "roles", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["codex", renderCodex({ core: narrowedCore, profile: "portable", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["antigravity-2", renderAntigravity({ core: narrowedCore, profile: "portable", statuslineName: "roles" })],
    ["agy", renderAgy({ core: narrowedCore, profile: "portable", statuslineName: "roles", platform: "win32" })]
  ];
  for (const [surface, result] of narrowedRenders) {
    const warning = result.diagnostics.find((entry) => entry.code === "native-scope-not-enforced");
    assert.ok(warning, `${surface} must expose a scope-boundary diagnostic`);
    assert.match(warning.message, /workspace-wide|outer approval boundary/iu);
    assert.match(warning.message, /implementer/iu);
    assert.match(textFiles(result).get(roleFilePath(surface, "implementer")), /declared task paths remain an outer approval boundary/u, `${surface} must add narrower-scope guidance`);
  }
});

test("native adapters report every suppressed or undocumented role capability", async () => {
  const core = await loadCore(process.cwd());
  const renders = [
    ["claude", renderClaude({ core, profile: "portable", statuslineName: "roles", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["codex", renderCodex({ core, profile: "portable", env: {}, homeDir: "C:/Users/tester", platform: "win32" })],
    ["antigravity-2", renderAntigravity({ core, profile: "portable", statuslineName: "roles" })],
    ["agy", renderAgy({ core, profile: "portable", statuslineName: "roles", platform: "win32" })]
  ];
  for (const [surface, result] of renders) {
    const diagnostics = result.diagnostics.filter((entry) => entry.code === "role-capability-unavailable");
    if (surface === "codex") {
      assert.equal(diagnostics.length, 0, "Codex read-only sandbox retains its documented shell capability");
      continue;
    }
    assert.ok(diagnostics.some((entry) => /Role verifier capability test-execution is unavailable/iu.test(entry.message)), `${surface} verifier test-execution omission must be explicit`);
    assert.ok(diagnostics.some((entry) => /Role verifier capability evaluation is unavailable/iu.test(entry.message)), `${surface} verifier evaluation omission must be explicit`);
    assert.ok(diagnostics.every((entry) => /manual|fail-closed/iu.test(entry.message)), `${surface} diagnostics need manual/fail-closed guidance`);
    assert.ok(diagnostics.every((entry) => /^core\/roles\/[a-z0-9-]+\/role\.json$/u.test(entry.sourcePath)), `${surface} diagnostics need an owning role source`);
    if (surface === "agy") {
      const implementer = core.roles.find((role) => role.id === "implementer");
      const artifact = parseNativeArtifact(surface, textFiles(result).get(roleFilePath(surface, "implementer")));
      for (const capability of implementer.capabilities) {
        const mappedTools = AGY_SEMANTIC_MAPPINGS[capability] ?? [];
        assert.ok(mappedTools.length > 0, `agy implementer capability ${capability} needs a documented mapping or diagnostic`);
        assert.ok(mappedTools.some((tool) => artifact.tools.includes(tool)), `agy implementer capability ${capability} is silently omitted`);
      }
      assert.equal(diagnostics.some((entry) => /Role implementer capability repository-write is unavailable/iu.test(entry.message)), false, "agy must not call a documented write mapping unavailable");
    }
    const verifierPath = surface === "claude"
      ? "agents/verifier.md"
      : surface === "antigravity-2"
        ? ".agents/plugins/all-about-agents/agents/verifier.md"
        : "agents/verifier/agent.md";
    assert.match(new TextDecoder().decode(result.files.find((file) => file.relativePath === verifierPath).content), /Role verifier capability test-execution is unavailable/iu, `${surface} verifier guidance must disclose the suppressed capability`);
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
        assert.doesNotMatch(toolDeclaration, /(?:run_command|write_to_file|replace_file_content|multi_replace_file_content|invoke_subagent|define_subagent|manage_subagents|(?:^|\s)(?:Agent|Bash|Write|Edit)(?:\s|$))/u, `${surface}/${roleId} exposes a mutation, command, or dispatch tool`);
        if (surface === "antigravity-2" || surface === "agy") assert.match(content, /^commandExecutionPolicy: off$/mu);
      }
    }
    const implementer = files.get(surface === "claude" ? "agents/implementer.md" : surface === "codex" ? ".codex/agents/implementer.toml" : surface === "antigravity-2" ? ".agents/plugins/all-about-agents/agents/implementer.md" : "agents/implementer/agent.md");
    assert.match(implementer, /approved|scoped|workspace/u, `${surface} lost implementer scope semantics`);
  }
});
