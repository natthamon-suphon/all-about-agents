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
  "docs/maintenance/global-instructions.md",
  "docs/compatibility/antigravity.md",
  "docs/compatibility/claude.md",
  "docs/compatibility/codex.md",
  "docs/evaluations/native-windows-2026-08-31.md",
  "docs/limitations/known-limitations.md",
  "docs/maintenance/native-registration.md",
  "docs/maintenance/native-verification.md",
  "tests/static/documentation.test.mjs"
];

const documentationFiles = [
  "README.md",
  "CONTRIBUTING.md",
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  ...requiredOutputs.filter((path) => path.startsWith("docs/"))
];

const legacyRoots = ["agents", "configs", "hooks", "setup", "statusline", "skills", ".claude-plugin"];
const canonicalPrefixes = [
  "core/",
  "adapters/",
  "installers/",
  "profiles/",
  "scripts/",
  "tests/",
  "docs/",
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
const coreRelativePrefixes = ["skills/", "roles/", "rules/", "hooks/", "evals/"];

const surfaces = [
  { id: "antigravity", options: { env: {}, targetRuntime: "cli" } },
  { id: "claude", options: { env: { CLAUDE_CONFIG_DIR: "C:/disposable/claude" } } },
  { id: "codex", options: { env: { CODEX_HOME: "C:/disposable/codex" }, targetRuntime: "cli" } }
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
    ])
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

test("T09 documents the dual layer, exact destinations, and receiving-machine order", async () => {
  const flow = "pull -> validate -> render -> dry-run -> apply package -> dry-run registration -> explicit registration apply -> restart -> verify loaded instructions";
  const global = await textAt("docs/maintenance/global-instructions.md");
  const sync = await textAt("docs/maintenance/sync-and-update.md");
  const readme = await textAt("README.md");

  assert.match(global, /one canonical source/iu);
  for (const destination of ["CLAUDE.md", "AGENTS.md", "GEMINI.md"]) assert.ok(global.includes(destination), `global guide omits ${destination}`);
  assert.match(global, /global layer/iu);
  assert.match(global, /project and plugin layer/iu);
  assert.match(global, /more specific second layer/iu);
  assert.match(global, /core\/instructions\/global-operating-rules\.md/u);
  assert.match(global, /CLAUDE_CONFIG_DIR.*CLAUDE\.md[\s\S]{0,160}CODEX_HOME.*AGENTS\.md/iu);
  assert.match(global, /CLAUDE\.local\.md[\s\S]{0,120}(?:private|project)[\s\S]{0,120}(?:not|never)[\s\S]{0,120}global/iu);
  assert.match(global, /Using skill \*\*brainstorming 🧠\*\*/u);
  assert.match(global, /reason is one short sentence/iu);
  assert.match(global, /checklist[\s\S]{0,300}(?:pending|in progress|completed)/iu);
  assert.match(global, /prompt guidance[\s\S]{0,120}(?:not|no)[\s\S]{0,80}UI guarantee/iu);

  assert.ok(sync.includes(flow), "sync guide omits the receiving-machine flow");
  assert.match(sync, /Git is the (?:cross-machine )?source of truth/iu);
  assert.match(sync, /pull[\s\S]{0,180}does not (?:install|write live)/iu);
  assert.match(sync, /package apply[\s\S]{0,180}native registration[\s\S]{0,180}separate/iu);
  assert.match(sync, /managed global files[\s\S]{0,120}overwrite[\s\S]{0,120}without a backup/iu);
  assert.match(readme, /docs\/maintenance\/global-instructions\.md/u);
  assert.match(readme, /global layer[\s\S]{0,180}project[\s\S]{0,180}second/iu);
});

test("T09 provides one copyable eight-step quality checklist and new-skill flow", async () => {
  const quality = await textAt("docs/maintenance/cross-tool-quality.md");
  const skills = await textAt("docs/maintenance/skill-development.md");
  const sync = await textAt("docs/maintenance/sync-and-update.md");
  for (const phrase of [
    "read the repository entrypoint",
    "run core validation",
    "focused tests for changed files",
    "render both profiles",
    "run dry-run",
    "package/presentation integrity",
    "update checkpoints",
    "do not call native behavior active"
  ]) assert.match(quality, new RegExp(phrase, "iu"), `quality checklist omits ${phrase}`);
  for (const phrase of [
    "canonical skill content",
    "inventory",
    "emoji registry",
    "routing cases",
    "render all surfaces",
    "commit/push",
    "receiving machine"
  ]) assert.match(skills, new RegExp(phrase, "iu"), `skill update flow omits ${phrase}`);
  assert.match(sync, /## Source machine \(author machine\)/iu);
  assert.match(sync, /## Receiving machine/iu);
  assert.match(sync, /pull[\s\S]{0,120}validate[\s\S]{0,120}render[\s\S]{0,120}dry-run/iu);
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
    "docs/compatibility/codex.md"
  ]) {
    const text = await textAt(relativePath);
    for (const [pattern, label] of requirements) assert.match(text, pattern, `${relativePath} omits ${label}`);
  }
});

