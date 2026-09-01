import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { join } from "node:path";
import test from "node:test";

import { validateSkillArtifacts } from "../../installers/lib/validate-skill.mjs";

const requiredOutputs = [
  "installers/lib/load-core.mjs",
  "core/schemas/rule.schema.json",
  "core/schemas/role.schema.json",
  "core/schemas/workflow.schema.json",
  "core/schemas/command.schema.json",
  "core/schemas/skill.schema.json",
  "core/schemas/presentation.schema.json",
  "core/presentation/emoji-registry.json",
  "core/presentation/progress-contract.json",
  "installers/lib/presentation-contract.mjs",
  "tests/contracts/presentation-contract.test.mjs",
  "tests/contracts/core-loader.test.mjs",
  "tests/fixtures/core/valid/",
  "tests/fixtures/core/broken-reference/",
  "tests/fixtures/core/duplicate-id/",
  "tests/fixtures/core/unknown-field/"
];

test("T003 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) {
    await access(resolve(process.cwd(), relativePath));
  }
});

const fixture = (name) => resolve(process.cwd(), "tests/fixtures/core", name);

async function loader() {
  return import("../../installers/lib/load-core.mjs");
}

test("loadCore returns deterministic sorted collections from a valid core", async () => {
  const { loadCore } = await loader();
  const first = await loadCore(fixture("valid"));
  const second = await loadCore(fixture("valid"));
  assert.deepEqual(first, second);
  assert.deepEqual(first.globalInstructions, {
    sourcePath: "core/instructions/global-operating-rules.md",
    content: "# Fixture global operating rules\n\nUse the validated fixture core.\n"
  });
  assert.equal(first.presentation.emojiRegistry.schemaVersion, 1);
  assert.equal(Object.keys(first.presentation.emojiRegistry.skills).length, 2);
  assert.equal(Object.keys(first.presentation.emojiRegistry.roles).length, 1);
  assert.equal(Object.keys(first.presentation.emojiRegistry.commands).length, 2);
  assert.equal(first.presentation.progressContract.maxItems, 7);
  assert.deepEqual(first.rules.map((record) => record.id), ["a-rule", "z-rule"]);
  assert.deepEqual(first.roles.map((record) => record.id), ["reviewer"]);
  assert.deepEqual(first.skills.map((record) => record.id), ["alpha", "beta"]);
  assert.deepEqual(first.workflows.map((record) => record.id), ["a-flow", "z-flow"]);
  assert.deepEqual(first.commands.map((record) => record.id), ["a-command", "z-command"]);
  assert.deepEqual(first.evals.map((record) => record.id), ["a-eval", "z-eval"]);
});

