import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
import { materializeRenderResult, renderForSurface } from "../../installers/lib/render.mjs";

const SURFACES = ["claude", "codex", "antigravity-2", "agy"];
const PROFILES = ["portable", "template"];
const EMOJI = /\p{Extended_Pictographic}/u;
const RAW_ESCAPE = /\u001B|\x1B/u;
const PRIVATE_HOME = /(?:^|[\\/])Users[\\/](?!tester(?:[\\/]|$)|test-user(?:[\\/]|$)|disposable(?:[\\/]|$))[^\\/]+|(?:^|[\\/])home[\\/](?!user(?:[\\/]|$))[^\\/]+/iu;
const BACKUP_SUFFIX = /(?:\.bak|\.backup|~)$/u;
const UNSAFE_CONTENT = [
  { label: "span markup", pattern: /<span\b/iu },
  { label: "style markup", pattern: /<style\b/iu },
  { label: "html animation", pattern: /(?:<animate\b|@keyframes\b|animation\s*:[^;\n]+)/iu },
  { label: "raw ANSI escape", pattern: RAW_ESCAPE }
];

function machineId(label, value) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.equal(EMOJI.test(value), false, `${label} must not contain presentation emoji: ${value}`);
}

function portablePath(label, value) {
  machineId(label, value);
  assert.equal(value.includes("\\"), false, `${label} must use POSIX separators: ${value}`);
  assert.equal(value.startsWith("/"), false, `${label} must be relative: ${value}`);
  assert.equal(/^[A-Za-z]:/u.test(value), false, `${label} must not be absolute: ${value}`);
  assert.equal(value.split("/").includes(".."), false, `${label} must not traverse: ${value}`);
}

