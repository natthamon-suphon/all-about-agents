import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import test from "node:test";
import { validateSchema } from "../../installers/lib/validate-schema.mjs";

const surfaces = ["antigravity", "claude", "codex"];
const manifestGlobalNames = new Map([
  ["antigravity", "GEMINI.md"],
  ["claude", "CLAUDE.md"],
  ["codex", "AGENTS.md"]
]);
const repositoryRoot = resolve(process.cwd());
const officialHosts = new Set(["code.claude.com", "developers.openai.com"]);

async function assertValidSource(source, label) {
  assert.equal(typeof source, "string", `${label}: source must be a string`);
  assert.ok(source.length > 0, `${label}: source must not be empty`);

  if (/^[a-z][a-z\d+.-]*:\/\//iu.test(source)) {
    const url = new URL(source);
    assert.equal(url.protocol, "https:", `${label}: URL sources must use HTTPS`);
    assert.ok(officialHosts.has(url.hostname.toLowerCase()), `${label}: URL source must use an allowed official host`);
    return;
  }

  assert.equal(source.includes("\\"), false, `${label}: local source must use repository POSIX separators`);
  assert.equal(isAbsolute(source), false, `${label}: local source must be relative`);
  const resolvedSource = resolve(repositoryRoot, source);
  const canonicalRepositoryRoot = await realpath(repositoryRoot);
  const canonicalSource = await realpath(resolvedSource);
  const containedPath = relative(canonicalRepositoryRoot, canonicalSource);
  assert.equal(containedPath === "" || (!containedPath.startsWith("..") && !isAbsolute(containedPath)), true, `${label}: local source must stay in the repository`);
  assert.equal((await stat(canonicalSource)).isFile(), true, `${label}: local source must be a regular file`);
}

async function loadCapability(surface) {
  const path = resolve(process.cwd(), `adapters/${surface}/capabilities.json`);
  return JSON.parse(await readFile(path, "utf8"));
}

test("capability records exist for every supported surface", async () => {
  for (const surface of surfaces) {
    await access(resolve(process.cwd(), `adapters/${surface}/capabilities.json`));
  }
  await access(resolve(process.cwd(), "core/schemas/capability.schema.json"));
});

test("manifest ownership is complete, sorted, unique, and names the global output", async () => {
  for (const surface of surfaces) {
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), `installers/manifests/${surface}.json`), "utf8"));
    assert.equal(manifest.surface, surface);
    assert.ok(Array.isArray(manifest.ownedPaths), `${surface} manifest must declare ownedPaths`);
    assert.equal(new Set(manifest.ownedPaths).size, manifest.ownedPaths.length, `${surface} manifest ownership must be unique`);
    assert.deepEqual([...manifest.ownedPaths].sort(), manifest.ownedPaths, `${surface} manifest ownership must be sorted`);
    const global = manifest.components.globalInstructions;
    const packageName = typeof global === "string" ? global : global?.package;
    assert.equal(packageName, manifestGlobalNames.get(surface));
    assert.ok(manifest.ownedPaths.some((path) => path === packageName), `${surface} manifest must own ${packageName}`);
    assert.doesNotMatch(JSON.stringify(manifest), /\p{Extended_Pictographic}/u, `${surface} manifest machine data must not contain emoji`);
  }
});