test("loadCore reports invalid UTF-8 in the canonical global instructions", async () => {
  const root = await mkdtemp(join(tmpdir(), "aaa-t001-global-encoding-"));
  try {
    await cp(fixture("valid"), root, { recursive: true });
    await mkdir(resolve(root, "core/instructions"), { recursive: true });
    await writeFile(resolve(root, "core/instructions/global-operating-rules.md"), Buffer.from([0xc3, 0x28]));
    const { loadCore } = await loader();
    await assert.rejects(loadCore(root), (error) => {
      assert.ok(error.errors.some((entry) =>
        entry.sourcePath === "core/instructions/global-operating-rules.md" &&
        entry.keyword === "invalid-global-instructions"
      ));
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadCore preserves and rejects a UTF-8 BOM in the canonical global instructions", async () => {
  const root = await mkdtemp(join(tmpdir(), "aaa-t001-global-bom-"));
  try {
    await cp(fixture("valid"), root, { recursive: true });
    await mkdir(resolve(root, "core/instructions"), { recursive: true });
    await writeFile(resolve(root, "core/instructions/global-operating-rules.md"), "\uFEFF# Fixture global operating rules\n\nUse the validated fixture core.\n", "utf8");
    const { loadCore } = await loader();
    await assert.rejects(loadCore(root), (error) => {
      assert.ok(error.errors.some((entry) =>
        entry.sourcePath === "core/instructions/global-operating-rules.md" &&
        entry.keyword === "global-instructions-bom"
      ));
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadCore rejects symlinked canonical presentation files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aaa-t010-presentation-symlink-"));
  const outside = await mkdtemp(join(tmpdir(), "aaa-t010-presentation-outside-"));
  try {
    await cp(fixture("valid"), root, { recursive: true });
    for (const name of ["emoji-registry.json", "progress-contract.json"]) {
      const canonicalPath = resolve(root, "core/presentation", name);
      const outsidePath = resolve(outside, name);
      await cp(canonicalPath, outsidePath);
      await unlink(canonicalPath);
      try {
        await symlink(outsidePath, canonicalPath, "file");
      } catch (error) {
        t.skip(`file symlink creation unavailable: ${error.code}`);
        return;
      }
      const { loadCore } = await loader();
      await assert.rejects(loadCore(root), (error) => {
        assert.ok(error.errors.some((entry) =>
          entry.sourcePath === `core/presentation/${name}` && entry.keyword === "presentationContainment"
        ));
        return true;
      });
      await unlink(canonicalPath);
      await cp(outsidePath, canonicalPath);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("loadCore rejects canonical presentation files under an escaping parent junction", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aaa-t010-presentation-junction-"));
  const outside = await mkdtemp(join(tmpdir(), "aaa-t010-presentation-junction-outside-"));
  try {
    await cp(fixture("valid"), root, { recursive: true });
    const presentationPath = resolve(root, "core/presentation");
    const outsidePresentationPath = resolve(outside, "presentation");
    await cp(presentationPath, outsidePresentationPath, { recursive: true });
    await rm(presentationPath, { recursive: true, force: true });
    try {
      await symlink(outsidePresentationPath, presentationPath, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      t.skip(`directory junction creation unavailable: ${error.code}`);
      return;
    }
    const { loadCore } = await loader();
    await assert.rejects(loadCore(root), (error) => {
      assert.ok(error.errors.some((entry) =>
        entry.sourcePath === "core/presentation/emoji-registry.json" && entry.keyword === "presentationContainment"
      ));
      assert.ok(error.errors.some((entry) =>
        entry.sourcePath === "core/presentation/progress-contract.json" && entry.keyword === "presentationContainment"
      ));
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("loadCore rejects canonical presentation files under a contained parent link", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aaa-t010-presentation-contained-link-"));
  try {
    await cp(fixture("valid"), root, { recursive: true });
    const presentationPath = resolve(root, "core/presentation");
    const containedTarget = resolve(root, "core/contained-presentation");
    await cp(presentationPath, containedTarget, { recursive: true });
    await rm(presentationPath, { recursive: true, force: true });
    try {
      await symlink(containedTarget, presentationPath, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      t.skip(`directory link creation unavailable: ${error.code}`);
      return;
    }
    const { loadCore } = await loader();
    await assert.rejects(loadCore(root), (error) => {
      for (const name of ["emoji-registry.json", "progress-contract.json"]) {
        assert.ok(error.errors.some((entry) => entry.sourcePath === `core/presentation/${name}` && entry.keyword === "presentationContainment"));
      }
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadCore rejects a linked canonical core root even when its target stays in the repository", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aaa-t010-core-contained-link-"));
  try {
    await cp(fixture("valid"), root, { recursive: true });
    const corePath = resolve(root, "core");
    const containedTarget = resolve(root, "contained-core");
    await cp(corePath, containedTarget, { recursive: true });
    await rm(corePath, { recursive: true, force: true });
    try {
      await symlink(containedTarget, corePath, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      t.skip(`core link creation unavailable: ${error.code}`);
      return;
    }
    const { loadCore } = await loader();
    await assert.rejects(loadCore(root), (error) => {
      assert.ok(error.errors.some((entry) => ["global-instructions-containment", "presentationContainment"].includes(entry.keyword)));
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadCore reports missing references with the source path and JSON pointer", async () => {
  const { loadCore } = await loader();
  await assert.rejects(loadCore(fixture("broken-reference")), (error) => {
    assert.equal(error.name, "CoreLoadError");
    assert.ok(error.errors.some((entry) =>
      entry.sourcePath === "core/rules/broken.json" &&
      entry.jsonPointer === "/skills/0" &&
      entry.keyword === "reference"
    ));
    assert.match(error.message, /core\/rules\/broken\.json#\/skills\/0/u);
    return true;
  });
});

test("loadCore rejects duplicate IDs in one collection", async () => {
  const { loadCore } = await loader();
  await assert.rejects(loadCore(fixture("duplicate-id")), (error) => {
    assert.ok(error.errors.some((entry) =>
      entry.sourcePath === "core/rules/second.json" &&
      entry.jsonPointer === "/id" &&
      entry.keyword === "duplicateId"
    ));
    return true;
  });
});

test("loadCore rejects unknown fields and vendor tool names in portable metadata", async () => {
  const { loadCore } = await loader();
  await assert.rejects(loadCore(fixture("unknown-field")), (error) => {
    assert.ok(error.errors.some((entry) =>
      entry.sourcePath === "core/rules/unknown.json" &&
      entry.jsonPointer === "/unexpected" &&
      entry.keyword === "additionalProperties"
    ));
    assert.ok(error.errors.some((entry) =>
      entry.sourcePath === "core/rules/unknown.json" &&
      entry.jsonPointer === "/capabilities/0" &&
      entry.keyword === "semanticCapability"
    ));
    assert.ok(error.errors.some((entry) =>
      entry.sourcePath === "core/rules/unknown.json" &&
      entry.jsonPointer === "/capabilities/0" &&
      entry.keyword === "vendorTool"
    ));
    assert.ok(error.errors.some((entry) =>
      entry.sourcePath === "core/skills/alpha/SKILL.md" &&
      entry.jsonPointer === "/frontmatter/capabilities" &&
      entry.keyword === "frontmatterType"
    ));
    assert.ok(error.errors.some((entry) =>
      entry.sourcePath === "core/commands/unknown-command.json" &&
      entry.jsonPointer === "/arguments/operation" &&
      entry.keyword === "vendorTool"
    ));
    for (const [index, name] of ["MultiEdit", "Agent", "Skill", "TodoWrite", "PowerShell"].entries()) {
      assert.ok(error.errors.some((entry) =>
        entry.sourcePath === "core/commands/native-names.json" &&
        entry.jsonPointer === `/arguments/nested/${index}` &&
        entry.keyword === "vendorTool"
      ), `nested vendor tool ${name} was not rejected`);
    }
    return true;
  });
});

test("core schemas are strict and expose the five canonical record contracts", async () => {
  const { validateSchema } = await import("../../installers/lib/validate-schema.mjs");
  for (const kind of ["rule", "role", "workflow", "command", "skill"]) {
    const schema = JSON.parse(await readFile(resolve(process.cwd(), `core/schemas/${kind}.schema.json`), "utf8"));
    assert.equal(schema.additionalProperties, false, `${kind} schema must be strict`);
    const invalid = { id: "example", unexpected: true };
    const result = validateSchema({ schema, value: invalid, sourcePath: `core/${kind}.json` });
    assert.equal(result.valid, false, `${kind} schema must reject unknown fields`);
    assert.ok(result.errors.some((entry) => entry.jsonPointer === "/unexpected"));
  }
});

test("validate accepts the exact core scope and rejects incomplete skill scope", async () => {
  const { main } = await import("../../scripts/aaa.mjs");
  const output = { write() {} };
  const errors = { write() {} };
  assert.equal(await main(["validate", "--scope", "core"], output, errors), 0);
  assert.equal(await main(["validate", "--scope", "skill"], output, errors), 2);
  assert.equal(await main(["validate", "--scope", "other"], output, errors), 2);
});

test("skill validation requires the exact skill to be listed in inventory.skills", async () => {
  const { loadCore } = await loader();
  const core = await loadCore(process.cwd());
  const skillId = "using-all-about-agents";
  const withoutMembership = {
    ...core,
    inventory: {
      ...core.inventory,
      skills: core.inventory.skills.filter((name) => name !== skillId)
    }
  };
  const result = await validateSkillArtifacts({ repositoryRoot: process.cwd(), core: withoutMembership, skillId });
  assert.equal(result.valid, false);
  const membership = result.errors.find((entry) => entry.code === "missing-inventory-record" && entry.path === "core/inventory.json");
  assert.ok(membership, "missing inventory.skills membership needs a stable code and source path");
  assert.match(membership.message, /matching skills and skillSources record/u);
});

test("loadCore validates inventory against its strict schema when the schema is present", async () => {
  const root = await mkdtemp(join(tmpdir(), "aaa-t003-inventory-schema-"));
  try {
    await mkdir(resolve(root, "core/schemas"), { recursive: true });
    const schema = await readFile(resolve(process.cwd(), "core/schemas/inventory.schema.json"), "utf8");
    await writeFile(resolve(root, "core/schemas/inventory.schema.json"), schema);
    await writeFile(resolve(root, "core/inventory.json"), JSON.stringify({ schemaVersion: 1, skills: [], unexpected: true }));
    const { loadCore } = await loader();
    await assert.rejects(loadCore(root), (error) => {
      assert.ok(error.errors.some((entry) => entry.sourcePath === "core/inventory.json" && entry.jsonPointer === "/unexpected" && entry.keyword === "additionalProperties"));
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unified skill portfolio rejects every pack-selection argument shape", async () => {
  const { assertUnifiedSkillPortfolio } = await loader();
  for (const options of [
    { skillPack: "core" },
    { skillPacks: ["optional"] },
    { profile: { id: "portable", personalSkills: ["local"] } },
    { argv: ["--skills=research"] }
  ]) assert.throws(() => assertUnifiedSkillPortfolio(options), /complete skill portfolio/iu);
  assert.doesNotThrow(() => assertUnifiedSkillPortfolio({ profile: { id: "portable" }, argv: ["--surface", "claude"] }));
});
