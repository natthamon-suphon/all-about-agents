import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { renderForSurface } from "../../installers/lib/render.mjs";
import { loadCore } from "../../installers/lib/load-core.mjs";

const root = process.cwd();

const requiredOutputs = [
  "README.md",
  "docs/setup/windows.md",
  "docs/setup/macos.md",
  "docs/compatibility/claude.md",
  "docs/compatibility/codex.md",
"docs/compatibility/antigravity-2.md",
"docs/compatibility/agy.md",
"docs/evaluations/native-windows-2026-08-31.md",
"docs/limitations/known-limitations.md",
  "quarantine/README.md",
  "tests/static/documentation.test.mjs"
];

const documentationFiles = ["README.md", ...requiredOutputs.filter((path) => path.startsWith("docs/") || path === "quarantine/README.md")];

const legacyRoots = ["agents", "configs", "hooks", "setup", "statusline", "skills", ".claude-plugin"];
const canonicalPrefixes = [
  "core/",
  "adapters/",
  "installers/",
  "profiles/",
  "scripts/",
  "tests/",
  "docs/",
  "quarantine/",
  "README.md",
  "AGENTS.md",
  "CLAUDE.md",
  "LICENSE",
  "package.json",
  ".gitignore",
  ".gitattributes",
  ".pre-commit-config.yaml",
  ".idea/"
];
const coreRelativePrefixes = ["skills/", "roles/", "rules/", "workflows/", "commands/", "hooks/", "evals/"];

const surfaces = [
  { id: "claude", options: { env: { CLAUDE_CONFIG_DIR: "C:/disposable/claude" } } },
  { id: "codex", options: { env: { CODEX_HOME: "C:/disposable/codex" }, targetRuntime: "cli" } },
  { id: "antigravity-2", options: {} },
  { id: "agy", options: {} }
];

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function textAt(relativePath) {
  const bytes = await readFile(resolve(root, relativePath));
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert.equal(text.includes("\uFFFD"), false, `${relativePath} contains a replacement character`);
  return text;
}

async function exists(relativePath) {
  try {
    await access(resolve(root, relativePath));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
}

function localMarkdownTargets(text) {
  const targets = [];
  const inline = /!?\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+["'][^)]*["'])?\)/gu;
  for (const match of text.matchAll(inline)) targets.push(match[1] ?? match[2]);
  const references = /^\s{0,3}\[[^\]]+\]:\s*(?:<([^>]+)>|(\S+))/gmu;
  for (const match of text.matchAll(references)) targets.push(match[1] ?? match[2]);
  return targets.filter((target) => {
    const value = target.trim();
    return value !== "" && !value.startsWith("#") && !value.startsWith("//") && !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value);
  });
}

