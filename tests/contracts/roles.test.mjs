import assert from "node:assert/strict";
import { access, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
import { renderClaude } from "../../adapters/claude/adapter.mjs";
import { renderCodex } from "../../adapters/codex/adapter.mjs";
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

function executeRoleFixture(role, fileSystem) {
  const writeCapabilities = new Set(["repository-write", "filesystem-write", "git-write", "isolated-write"]);
  if (!role.capabilities.some((capability) => writeCapabilities.has(capability))) return;
  const scope = role.mutationScope && typeof role.mutationScope === "object" ? role.mutationScope : {};
  fileSystem.writeFile(scope.paths?.[0] || "**", scope.operations?.[0] || "modify");
}

test("read-only role fixtures run against a write-trapping filesystem seam", async () => {
  const core = await loadCore(process.cwd());
  const roles = new Map(core.roles.map((role) => [role.id, role]));
  const writeTrap = {
    calls: [],
    writeFile(path, operation) {
      this.calls.push({ path, operation });
      throw new Error("write-trapped");
    }
  };
  for (const roleId of ROLE_IDS.filter((id) => id !== "implementer")) {
    assert.doesNotThrow(() => executeRoleFixture(roles.get(roleId), writeTrap), roleId);
  }
  assert.equal(writeTrap.calls.length, 0, "read-only roles must never reach the write seam");
  assert.throws(() => executeRoleFixture(roles.get("implementer"), writeTrap), /write-trapped/u);
  assert.deepEqual(writeTrap.calls, [{ path: "workspace/**", operation: "create" }]);
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
  assert.equal(routing.scenarios.length, 4);
  for (const scenario of routing.scenarios) {
    assert.equal(scenario.cases.length, 5);
    assert.equal(scenario.cases.filter((entry) => entry.expectedRole).length, 5);
  }
});

function textFiles(result) {
  return new Map(result.files.map((file) => [file.relativePath, new TextDecoder().decode(file.content)]));
}

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