test("capability records use the strict shared record shape", async () => {
  for (const surface of surfaces) {
    const record = await loadCapability(surface);
    assert.equal(record.surface, surface);
    assert.match(record.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(typeof record.productVersion === "string");
    assert.ok(Array.isArray(record.capabilities));
    assert.ok(record.capabilities.length > 0);
    for (const capability of record.capabilities) {
      for (const key of ["feature", "support", "stability", "source", "checkedAt", "productVersion"]) {
        assert.ok(Object.hasOwn(capability, key), `${surface} capability missing ${key}`);
      }
      assert.ok(capability.source.length > 0);
      assert.match(capability.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
    }
  }
});

test("capability sources resolve to contained files or official HTTPS URLs", async () => {
  for (const surface of surfaces) {
    const record = await loadCapability(surface);
    for (const capability of record.capabilities) {
      await assertValidSource(capability.source, `${surface}/${capability.feature}`);
    }
  }
});

test("capability source validation rejects unsafe paths and untrusted URLs", async () => {
  const invalidSources = [
    "C:/outside.md",
    "C:\\outside.md",
    "/outside.md",
    "\\\\server\\outside.md",
    "../outside.md",
    "nested/../../outside.md",
    "missing-evidence.md",
    "http://code.claude.com/docs",
    "file://repo/evidence.md",
    "https://example.com/evidence.md",
    "https://code.claude.com.evil.example/evidence.md"
  ];
  for (const source of invalidSources) {
    await assert.rejects(assertValidSource(source, source), source);
  }
});

test("capability source validation rejects directories and links escaping the repository", async () => {
  await mkdir(resolve(repositoryRoot, "tests/.tmp"), { recursive: true });
  const disposableRoot = await mkdtemp(resolve(repositoryRoot, "tests/.tmp/capability-sources-"));
  const outsideRoot = await mkdtemp(join(tmpdir(), "aaa-capability-sources-"));
  const outsideFile = join(outsideRoot, "outside.md");
  const linkRoot = join(disposableRoot, "escaped");
  try {
    await writeFile(outsideFile, "outside evidence\n", "utf8");
    try {
      await symlink(outsideRoot, linkRoot, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      assert.fail(`Could not create an escape-link regression fixture on ${process.platform}: ${error.message}`);
    }

    const toSource = (path) => relative(repositoryRoot, path).replaceAll("\\", "/");
    const rejected = await Promise.all([
      assertValidSource(toSource(disposableRoot), "directory-source").then(() => false, () => true),
      assertValidSource(toSource(join(linkRoot, "outside.md")), "escaped-link-source").then(() => false, () => true)
    ]);
    assert.deepEqual(rejected, [true, true]);
  } finally {
    await rm(disposableRoot, { recursive: true, force: true });
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test("Claude native statusline capability is supported and stable", async () => {
  for (const surface of ["claude"]) {
    const record = await loadCapability(surface);
    const statusline = record.capabilities.find((item) => item.feature === "statusline.native");
    assert.ok(statusline, `${surface} statusline capability is missing`);
    assert.equal(statusline.support, "supported");
    assert.equal(statusline.stability, "stable");
    assert.ok(statusline.value && typeof statusline.value === "object");
  }
});

test("Claude Fable advisor wording records current support with access limits", async () => {
  const claude = await loadCapability("claude");
  const advisor = claude.capabilities.find((item) => item.feature === "model.advisor");
  assert.ok(advisor);
  assert.equal(advisor.value, "claude-fable-5-1");
  assert.notEqual(advisor.stability, "experimental");
  assert.match(advisor.notes, /account|plan|version/iu);
  assert.match(advisor.notes, /access|available|consent|credit/iu);
});

test("capability evidence keeps unsupported and unknown claims explicit", async () => {
  const codex = await loadCapability("codex");
  const fallback = codex.capabilities.find((item) => item.feature === "model.automatic-fallback");
  assert.ok(fallback);
  assert.equal(fallback.support, "unsupported");
  assert.equal(fallback.stability, "unsupported");
  assert.match(fallback.source, /research-model-policy-codex\.md$/);
  const hooks = codex.capabilities.find((item) => item.feature === "hooks.lifecycle");
  assert.ok(hooks);
  assert.doesNotMatch(hooks.notes, /enabled by default/iu);
  assert.match(hooks.notes, /trust|manual|not automatic/iu);
});

test("strict schemas reject undeclared capability properties", async () => {
  const schema = JSON.parse(await readFile(resolve(process.cwd(), "core/schemas/capability.schema.json"), "utf8"));
  const valid = await loadCapability("claude");
  assert.equal(validateSchema({ schema, value: valid, sourcePath: "adapters/claude/capabilities.json" }).valid, true);
  const invalid = { ...valid, unexpected: true };
  const result = validateSchema({ schema, value: invalid, sourcePath: "fixture.json" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.keyword === "additionalProperties"));
});

test("every adapter record validates and active claims retain evidence", async () => {
  const schema = JSON.parse(await readFile(resolve(process.cwd(), "core/schemas/capability.schema.json"), "utf8"));
  for (const surface of surfaces) {
    const record = await loadCapability(surface);
    const result = validateSchema({ schema, value: record, sourcePath: `adapters/${surface}/capabilities.json` });
    assert.equal(result.valid, true, `${surface}: ${JSON.stringify(result.errors)}`);
    for (const capability of record.capabilities) {
      if (capability.support === "supported") assert.notEqual(capability.source, "unknown");
    }
  }
});
