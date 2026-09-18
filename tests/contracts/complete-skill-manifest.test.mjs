import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import test from "node:test";

import { renderClaude } from "../../adapters/claude/adapter.mjs";
import { renderCodex } from "../../adapters/codex/adapter.mjs";
import { assertUnifiedSkillPortfolio, loadCore } from "../../installers/lib/load-core.mjs";

const requiredOutputs = [
  "tests/contracts/complete-skill-manifest.test.mjs",
  "tests/behavioral/skill-collisions.test.mjs",
  "tests/snapshots/claude/skills-manifest.json",
  "tests/snapshots/codex/skills-manifest.json"
];

test("T044 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) await access(resolve(process.cwd(), relativePath));
});

const surfaceSpecs = [
  { id: "claude", prefix: "skills", render: (core) => renderClaude({ core, profile: { id: "portable" }, statuslineName: "" }) },
  { id: "codex", prefix: ".agents/skills", render: (core) => renderCodex({ core, profile: { id: "portable" }, targetRuntime: "cli" }) }
];

function normalized(value) {
  return value.replace(/\r\n?/gu, "\n");
}

function relativeCompanion(owner, canonicalPath) {
  return posix.relative(`skills/${owner}`, canonicalPath);
}

async function canonicalCompanionText(canonicalPath) {
  const corePath = resolve(process.cwd(), "core", ...canonicalPath.split("/"));
  return normalized(await readFile(corePath, "utf8"));
}

function manifestProjection(core, result, prefix) {
  const paths = result.files
    .map((file) => file.relativePath)
    .filter((path) => core.inventory.skills.some((name) => path === `${prefix}/${name}/SKILL.md` || path.startsWith(`${prefix}/${name}/`)))
    .sort();
  return {
    companionCount: core.skills.reduce((count, record) => count + record.companions.length, 0),
    pathCount: paths.length,
    pathsSha256: createHash("sha256").update(`${paths.join("\n")}\n`).digest("hex"),
    skillCount: core.inventory.skills.length,
    skills: [...core.inventory.skills],
    uniquePathCount: new Set(paths).size
  };
}

test("canonical inventory and loaded core contain all 28 public names exactly once", async () => {
  const core = await loadCore(process.cwd());
  assert.equal(core.inventory.skills.length, 28);
  assert.equal(new Set(core.inventory.skills).size, 28);
  assert.equal(core.inventory.skillSources.length, 28);
  assert.equal(new Set(core.inventory.skillSources.map((entry) => entry.name)).size, 28);
  assert.deepEqual([...core.inventory.skillSources.map((entry) => entry.name)].sort(), [...core.inventory.skills].sort());
  assert.deepEqual([...core.skills.map((entry) => entry.id)].sort(), [...core.inventory.skills].sort());
});

test("loader exposes every declared companion as contained normalized UTF-8 content", async () => {
  const core = await loadCore(process.cwd());
  const records = new Map(core.skills.map((record) => [record.id, record]));
  for (const source of core.inventory.skillSources) {
    const companions = records.get(source.name).companions;
    const declared = [
      ...source.assets.map((canonicalPath) => ({ canonicalPath, kind: "asset", mode: null })),
      ...source.scripts.map((canonicalPath) => ({ canonicalPath, kind: "script", mode: 0o755 }))
    ].sort((left, right) => left.canonicalPath === right.canonicalPath ? 0 : left.canonicalPath < right.canonicalPath ? -1 : 1);
    assert.equal(companions.length, declared.length, source.name);
    for (const [index, expected] of declared.entries()) {
      const actual = companions[index];
      assert.equal(actual.canonicalPath, expected.canonicalPath);
      assert.equal(actual.relativePath, relativeCompanion(source.name, expected.canonicalPath));
      assert.equal(actual.kind, expected.kind);
      assert.equal(actual.mode, expected.mode);
      assert.equal(actual.content, await canonicalCompanionText(expected.canonicalPath));
    }
  }
});

test("both surfaces render every companion once beside its owning skill", async () => {
  const core = await loadCore(process.cwd());
  const records = new Map(core.skills.map((record) => [record.id, record]));
  for (const surface of surfaceSpecs) {
    const result = surface.render(core);
    const files = new Map(result.files.map((file) => [file.relativePath, file]));
    assert.equal(files.size, result.files.length, `${surface.id} duplicate output path`);
    for (const skill of core.inventory.skills) {
      assert.ok(files.has(`${surface.prefix}/${skill}/SKILL.md`), `${surface.id}:${skill}`);
      for (const companion of records.get(skill).companions) {
        const path = `${surface.prefix}/${skill}/${companion.relativePath}`;
        const rendered = files.get(path);
        assert.ok(rendered, `${surface.id}:${path}`);
        assert.equal(new TextDecoder("utf-8", { fatal: true }).decode(rendered.content), companion.content);
        assert.equal(rendered.mode, companion.mode, `${surface.id}:${path}:mode`);
      }
    }
    const expected = JSON.parse(await readFile(resolve(process.cwd(), `tests/snapshots/${surface.id}/skills-manifest.json`), "utf8"));
    assert.deepEqual(manifestProjection(core, result, surface.prefix), expected);
  }
});

