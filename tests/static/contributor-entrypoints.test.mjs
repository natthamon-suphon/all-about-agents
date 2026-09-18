import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstat, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";

const root = process.cwd();
const entrypoints = ["AGENTS.md", "CLAUDE.md"];
const allDocs = ["CONTRIBUTING.md", ...entrypoints];
const requiredHeadings = [
  "Before You Start",
  "Change One Skill",
  "Files That Must Change Together",
  "Quick and Full Checks",
  "Git Authority",
  "Cross-Machine Update",
  "Live Install Boundary",
  "Evidence Report"
];
const sharedProtocol = [
  "npm run sync:status",
  "npm run quality:quick",
  "npm run quality:full",
  "register --dry-run",
  "register --apply",
  "NOT_RUN_UNAVAILABLE"
];

async function text(relativePath) {
  return await readFile(resolve(root, relativePath), "utf8");
}

test("shared contributor protocol and all native entry points exist", async () => {
  for (const relativePath of allDocs) {
    const details = await stat(resolve(root, relativePath));
    assert.ok(details.isFile(), `${relativePath} must be a regular file`);
  }
});

test("CONTRIBUTING has the exact required sections and portable commands", async () => {
  const body = await text("CONTRIBUTING.md");
  for (const heading of requiredHeadings) assert.match(body, new RegExp(`^## ${heading}$`, "mu"), heading);
  for (const command of ["npm run sync:status", "npm run quality:skill -- <skill-name>", "npm run quality:quick", "npm run quality:full"]) {
    assert.ok(body.includes(command), command);
  }
  assert.match(body, /main and origin\/main/u);
  assert.match(body, /No backup is made/u);
  assert.match(body, /pull.*does not install/isu);
});

test("native entry points enforce the same minimum protocol", async () => {
  const rules = [
    /CONTRIBUTING\.md/u,
    /relevant guide under `docs\/`/u,
    /inspect the real files/iu,
    /writing-skills/u,
    /focused check/iu,
    /npm run quality:quick/u,
    /npm run quality:full/u,
    /native success.*static tests/iu,
    /commit, push, merge, install, or change live config/iu,
    /checks not run/iu
  ];
  for (const relativePath of entrypoints) {
    const body = await text(relativePath);
    for (const rule of rules) assert.match(body, rule, `${relativePath}: ${rule}`);
    assert.match(body, /`main`/u);
    assert.doesNotMatch(body, /\bmaster\b/iu);
    for (const phrase of sharedProtocol) assert.match(body, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "iu"), `${relativePath}: ${phrase}`);
  }
});

test("all local Markdown links resolve and prose stays short and factual", async () => {
  const unsupported = /\b(?:perfect|guaranteed|all native checks pass|fully verified)\b/iu;
  for (const relativePath of allDocs) {
    const body = await text(relativePath);
    assert.doesNotMatch(body, unsupported, relativePath);
    let fenced = false;
    for (const line of body.split("\n")) {
      if (line.startsWith("```")) fenced = !fenced;
      if (!fenced && line.trim() && !line.startsWith("|") && !/^\s*[-#]/u.test(line)) {
        assert.ok(line.trim().split(/\s+/u).length <= 30, `${relativePath} has a long prose line: ${line}`);
      }
    }
    for (const match of body.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      const target = match[1].split("#", 1)[0];
      if (!target || /^[a-z]+:/iu.test(target)) continue;
      const linked = resolve(root, dirname(relativePath), target);
      await stat(linked);
    }
  }
});

test("AGENTS.md is a regular Git file on Windows and macOS checkouts", async () => {
  const details = await lstat(resolve(root, "AGENTS.md"));
  assert.equal(details.isSymbolicLink(), false);
  const index = execFileSync("git", ["ls-files", "-s", "--", "AGENTS.md"], { cwd: root, encoding: "utf8" }).trim();
  assert.match(index, /^100644\s/u);
});