test("cross-machine documentation records separate repository and native lifecycles", async () => {
  const lifecycleTerms = ["rendered", "validated", "registered", "trusted", "active", "runtime verified"];
  const compatibility = [
    "docs/compatibility/claude.md",
    "docs/compatibility/codex.md"
  ];
  for (const relativePath of compatibility) {
    const body = await textAt(relativePath);
    for (const term of lifecycleTerms) assert.match(body, new RegExp(`\\b${term}\\b`, "iu"), `${relativePath} omits lifecycle term ${term}`);
    assert.match(body, /statusline[\s\S]{0,400}(?:display name|statusline-name)/iu, `${relativePath} omits statusline setup wording`);
  }

  const registration = await textAt("docs/maintenance/native-registration.md");
  const verification = await textAt("docs/maintenance/native-verification.md");
  for (const body of [registration, verification]) {
    for (const term of lifecycleTerms) assert.match(body, new RegExp(`\\b${term}\\b`, "iu"), `native guide omits lifecycle term ${term}`);
    assert.match(body, /register --dry-run/iu);
    assert.match(body, /register --apply/iu);
    assert.match(body, /restart|reload/iu);
    assert.match(body, /NOT_RUN_UNAVAILABLE/iu);
  }
  assert.match(registration, /plugin marketplace add/iu);
  assert.match(registration, /plugin add/iu);
  assert.match(registration, /hooks/iu);
  assert.match(verification, /node --test tests\/integration\/native-registration\.test\.mjs/u);
  assert.match(verification, /authenticated model|credentials/iu);
});

test("documentation rejects stale native activation and fallback claims", async () => {
  const readme = await textAt("README.md");
  const readmeApplyCommand = readme.indexOf("node scripts/aaa.mjs install --surface claude --destination-root \"<DISPOSABLE_ROOT>\" --apply");
  const readmeApplyWarning = readme.indexOf("Warning: `--apply`");
  assert.ok(readmeApplyWarning >= 0 && readmeApplyWarning < readmeApplyCommand, "README warning must precede its write command");
  const codex = await textAt("docs/compatibility/codex.md");
  const claude = await textAt("docs/compatibility/claude.md");
  assert.match(claude, /`settings\.json` is merged, not replaced[\s\S]{0,160}every other key already in the file is preserved/iu);
  assert.doesNotMatch(readme, /denies active/iu);
  assert.match(readme, /rendered[\s\S]{0,160}native enforcement is not claimed/iu);
  assert.doesNotMatch(codex, /Hooks\s*\|\s*Automatic/iu);
  assert.match(codex, /Hook trust[^\r\n]*`NOT_RUN`/iu);
  assert.doesNotMatch(codex, /Hook trust remains `NOT_RUN_UNAVAILABLE`/iu);
  assert.doesNotMatch(codex, /(?:automatically\s+(?:uses|selects|falls back)|automatic fallback\s+(?:is enabled|is used|is supported))/iu);
  assert.doesNotMatch(claude, /Statusline[^|]*\|\s*Unsupported/iu);
  assert.match(claude, /trusted[\s\S]{0,160}(?:not-run-unavailable|NOT_RUN_UNAVAILABLE|no native trust step)/iu);
  assert.doesNotMatch(claude, /package list[\s\S]{0,80}trusted hook/iu);
  assert.match(codex, /codex --profile terra-max/u);
  assert.doesNotMatch(claude, /^\s*CLAUDE_CONFIG_DIR=<PRODUCT_ROOT>\s+node/mu);
  assert.doesNotMatch(codex, /^\s*CODEX_HOME=<PRODUCT_ROOT>\s+node/mu);

  const method = await textAt("docs/evaluations/method.md");
  assert.doesNotMatch(method, /Both statusline launchers run/iu);
  assert.match(method, /Windows statusline command[\s\S]{0,100}both profiles/iu);
  assert.doesNotMatch(method, /default apply is no-overwrite-safe/iu);
  assert.match(method, /installer-owned[\s\S]{0,120}precondition[\s\S]{0,120}atomic/iu);
  assert.match(method, /unknown (?:neighbor|file)s?[\s\S]{0,80}preserv/iu);

  const codexGitCommand = codex.indexOf("git -C \"<PACKAGE_ROOT>\" init");
  const codexGitWarning = codex.indexOf("Warning: the following Git commands");
  assert.ok(codexGitWarning >= 0 && codexGitWarning < codexGitCommand, "Codex Git warning must precede its mutation commands");
  for (const [label, body] of [["Claude", claude], ["Codex", codex]]) {
    assert.doesNotMatch(body, /(?:--destination-root|--package-root|git -C|claude plugin marketplace add|claude plugin validate|codex plugin marketplace add)\s+<[^>\r\n]+>/u, `${label} compatibility guide has an unquoted path placeholder`);
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
      const hasHooks = paths.some((path) => path === "hooks.json" || path.endsWith("/hooks.json") || path.includes("hooks/"));
      // Antigravity documents no SessionStart event, so it renders no hooks at
      // all and inlines the routing contract into GEMINI.md instead. Every
      // other surface must keep its hook vocabulary.
      if (surface.id === "antigravity") assert.equal(hasHooks, false, `${surface.id}/${profile} must not render hooks`);
      else assert.ok(hasHooks, `${surface.id}/${profile} lost generated hook vocabulary`);
    }
  }
});
