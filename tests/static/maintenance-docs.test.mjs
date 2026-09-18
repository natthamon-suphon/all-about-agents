import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";

const root = process.cwd();
const maintenanceDocs = [
  "docs/maintenance/sync-and-update.md",
  "docs/maintenance/skill-development.md",
  "docs/maintenance/cross-tool-quality.md",
  "docs/maintenance/session-prompt.md",
  "docs/maintenance/native-registration.md",
  "docs/maintenance/native-verification.md"
];
const relatedDocs = [
  "README.md",
  "CONTRIBUTING.md",
  "docs/setup/windows.md",
  "docs/setup/macos.md",
  "docs/compatibility/claude.md",
  "docs/compatibility/codex.md",
  "docs/limitations/known-limitations.md",
  "docs/evaluations/method.md",
  "docs/maintenance/global-instructions.md",
  "adapters/claude/templates/README.md",
  "adapters/codex/templates/README.md",
  ...maintenanceDocs
];

async function text(relativePath) {
  return await readFile(resolve(root, relativePath), "utf8");
}

function assertBalancedFences(body, relativePath) {
  let open = null;
  for (const [index, line] of body.split("\n").entries()) {
    const match = line.match(/^\s*(`{3,}|~{3,})(.*)$/u);
    if (!match) continue;
    if (!open) {
      open = { marker: match[1][0], length: match[1].length, line: index + 1 };
    } else if (match[1][0] === open.marker && match[1].length >= open.length && match[2].trim() === "") {
      open = null;
    }
  }
  assert.equal(open, null, `${relativePath} has an unclosed code fence from line ${open?.line}`);
}

test("maintenance guides define the complete shared workflow", async () => {
  for (const relativePath of maintenanceDocs) await access(resolve(root, relativePath));

  const sync = await text(maintenanceDocs[0]);
  for (const value of [
    "Source machine",
    "Receiving machine",
    "npm run sync:status",
    "git pull --ff-only origin main",
    "npm run quality:quick",
    "npm run quality:full",
    "--dry-run",
    "No backup"
  ]) assert.ok(sync.includes(value), `sync guide omits ${value}`);
  assert.match(sync, /pull[\s\S]{0,160}does not install/iu);
  assert.match(sync, /clean worktree/iu);
  assert.match(sync, /aaa\.mjs diff[^\r\n]*--statusline-name "<YOUR_NAME>"/u);

  const skills = await text(maintenanceDocs[1]);
  for (const value of [
    "Canonical source",
    "Trigger case",
    "Non-trigger case",
    "Pressure case",
    "Behavior case",
    "RED",
    "GREEN",
    "npm run quality:skill -- <skill-name>"
  ]) assert.ok(skills.includes(value), `skill guide omits ${value}`);

  const quality = await text(maintenanceDocs[2]);
  for (const value of [
    "Repository checks",
    "Rendered package checks",
    "Disposable-root checks",
    "Native product checks",
    "Claude Code",
    "Codex",
    "NOT_RUN_UNAVAILABLE"
  ]) assert.ok(quality.includes(value), `quality guide omits ${value}`);

  const prompt = await text(maintenanceDocs[3]);
  for (const value of [
    "tool, model, and version",
    "branch and commit SHA",
    "checks that were not run",
    "next safe action"
  ]) assert.match(prompt, new RegExp(value, "iu"), `session prompt omits ${value}`);
  assert.match(prompt, /does not grant authority[\s\S]{0,160}(?:commit|push|install)/iu);

  const registration = await text(maintenanceDocs[4]);
  for (const value of [
    "rendered",
    "validated",
    "registered",
    "trusted",
    "active",
    "runtime verified",
    "register --dry-run",
    "register --apply",
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR"
  ]) assert.match(registration, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu"), `registration guide omits ${value}`);
  assert.match(registration, /git[\s\S]{0,240}native registration/iu);
  assert.match(registration, /warning|do not|never/iu);
  assert.doesNotMatch(registration, /install --surface <SURFACE>[^\r\n]*--statusline-name/u, "generic install command must not pass a surface-specific option");
  for (const surface of ["claude"]) {
    assert.match(registration, new RegExp(`install --surface ${surface}[^\\r\\n]*--statusline-name`, "u"), `registration guide omits ${surface} statusline-name install`);
  }
  for (const surface of ["codex"]) {
    assert.match(registration, new RegExp(`install --surface ${surface}[^\\r\\n]*(?:--dry-run|--apply)`, "u"), `registration guide omits ${surface} install without statusline-name`);
  }
  assert.doesNotMatch(registration, /register --surface all/u, "register accepts one surface, not all");
  assert.match(registration, /package rendered by\s+`install --surface all`/u);
  assert.doesNotMatch(registration, /may replace its owned regular files|does not replace unknown files/iu);
  assert.match(registration, /declared destination[\s\S]{0,120}preserves unknown neighboring/iu);
  assert.match(registration, /`settings\.json`[\s\S]{0,200}merges into it instead of replacing it/iu);
  assert.match(registration, /`config\.toml`[\s\S]{0,320}refuses to replace an existing file/iu);
  assert.match(registration, /CLAUDE_CONFIG_DIR\s*=\s*"<CLAUDE_PRODUCT_ROOT>"/u);
  assert.match(registration, /CODEX_HOME\s*=\s*"<CODEX_PRODUCT_ROOT>"/u);
  assert.doesNotMatch(registration, /(?:--destination-root|--package-root|git -C|claude plugin marketplace add|claude plugin validate|codex plugin marketplace add)\s+<[^>\r\n]+>/u);
  const registrationGitCommand = registration.indexOf("git -C \"<PACKAGE_ROOT>\" init");
  const registrationGitWarning = registration.indexOf("Warning: the following Git commands");
  assert.ok(registrationGitWarning >= 0 && registrationGitWarning < registrationGitCommand, "native registration Git warning must precede its mutation commands");
  for (const [variable, placeholder] of [["CLAUDE_CONFIG_DIR", "CLAUDE_PRODUCT_ROOT"], ["CODEX_HOME", "CODEX_PRODUCT_ROOT"]]) {
    assert.match(registration, new RegExp(`\\$env:${variable}\\s*=\\s*"<${placeholder}>"`, "u"), `registration guide omits PowerShell ${variable}`);
    assert.match(registration, new RegExp(`export ${variable}="<${placeholder}>"`, "u"), `registration guide omits POSIX ${variable}`);
  }
  assert.doesNotMatch(registration, /^\s*(?:CLAUDE_CONFIG_DIR|CODEX_HOME)=<PRODUCT_ROOT>\s+node/mu, "registration guide contains an unlabeled POSIX-only command");
  assert.match(registration, /Trust that is available but not exercised is `NOT_RUN`/u);

  assert.match(sync, /Trust that is available but not exercised is `NOT_RUN`/u);

  const verification = await text(maintenanceDocs[5]);
  for (const value of [
    "node --test tests/integration/native-registration.test.mjs",
    "plugin list --available --json",
    "runtime verified",
    "NOT_RUN_UNAVAILABLE",
    "restart",
    "reload"
  ]) assert.match(verification, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu"), `verification guide omits ${value}`);
});

test("global instruction guide defines the shared source and dual-layer model", async () => {
  const body = await text("docs/maintenance/global-instructions.md");
  for (const value of [
    "core/instructions/global-operating-rules.md",
    "CLAUDE_CONFIG_DIR",
    "CLAUDE.md",
    "CODEX_HOME",
    "AGENTS.md",
    "Global layer",
    "Project and plugin layer",
    "brainstorming 🧠",
    "Using skill",
    "Checklist",
    "reason",
    "not a UI guarantee"
  ]) assert.match(body, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu"), `global guide omits ${value}`);
  assert.match(body, /CLAUDE\.local\.md[\s\S]{0,120}(?:private|project)[\s\S]{0,120}(?:not|never)[\s\S]{0,120}global/iu);
});

test("entry and platform docs link the maintenance workflow", async () => {
  const readme = await text("README.md");
  for (const target of ["CONTRIBUTING.md", ...maintenanceDocs]) {
    assert.ok(readme.includes(target), `README omits ${target}`);
  }

  for (const relativePath of ["docs/setup/windows.md", "docs/setup/macos.md"]) {
    const body = await text(relativePath);
    assert.match(body, /sync-and-update\.md/u);
    assert.match(body, /cross-tool-quality\.md/u);
    assert.match(body, /pull[\s\S]{0,180}(?:does not|will not) install/iu);
  }

  for (const relativePath of [
    "docs/compatibility/claude.md",
    "docs/compatibility/codex.md"
  ]) {
    const body = await text(relativePath);
    assert.match(body, /cross-tool-quality\.md/u);
    assert.match(body, /evidence/iu);
  }

  for (const relativePath of ["docs/maintenance/native-registration.md", "docs/maintenance/native-verification.md"]) {
    const body = await text(relativePath);
    assert.match(body, /cross-machine|receiving machine|author machine/iu);
    assert.match(body, /rendered[\s\S]{0,500}validated[\s\S]{0,500}registered/iu);
    assert.doesNotMatch(body, /git pull[^\n]*(?:--apply|register)/iu);
  }
  for (const relativePath of ["docs/maintenance/sync-and-update.md", "docs/maintenance/native-verification.md"]) {
    const body = await text(relativePath);
    assert.match(body, /native-registration\.md#dry-run-registration/u);
    assert.match(body, /native-registration\.md#apply-registration/u);
    assert.doesNotMatch(body, /^\s*node scripts\/aaa\.mjs register --surface <SURFACE>/mu);
  }
});

test("maintenance documentation has valid links and no stale workflow claims", async () => {
  const unquotedPathPlaceholder = /(?:--destination-root|--package-root|git -C|claude plugin marketplace add|claude plugin validate|codex plugin marketplace add)\s+<[^>\r\n]+>/u;
  const banned = [
    /\borigin\s+master\b/iu,
    /\bgit\s+pull\b[^\r\n]*(?:&&|;)\s*[^\r\n]*(?:install|--apply)/iu,
    /static tests? (?:prove|proves|proved) native/iu,
    /active (?:plugin\/settings )?roots? (?:are |remain )?(?:unknown|manual)/iu,
    /complete tool vocabulary (?:is |remains )?unknown/iu,
    /conflicting skill (?:shape|format)/iu
  ];

  for (const relativePath of relatedDocs) {
    const body = await text(relativePath);
    assertBalancedFences(body, relativePath);
    assert.doesNotMatch(body, unquotedPathPlaceholder, `${relativePath} has an unquoted path placeholder`);
    for (const pattern of banned) assert.doesNotMatch(body, pattern, `${relativePath}: ${pattern}`);
    for (const match of body.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      const target = match[1].split(/[?#]/u, 1)[0];
      if (!target || /^[a-z]+:/iu.test(target)) continue;
      await access(resolve(root, dirname(relativePath), decodeURIComponent(target)));
    }
  }

  for (const relativePath of relatedDocs) {
    const body = await text(relativePath);
    for (const line of body.split(/\r?\n/u)) {
      if (/CLAUDE\.local\.md/iu.test(line) && /global|destination/iu.test(line)) {
        assert.match(line, /\b(?:not|never|no)\b/iu, `${relativePath} has stale local-global guidance`);
      }
    }
  }
});