function pathFromMarkdownLink(sourcePath, target) {
  const withoutFragment = target.split(/[?#]/u, 1)[0];
  const decoded = decodeURIComponent(withoutFragment);
  assert.equal(decoded.includes("\\"), false, `${sourcePath} uses a backslash in internal Markdown link ${target}`);
  return resolve(resolve(root, sourcePath, ".."), decoded);
}

function inventoryPaths(inventory) {
  return [
    ...inventory.sourceFiles.map((entry) => [entry.path, "sourceFiles"]),
    ...inventory.skillSources.flatMap((entry) => [
      [entry.source, "skillSources.source"],
      ...entry.assets.map((path) => [path, "skillSources.assets"]),
      ...entry.scripts.map((path) => [path, "skillSources.scripts"])
    ]),
    ...inventory.legacyRoles.flatMap((entry) => entry.files.map((path) => [path, "legacyRoles.files"])),
    ...inventory.hooks.map((entry) => [entry.path, "hooks"]),
    ...inventory.configs.map((entry) => [entry.path, "configs"]),
    ...inventory.statusline.map((entry) => [entry.path, "statusline"]),
    ...inventory.setupScripts.map((entry) => [entry.path, "setupScripts"])
  ];
}

function isCanonicalInventoryPath(path) {
  return canonicalPrefixes.some((prefix) => path === prefix || path.startsWith(prefix)) || coreRelativePrefixes.some((prefix) => path.startsWith(prefix));
}

function snapshotOwnership(snapshot) {
  if (Array.isArray(snapshot.ownership)) return snapshot.ownership;
  return Object.entries(snapshot.ownershipHashes ?? snapshot.contentHashes ?? {}).map(([relativePath, sha256]) => ({ relativePath, sha256 }));
}

test("T051 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) await access(resolve(root, relativePath));
});

test("documentation is strict UTF-8, replacement-free, link-complete, and secret-free", async () => {
  const secretPatterns = [
    /\b(?:sk|pk|ghp|github_pat|xox[baprs]|AKIA)[_-][A-Za-z0-9]{8,}\b/u,
    /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/iu,
    /\b(?:api[_ -]?key|access[_ -]?token|secret|password)\s*[:=]\s*["'`][^"'`\r\n]{6,}["'`]/iu
  ];
  for (const relativePath of documentationFiles) {
    const text = await textAt(relativePath);
    for (const pattern of secretPatterns) assert.doesNotMatch(text, pattern, `${relativePath} contains a secret/token literal`);
    for (const target of localMarkdownTargets(text)) {
      assert.ok(await exists(resolve(root, pathFromMarkdownLink(relativePath, target))), `${relativePath} link does not resolve: ${target}`);
    }
  }
});

test("setup documentation states safe installation and statusline prerequisites", async () => {
  const requirements = [
    [/dry[- ]run/iu, "dry-run"],
    [/(?:first|before)/iu, "dry-run-first guidance"],
    [/--apply\b/iu, "explicit apply"],
    [/authoritative/iu, "authoritative overwrite"],
    [/overwrite/iu, "overwrite"],
    [/(?:no|without)\s+(?:a\s+)?backup/iu, "no backup"],
    [/statusline/iu, "statusline"],
    [/(?:--statusline-name|display name|statusline name)/iu, "statusline-name behavior"],
    [/emergency[\s\S]{0,240}(?:deny|denies|denied)/iu, "emergency denies"],
    [/(?:prerequisite|requirement|requires?)/iu, "prerequisites"],
    [/disposable[\s\S]{0,160}(?:root|directory|workspace)/iu, "disposable root"],
    [/node\.js/iu, "Node.js prerequisite"]
  ];
  for (const relativePath of ["docs/setup/windows.md", "docs/setup/macos.md"]) {
    const text = await textAt(relativePath);
    for (const [pattern, label] of requirements) assert.match(text, pattern, `${relativePath} omits ${label}`);
  }
  assert.match(await textAt("docs/setup/windows.md"), /windows[\s\S]{0,300}(?:powershell|pwsh)/iu);
  assert.match(await textAt("docs/setup/macos.md"), /macos|macOS/iu);
  assert.match(await textAt("docs/setup/macos.md"), /(?:bash|zsh)/iu);
});

test("compatibility documentation records automatic, manual, unsupported, and model fallback states", async () => {
  const requirements = [
    [/automatic/iu, "automatic behavior"],
    [/manual/iu, "manual behavior"],
    [/unsupported/iu, "unsupported behavior"],
    [/fallback/iu, "fallback behavior"],
    [/model/iu, "model semantics"],
    [/model[\s\S]{0,240}fallback|fallback[\s\S]{0,240}model/iu, "model fallback semantics"]
  ];
  for (const relativePath of [
    "docs/compatibility/claude.md",
    "docs/compatibility/codex.md",
    "docs/compatibility/antigravity-2.md",
    "docs/compatibility/agy.md"
  ]) {
    const text = await textAt(relativePath);
    for (const [pattern, label] of requirements) assert.match(text, pattern, `${relativePath} omits ${label}`);
  }
});

test("quarantine records each legacy disposition with evidence and a real named target", async () => {
  const text = await textAt("quarantine/README.md");
  for (const heading of ["original path", "replacement path", "failed legacy behavior", "replacement evidence", "removal eligibility"]) {
    assert.match(text, new RegExp(heading, "iu"), `quarantine README omits ${heading}`);
  }
  const rows = text.split(/\r?\n/u).filter((line) => /^\s*\|/u.test(line) && !/^\s*\|\s*:?-{3,}/u.test(line));
  assert.ok(rows.length >= legacyRoots.length, "quarantine README needs one disposition row per legacy root");
  for (const legacyRoot of legacyRoots) {
    const escaped = legacyRoot.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const row = rows.find((line) => new RegExp(`(?:^|[|\\s\x60])${escaped}(?:[/|\\s\x60]|$)`, "u").test(line));
    assert.ok(row, `quarantine README omits ${legacyRoot}`);
    const replacement = /quarantine\/[A-Za-z0-9._/-]+/u.exec(row)?.[0]?.replace(/[.,;:`)]+$/u, "").replace(/\/$/u, "");
    assert.ok(replacement, `${legacyRoot} has no named quarantine replacement path`);
    assert.ok(await exists(replacement), `${legacyRoot} replacement path does not exist: ${replacement}`);
  }
});