function scanMachineValue(label, value) {
  if (typeof value === "string") {
    assert.equal(EMOJI.test(value), false, `${label} contains emoji: ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanMachineValue(`${label}[${index}]`, item));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      machineId(`${label} key`, key);
      scanMachineValue(`${label}.${key}`, item);
    }
  }
}

const MACHINE_JSON_KEYS = new Set([
  "id", "name", "surface", "profile", "state", "status", "kind", "event", "feature", "source", "destination",
  "relativePath", "relativeDirectory", "sourcePath", "targetPath", "rootEnv", "model", "effort", "command", "actionId",
  "workflowId", "taskId", "pluginManifest", "packageRoot", "installedPluginRoot"
]);

function scanJsonMachineFields(label, value, path = label) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanJsonMachineFields(label, item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    machineId(`${path} key`, key);
    if (MACHINE_JSON_KEYS.has(key)) {
      if (typeof item === "string") machineId(`${path}.${key}`, item);
      else if (Array.isArray(item)) item.forEach((entry, index) => {
        if (typeof entry === "string") machineId(`${path}.${key}[${index}]`, entry);
      });
    }
    scanJsonMachineFields(label, item, `${path}.${key}`);
  }
}

function scanTomlMachineFields(label, body) {
  for (const [index, line] of body.split(/\r?\n/u).entries()) {
    const assignment = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/u.exec(line);
    if (!assignment) continue;
    const [, key, doubleValue, singleValue] = assignment;
    machineId(`${label} TOML key line ${index + 1}`, key);
    if (key === "name" || key === "id" || key === "state" || key === "status") machineId(`${label} TOML ${key}`, doubleValue ?? singleValue ?? "");
  }
}

function parseFrontmatter(filePath, body) {
  if (!filePath.endsWith(".md") || !body.startsWith("---\n")) return;
  const end = body.indexOf("\n---", 4);
  assert.ok(end > 0, `${filePath} frontmatter must close`);
  const name = body.slice(4, end).split(/\r?\n/u).find((line) => line.startsWith("name:"));
  if (name) machineId(`${filePath} frontmatter name`, name.slice("name:".length).trim());
}

function isOpaqueCompanion(surface, relativePath, core) {
  const prefixes = surface === "claude"
    ? ["skills/"]
    : surface === "codex"
      ? ["skills/", ".agents/skills/"]
      : surface === "antigravity-2"
        ? [".agents/plugins/all-about-agents/skills/"]
        : ["skills/"];
  return prefixes.some((prefix) => {
    const tail = relativePath.startsWith(prefix) ? relativePath.slice(prefix.length) : null;
    if (!tail) return false;
    const [skill, ...parts] = tail.split("/");
    if (!skill || parts.length === 0) return false;
    const record = core.skills.find((entry) => entry.id === skill);
    return record?.companions?.some((companion) => companion.relativePath === parts.join("/")) === true;
  });
}

function assertSafePackage({ surface, profile, result, core }) {
  const filePaths = result.files.map((file) => file.relativePath);
  assert.deepEqual(result.ownership.map((entry) => entry.relativePath), filePaths, `${surface}/${profile} ownership must match sorted file order`);
  assert.equal(new Set(result.ownership.map((entry) => entry.relativePath)).size, result.ownership.length, `${surface}/${profile} ownership paths must be unique`);
  for (const [index, entry] of result.ownership.entries()) {
    assert.match(entry.sha256, /^[0-9a-f]{64}$/u, `${surface}/${profile} ownership hash must be lowercase SHA-256`);
    assert.equal(entry.sha256, createHash("sha256").update(result.files[index].content).digest("hex"), `${surface}/${profile}/${entry.relativePath} ownership hash drift`);
  }
  for (const registration of result.registrations) {
    for (const key of ["relativePath", "relativeDirectory", "destination", "manualDestination", "source", "stagedDestination", "sourcePath", "targetPath"]) {
      if (typeof registration?.[key] === "string") portablePath(`${surface}/${profile} registration ${key}`, registration[key]);
    }
    for (const key of ["destinationCandidates"]) {
      for (const value of registration?.[key] ?? []) {
        if (typeof value === "string" && !value.startsWith("~/")) portablePath(`${surface}/${profile} registration candidate`, value);
        else machineId(`${surface}/${profile} registration candidate`, value);
      }
    }
    for (const key of ["status", "kind", "surface", "profile", "event", "feature", "actionId", "workflowId", "taskId"]) {
      if (typeof registration?.[key] === "string") machineId(`${surface}/${profile} registration ${key}`, registration[key]);
    }
  }
  for (const file of result.files) {
    portablePath(`${surface}/${profile} file`, file.relativePath);
    assert.equal(BACKUP_SUFFIX.test(file.relativePath), false, `${surface}/${profile} must not render backup file: ${file.relativePath}`);
    assert.equal(PRIVATE_HOME.test(file.relativePath), false, `${surface}/${profile} path leaks a private home: ${file.relativePath}`);
    const body = new TextDecoder("utf-8", { fatal: true }).decode(file.content);
    if (isOpaqueCompanion(surface, file.relativePath, core)) continue;
    parseFrontmatter(file.relativePath, body);
    for (const { label, pattern } of UNSAFE_CONTENT) assert.equal(pattern.test(body), false, `${surface}/${profile}/${file.relativePath} contains ${label}`);
    if (file.relativePath.endsWith(".json")) {
      let parsed;
      assert.doesNotThrow(() => { parsed = JSON.parse(body); }, `${surface}/${profile}/${file.relativePath} must be valid JSON`);
      scanJsonMachineFields(`${surface}/${profile}/${file.relativePath}`, parsed);
    }
    if (file.relativePath.endsWith(".toml")) scanTomlMachineFields(`${surface}/${profile}/${file.relativePath}`, body);
  }
}

test("loaded core machine identifiers and presentation data keep emoji separated", async () => {
  const core = await loadCore(process.cwd());
  scanMachineValue("inventory", core.inventory);
  for (const collection of ["rules", "roles", "skills", "commands", "workflows", "evals"]) {
    for (const entry of core[collection]) machineId(`${collection} id`, entry.id ?? entry.name);
  }
  for (const [kind, records] of Object.entries(core.presentation.emojiRegistry)) {
    machineId("presentation kind", kind);
    for (const id of Object.keys(records)) machineId(`presentation ${kind} id`, id);
  }
  for (const state of Object.keys(core.presentation.progressContract.states)) machineId("progress state", state);
  const emojiRegistry = JSON.stringify(core.presentation.emojiRegistry);
  assert.match(emojiRegistry, EMOJI);
});

test("all materialized surface packages pass the presentation safety scan", async () => {
  const core = await loadCore(process.cwd());
  for (const surface of SURFACES) {
    for (const profile of PROFILES) {
      const rendered = await renderForSurface({
        repositoryRoot: process.cwd(),
        core,
        surface,
        profile,
        statuslineName: "",
        platform: "win32",
        targetRuntime: surface === "codex" ? "cli" : undefined
      });
      const result = materializeRenderResult(rendered);
      assertSafePackage({ surface, profile, result, core });
    }
  }
});

test("the safety scan rejects machine-id emoji and forbidden package content", async () => {
  assert.throws(() => machineId("role", "reviewer 👀"), /emoji/u);
  assert.throws(() => portablePath("path", "rules/../unsafe.md"), /traverse/u);
  for (const { label, pattern } of UNSAFE_CONTENT) {
    const examples = {
      "span markup": "<span>unsafe</span>",
      "style markup": "<style>unsafe</style>",
      "html animation": "@keyframes unsafe { from { opacity: 0; } }",
      "raw ANSI escape": "\u001b[31munsafe"
    };
    assert.equal(pattern.test(examples[label]), true);
  }
  assert.throws(() => scanJsonMachineFields("fixture", { "unsafe 👀": "value" }), /emoji/u);
  assert.throws(() => scanJsonMachineFields("fixture", { state: "done ✅" }), /emoji/u);
  assert.throws(() => scanTomlMachineFields("fixture", 'name = "reviewer 👀"\n'), /emoji/u);
  assert.equal(PRIVATE_HOME.test("C:/Users/private-user/.codex/AGENTS.md"), true);
  assert.equal(BACKUP_SUFFIX.test("AGENTS.md.bak"), true);
});

test("manifest and package snapshots contain no private home path or backup artifact", async () => {
  for (const surface of SURFACES) {
    const manifest = await readFile(resolve(process.cwd(), `installers/manifests/${surface}.json`), "utf8");
    assert.equal(PRIVATE_HOME.test(manifest), false, `${surface} manifest leaks private home path`);
    for (const profile of PROFILES) {
      const snapshot = await readFile(resolve(process.cwd(), `tests/snapshots/${surface}/${profile}.json`), "utf8");
      assert.equal(PRIVATE_HOME.test(snapshot), false, `${surface}/${profile} snapshot leaks private home path`);
      assert.equal(BACKUP_SUFFIX.test(snapshot), false, `${surface}/${profile} snapshot names a backup artifact`);
    }
  }
});
