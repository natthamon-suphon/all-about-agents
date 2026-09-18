import assert from "node:assert/strict";
import { lstat, mkdir, symlink } from "node:fs/promises";
import { join, posix, win32 } from "node:path";
import test from "node:test";

import { withTempRoot } from "../helpers/temp-root.mjs";
import { assertSafeDestinationRoot, RootResolutionError, resolveDestinationRoot } from "../../installers/lib/roots.mjs";

test("destination safety rejects filesystem, account-container, and home roots", () => {
  const cases = [
    { platform: "darwin", homeDir: "/Users/alice", allowedProductRoots: ["/Users/alice/.claude"], roots: ["/", "/Users", "/Users/alice", "/Users/alice/"] },
    { platform: "win32", homeDir: "C:\\Users\\alice", allowedProductRoots: ["C:\\Users\\alice\\.claude"], roots: ["C:\\", "C:\\Users", "c:/users/ALICE", "C:\\Users\\alice\\"] }
  ];
  for (const entry of cases) {
    for (const root of entry.roots) {
      assert.throws(
        () => assertSafeDestinationRoot(root, entry),
        (error) => error instanceof RootResolutionError && error.code === "broad-root",
        `${entry.platform}:${root}`
      );
    }
  }
});

test("destination safety accepts only roots contained by an explicit product or disposable root", () => {
  const cases = [
    { platform: "darwin", homeDir: "/Users/alice", root: "/Users/alice/.claude", allowedProductRoots: ["/Users/alice/.claude"] },
    { platform: "darwin", homeDir: "/Users/alice", root: "/Users/alice/.codex/plugins/aaa", allowedProductRoots: ["/Users/alice/.codex"] },
    { platform: "darwin", homeDir: "/Users/alice", root: "/private/tmp/aaa-test/output", allowedProductRoots: ["/private/tmp/aaa-test"] },
    { platform: "win32", homeDir: "C:\\Users\\alice", root: "c:\\users\\ALICE\\.claude\\plugins\\aaa", allowedProductRoots: ["C:\\Users\\alice\\.claude"] },
    { platform: "win32", homeDir: "C:\\Users\\alice", root: "C:\\Temp\\aaa-test", allowedProductRoots: ["c:\\temp\\AAA-TEST"] }
  ];
  for (const entry of cases) assert.doesNotThrow(() => assertSafeDestinationRoot(entry.root, entry));
  assert.throws(
    () => assertSafeDestinationRoot("/Users/alice/.claude", { platform: "darwin", homeDir: "/Users/alice" }),
    (error) => error instanceof RootResolutionError && error.code === "allowed-roots-required"
  );
  assert.throws(
    () => assertSafeDestinationRoot("/Users/alice/.codex", { platform: "darwin", homeDir: "/Users/alice", allowedProductRoots: ["/Users/alice/.claude"] }),
    (error) => error instanceof RootResolutionError && error.code === "root-outside-allowed"
  );
});

test("resolveDestinationRoot honors documented Claude and Codex environment overrides", () => {
  assert.equal(resolveDestinationRoot({ surface: "claude", override: null, env: { CLAUDE_CONFIG_DIR: "C:\\Users\\Test\\配置" }, platform: "win32", homeDir: "C:\\Users\\Test" }), "C:\\Users\\Test\\配置");
  assert.equal(resolveDestinationRoot({ surface: "codex", override: null, env: { CODEX_HOME: "C:/Users/Test/配置" }, platform: "win32", homeDir: "C:\\Users\\Test" }), "C:\\Users\\Test\\配置");
  assert.equal(resolveDestinationRoot({ surface: "claude", override: null, env: {}, platform: "darwin", homeDir: "/Users/tester" }), "/Users/tester/.claude");
  assert.equal(resolveDestinationRoot({ surface: "codex", override: null, env: {}, platform: "darwin", homeDir: "/Users/naïve" }), "/Users/naïve/.codex");
});

test("explicit roots take precedence and Windows containment comparison is case-insensitive", () => {
  assert.equal(resolveDestinationRoot({ surface: "claude", override: "C:\\Temp\\AAA", env: { CLAUDE_CONFIG_DIR: "C:\\Wrong" }, platform: "win32", homeDir: "C:\\Users\\Test" }), "C:\\Temp\\AAA");
  assert.equal(resolveDestinationRoot({ surface: "claude", override: "C:\\Users\\TEST\\fixture", env: {}, platform: "win32", homeDir: "C:\\Users\\Test" }), "C:\\Users\\TEST\\fixture");
  assert.equal(resolveDestinationRoot({ surface: "claude", override: "//SERVER/Share/配置", env: {}, platform: "win32", homeDir: "C:\\Users\\Test" }), "\\\\SERVER\\Share\\配置");
});

test("root resolution rejects traversal, malformed bases, unsupported platforms, and unsafe existing roots", async () => {
  assert.throws(() => resolveDestinationRoot({ surface: "claude", override: "../escape", env: {}, platform: "darwin", homeDir: "/Users/tester" }), /traversal|escape/u);
  assert.throws(() => resolveDestinationRoot({ surface: "claude", override: "/Users/tester/../escape", env: {}, platform: "darwin", homeDir: "/Users/tester" }), /traversal|escape/u);
  assert.throws(() => resolveDestinationRoot({ surface: "claude", override: "C:\\Users\\Test\\..\\escape", env: {}, platform: "win32", homeDir: "C:\\Users\\Test" }), /traversal|escape/u);
  assert.throws(() => resolveDestinationRoot({ surface: "claude", override: null, env: {}, platform: "win32", homeDir: "relative" }), RootResolutionError);
  assert.throws(() => resolveDestinationRoot({ surface: "claude", override: null, env: {}, platform: "linux", homeDir: "/home/tester" }), /platform/u);
  await withTempRoot(async (root) => {
    const target = join(root, "target");
    const link = join(root, "link");
    await mkdir(target);
    try { await symlink(target, link, "junction"); } catch { return; }
    await lstat(link);
    assert.throws(() => resolveDestinationRoot({ surface: "claude", override: link, env: {}, platform: process.platform === "win32" ? "win32" : "darwin", homeDir: process.platform === "win32" ? win32.parse(root).root : posix.parse(root).root }), /symlink|junction|unsafe/u);
  });
});

test("root resolution fails closed when a nonexistent descendant crosses an existing link ancestor", async () => {
  await withTempRoot(async (root) => {
    const real = join(root, "real");
    const alias = join(root, "alias");
    await mkdir(real);
    try {
      await symlink(real, alias, process.platform === "win32" ? "junction" : "dir");
    } catch {
      return;
    }
    await lstat(alias);
    const descendant = join(alias, "not-yet-created", "child");
    const simulatedPlatform = process.platform === "win32" ? "win32" : "darwin";
    const home = simulatedPlatform === "win32" ? win32.parse(root).root : posix.parse(root).root;
    assert.throws(
      () => resolveDestinationRoot({ surface: "claude", override: descendant, env: {}, platform: simulatedPlatform, homeDir: home }),
      (error) => error instanceof RootResolutionError && error.code === "unsafe-root"
    );
  });
});