test("legacy roots are absent and canonical inventory records existing canonical or quarantined sources", async () => {
  for (const legacyRoot of legacyRoots) assert.equal(await exists(legacyRoot), false, `legacy root remains active: ${legacyRoot}`);
  const inventory = JSON.parse(await readFile(resolve(root, "core/inventory.json"), "utf8"));
  for (const [path, field] of inventoryPaths(inventory)) {
    assert.equal(typeof path, "string");
    const normalized = path.replaceAll("\\", "/");
    assert.equal(normalized, path, `${field} path is not portable: ${path}`);
    assert.ok(isCanonicalInventoryPath(path), `${field} path is outside canonical/quarantine roots: ${path}`);
    const candidates = [resolve(root, path)];
    if (coreRelativePrefixes.some((prefix) => path.startsWith(prefix))) candidates.push(resolve(root, "core", path));
    assert.ok((await Promise.all(candidates.map(exists))).some(Boolean), `${field} path does not exist: ${path}`);
  }
});

test("all generated package snapshots retain complete deterministic ownership manifests", async () => {
  const core = await loadCore(root);
  for (const surface of surfaces) {
    for (const profile of ["portable", "template"]) {
      const options = { repositoryRoot: root, core, surface: surface.id, profile, statuslineName: "", platform: "win32", ...surface.options };
      const first = await renderForSurface(options);
      const second = await renderForSurface(options);
      const snapshot = JSON.parse(await readFile(resolve(root, "tests", "snapshots", surface.id, `${profile}.json`), "utf8"));
      const paths = first.files.map((file) => file.relativePath);
      const ownership = first.ownership;
      const recordedOwnership = snapshotOwnership(snapshot);
      assert.deepEqual(first, second, `${surface.id}/${profile} render is not deterministic`);
      assert.equal(snapshot.fileCount, paths.length, `${surface.id}/${profile} file count drift`);
      assert.deepEqual(snapshot.paths ?? snapshot.files?.map((file) => file.relativePath), paths, `${surface.id}/${profile} path drift`);
      assert.deepEqual(recordedOwnership.map((entry) => entry.relativePath).sort(), [...paths].sort(), `${surface.id}/${profile} snapshot ownership path drift`);
      for (const entry of recordedOwnership) assert.match(entry.sha256, /^[0-9a-f]{64}$/u, `${surface.id}/${profile}/${entry.relativePath} has an invalid recorded hash`);
      assert.equal(new Set(paths).size, paths.length, `${surface.id}/${profile} has duplicate generated paths`);
      assert.equal(ownership.length, paths.length, `${surface.id}/${profile} ownership is incomplete`);
      for (const [index, file] of first.files.entries()) {
        const entry = ownership[index];
        assert.equal(entry.relativePath, file.relativePath);
        assert.match(entry.sha256, /^[0-9a-f]{64}$/u);
        assert.equal(entry.sha256, sha256(file.content), `${surface.id}/${profile}/${file.relativePath} hash drift`);
      }
      assert.ok(paths.some((path) => path.includes("skills/")), `${surface.id}/${profile} lost generated skills/ vocabulary`);
      assert.ok(paths.some((path) => path === "hooks.json" || path.endsWith("/hooks.json") || path.includes("hooks/")), `${surface.id}/${profile} lost generated hook vocabulary`);
    }
  }
});
