import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { main } from "../../scripts/aaa.mjs";
import { withTempRoot } from "../helpers/temp-root.mjs";
import { skipIfLinkUnavailable } from "../helpers/symlink.mjs";

const requiredOutputs = [
  ".gitignore",
  "package.json",
  "scripts/aaa.mjs",
  "tests/helpers/temp-root.mjs",
  "tests/static/runtime.test.mjs",
  "tests/static/repository-layout.test.mjs"
];

test("T001 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) {
    await access(resolve(process.cwd(), relativePath));
  }
});

test("current Node runtime is at least 22.12.0", () => {
  const [major, minor] = process.versions.node.split(".").map(Number);
  assert.ok(
    major > 22 || (major === 22 && minor >= 12),
    `Node 22.12.0 or newer is required; found ${process.versions.node}`
  );
});

test("node:test is available as the test runner", () => {
  assert.equal(typeof test, "function");
});

test("Unicode paths round-trip through the filesystem", async () => {
  const root = await mkdtemp(join(tmpdir(), "aaa-runtime-"));
  const filePath = join(root, "Δοκιμή-🚀.txt");
  try {
    await writeFile(filePath, "こんにちは, мир, مرحبا", "utf8");
    assert.equal(await readFile(filePath, "utf8"), "こんにちは, мир, مرحبا");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("same-directory rename provides an atomic handoff", async () => {
  const root = await mkdtemp(join(tmpdir(), "aaa-runtime-"));
  const temporaryPath = join(root, "result.tmp");
  const finalPath = join(root, "result.json");
  try {
    await writeFile(temporaryPath, '{"ok":true}', "utf8");
    await rename(temporaryPath, finalPath);
    assert.equal(await readFile(finalPath, "utf8"), '{"ok":true}');
    await assert.rejects(access(temporaryPath), { code: "ENOENT" });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("package metadata declares ESM Node support without dependencies", async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(process.cwd(), "package.json"), "utf8")
  );
  assert.equal(packageJson.type, "module");
  assert.equal(packageJson.engines?.node, ">=22.12.0");
  for (const dependencyMap of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies"
  ]) {
    assert.deepEqual(packageJson[dependencyMap] ?? {}, {}, `${dependencyMap} must be empty`);
  }
  assert.deepEqual(Object.keys(packageJson.scripts).sort(), [
    "doctor",
    "export:claude-ai",
    "quality:full",
    "quality:quick",
    "quality:skill",
    "setup",
    "sync:status",
    "test",
    "test:contracts",
    "test:integration",
    "test:model",
    "test:static",
    "validate"
  ]);
  assert.equal(packageJson.scripts["test:contracts"], "node --test tests/contracts/*.test.mjs", "test:contracts must run only its folder");
  assert.equal(packageJson.scripts["test:integration"], "node --test tests/integration/*.test.mjs", "test:integration must run only its folder");
});

test("withTempRoot cleans its disposable root after the callback", async () => {
  const { withTempRoot } = await import("../helpers/temp-root.mjs");
  assert.equal(typeof withTempRoot, "function");

  let rootPath;
  const result = await withTempRoot(async (root) => {
    rootPath = root;
    await writeFile(join(root, "marker.txt"), "temporary", "utf8");
    return "callback-result";
  });

  assert.equal(result, "callback-result");
  await assert.rejects(access(rootPath), { code: "ENOENT" });
});

test("withTempRoot cleans its disposable root when the callback throws", async () => {
  const { withTempRoot } = await import("../helpers/temp-root.mjs");
  let rootPath;
  await assert.rejects(
    withTempRoot(async (root) => {
      rootPath = root;
      throw new Error("expected callback failure");
    }),
    { message: "expected callback failure" }
  );
  await assert.rejects(access(rootPath), { code: "ENOENT" });
});

test("CLI help lists the six supported top-level actions and every option each action accepts", () => {
  const result = spawnSync(process.execPath, ["scripts/aaa.mjs", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    [
      "Usage: node scripts/aaa.mjs <action>",
      "",
      "Actions:",
      "  install   Install or update the local agent-system configuration",
      "  doctor    Check the local runtime and repository prerequisites",
      "  validate  Validate repository configuration and contracts",
      "  diff      Show the pending configuration diff",
      "  eval      Run an evaluation against a disposable root",
      "  register  Register one rendered package with its native product (dry-run by default)",
      "",
      "Options for install, doctor, diff, and register:",
      "  --surface <surface>  antigravity, claude, codex, or all (default all; register requires exactly one)",
      "  --profile <profile>  Use portable or template profile",
      "  --destination-root <path>  Root for install, doctor, or diff, relative to the current directory; required for install --apply",
      "  --statusline-name <name>  Claude statusline display name for install or diff (at most 64 characters)",
      "  --package-root <path>  Package path for register, required (absolute or relative to the current directory)",
      "  --dry-run | --apply  Plan only by default; apply requires explicit --apply",
      "  --format text|json  Select human or machine-readable output",
      "  -h, --help  Show this help",
      "",
      "Options for validate:",
      "  --scope core|all|skill  core renders the portable profile, all adds the template profile, skill checks one skill",
      "  --skill <name>  Skill to check with --scope skill",
      "  --format text|json  Select human or machine-readable output",
      "",
      "Options for eval (all required except --surface and --format):",
      "  --skill <name>  Canonical skill to evaluate",
      "  --variant control|candidate  Variant label for the batch",
      "  --samples 5  Sample count; must be exactly 5",
      "  --input-jsonl <path>  JSONL file with one record per sample",
      "  --output <dir>  Result directory, for example .aaa/eval-runs",
      "  --surface <surface>  Optional surface label for the report",
      "  --format text|json  Select human or machine-readable output",
      ""
    ].join("\n")
  );
});

test("entry scripts still run when invoked through a symlinked repository path", async (t) => {
  await withTempRoot(async (root) => {
    const linked = join(root, "linked-repository");
    try {
      await symlink(process.cwd(), linked, "junction");
    } catch (error) {
      skipIfLinkUnavailable(t, error);
      return;
    }
    try {
      for (const script of ["aaa.mjs", "quality-gate.mjs", "sync-status.mjs", "export-claude-ai.mjs"]) {
        const result = spawnSync(process.execPath, [join(linked, "scripts", script), "--help"], { cwd: root, encoding: "utf8" });
        assert.equal(result.status, 0, `${script}: ${result.stderr}`);
        assert.match(result.stdout, /^Usage:/u, `${script} must act, not exit silently, when argv[1] is a symlinked path`);
      }
    } finally {
      // Unlink the live-repository link before withTempRoot deletes the root recursively.
      await rm(linked, { force: true, recursive: false });
    }
  });
});

test("CLI returns exit code 2 for an unknown action", () => {
  const result = spawnSync(process.execPath, ["scripts/aaa.mjs", "unknown"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown action: unknown/);
});

test("CLI returns exit code 1 when repository validation fails", async () => {
  const root = await mkdtemp(join(tmpdir(), "aaa-invalid-root-"));
  try {
    for (const action of ["validate", "doctor"]) {
      let stdout = "";
      let stderr = "";
      const status = await main([action], { write: (value) => { stdout += value; } }, { write: (value) => { stderr += value; } }, { repositoryRoot: root });
      assert.equal(status, 1, `${action} should report failure`);
      assert.match(stderr, /Foundation validation failed/);
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("disposable test roots contain no symlinked ancestor", async () => {
  const { realpath } = await import("node:fs/promises");
  const { makeTempRoot, withTempRoot } = await import("../helpers/temp-root.mjs");
  const made = await makeTempRoot("aaa-canonical-");
  try {
    assert.equal(made, await realpath(made), "makeTempRoot must return its canonical path");
  } finally {
    await rm(made, { force: true, recursive: true });
  }
  await withTempRoot(async (root) => {
    assert.equal(root, await realpath(root), "withTempRoot must pass its canonical path");
  });
});