test("all package manifests declare the rendered global file and complete skill roots", async () => {
  const expectedGlobal = new Map([
    ["claude", "CLAUDE.md"],
    ["codex", "AGENTS.md"]
  ]);
  for (const [surface, globalName] of expectedGlobal) {
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), `installers/manifests/${surface}.json`), "utf8"));
    const global = manifest.components.globalInstructions;
    assert.equal(typeof global === "string" ? global : global?.package, globalName);
    assert.ok(manifest.ownedPaths.includes(globalName), `${surface} manifest must own ${globalName}`);
    assert.equal(new Set(manifest.ownedPaths).size, manifest.ownedPaths.length, `${surface} manifest ownership must be unique`);
  }
});

test("pack selection is rejected at loader, adapter, and profile argument seams", async () => {
  for (const value of [
    { skillPack: "core" },
    { skillPacks: ["optional"] },
    { profile: { id: "portable", personalSkills: ["local"] } },
    { argv: ["--optional-skills"] }
  ]) assert.throws(() => assertUnifiedSkillPortfolio(value), /complete skill portfolio|pack selection/iu);
  await assert.rejects(loadCore(process.cwd(), { skillPack: "core" }), /complete skill portfolio|pack selection/iu);
  const core = await loadCore(process.cwd());
  for (const surface of surfaceSpecs) {
    const options = { core, profile: { id: "portable", skillPack: "core" }, statuslineName: "", targetRuntime: "cli" };
    assert.throws(() => surface.id === "claude" ? renderClaude(options) : renderCodex(options), /complete skill portfolio|pack selection/iu);
  }
});

async function fixtureInventory(skillSource) {
  const root = await mkdtemp(join(tmpdir(), "aaa-t044-companions-"));
  await mkdir(resolve(root, "core/skills/alpha"), { recursive: true });
  await writeFile(resolve(root, "core/inventory.json"), JSON.stringify({ skills: ["alpha"], skillSources: [skillSource] }));
  await writeFile(resolve(root, "core/skills/alpha/SKILL.md"), "---\nname: alpha\ndescription: Alpha.\n---\n\nAlpha.\n");
  return root;
}

test("loader rejects missing, escaping, and duplicate companion destinations", async () => {
  const cases = [
    { source: { name: "alpha", source: "skills/alpha/SKILL.md", assets: ["skills/alpha/missing.md"], scripts: [] }, keyword: "companionRead" },
    { source: { name: "alpha", source: "skills/alpha/SKILL.md", assets: ["../outside.md"], scripts: [] }, keyword: "companionContainment" },
    { source: { name: "alpha", source: "skills/alpha/SKILL.md", assets: ["skills/alpha/tool.js"], scripts: ["skills/alpha/tool.js"] }, keyword: "duplicateDestination", create: "tool.js" }
  ];
  for (const entry of cases) {
    const root = await fixtureInventory(entry.source);
    try {
      if (entry.create) await writeFile(resolve(root, "core/skills/alpha", entry.create), "content\n");
      await assert.rejects(loadCore(root), (error) => error.errors?.some((item) => item.keyword === entry.keyword));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  const invalidUtf8Root = await fixtureInventory({ name: "alpha", source: "skills/alpha/SKILL.md", assets: ["skills/alpha/invalid.txt"], scripts: [] });
  try {
    await writeFile(resolve(invalidUtf8Root, "core/skills/alpha/invalid.txt"), new Uint8Array([0xff, 0xfe]));
    await assert.rejects(loadCore(invalidUtf8Root), (error) => error.errors?.some((item) => item.keyword === "companionRead" && /UTF-8/iu.test(item.message)));
  } finally {
    await rm(invalidUtf8Root, { recursive: true, force: true });
  }
});

test("loader never falls back from canonical core companions to quarantined legacy sources", async () => {
  const root = await fixtureInventory({
    name: "alpha",
    source: "skills/alpha/SKILL.md",
    assets: ["skills/alpha/legacy-only.md"],
    scripts: []
  });
  try {
    await mkdir(resolve(root, "skills/alpha"), { recursive: true });
    await writeFile(resolve(root, "skills/alpha/legacy-only.md"), "legacy fallback must remain inactive\n", "utf8");
    await assert.rejects(
      loadCore(root),
      (error) => error.errors?.some((item) => item.keyword === "companionRead" && /legacy-only\.md/u.test(item.sourcePath))
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
