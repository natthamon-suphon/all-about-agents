import assert from "node:assert/strict";
import fs from "node:fs";
import { lstat, mkdir, mkdtemp, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix, win32 } from "node:path";
import test from "node:test";

import { withTempRoot } from "../helpers/temp-root.mjs";
import { assertSafeDestinationRoot, assertSafeDestinationRoots, RootResolutionError, resolveDestinationRoot } from "../../installers/lib/roots.mjs";
import { skipIfLinkUnavailable } from "../helpers/symlink.mjs";

test("a synchronous root batch checks shared existing ancestors in two bounded scans", async () => {
  await withTempRoot(async (root) => {
    const paths = [join(root, "shared", "one"), join(root, "shared", "two"), join(root, "other", "three")];
    for (const path of paths) await mkdir(path, { recursive: true });
    const ancestors = new Set();
    for (const path of paths) {
      for (let current = path; ; current = dirname(current)) {
        ancestors.add(current);
        if (dirname(current) === current) break;
      }
    }
    const original = fs.realpathSync.native;
    let calls = 0;
    fs.realpathSync.native = function (...args) { calls += 1; return original.apply(this, args); };
    try {
      assert.deepEqual(assertSafeDestinationRoots(paths, { allowedProductRoots: [root] }), paths);
    } finally {
      fs.realpathSync.native = original;
    }
    assert.ok(calls <= 2 * ancestors.size, `${calls} native resolutions exceed two scans of ${ancestors.size} unique ancestors`);
  });
});

test("a root batch validates every containment boundary and required directory", async () => {
  await withTempRoot(async (root) => {
    const allowed = join(root, "package");
    await mkdir(allowed);
    const missing = join(allowed, "missing");
    assert.deepEqual(assertSafeDestinationRoots([missing], { allowedProductRoots: [allowed] }), [missing]);
    assert.throws(() => assertSafeDestinationRoots([allowed, join(root, "outside")], { allowedProductRoots: [allowed] }), (error) => error.code === "root-outside-allowed");
    assert.throws(() => assertSafeDestinationRoots([missing], { allowedProductRoots: [allowed], required: true }), (error) => error.code === "invalid-root");
    assert.throws(() => assertSafeDestinationRoots(["/"], { platform: "darwin", homeDir: "/Users/tester", allowedProductRoots: ["/private/tmp/fixture"] }), (error) => error.code === "broad-root");
  });
});

test("root batches recheck a shared ancestor after it becomes a link between calls", async (t) => {
  await withTempRoot(async (root) => {
    const allowed = join(root, "package");
    const shared = join(allowed, "shared");
    const paths = [join(shared, "one"), join(shared, "two")];
    const outside = join(root, "outside");
    for (const path of [...paths, join(outside, "one"), join(outside, "two")]) await mkdir(path, { recursive: true });
    const options = { allowedProductRoots: [allowed], required: true };
    assert.deepEqual(assertSafeDestinationRoots(paths, options), paths);
    await rename(shared, join(allowed, "original"));
    try {
      await symlink(outside, shared, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      skipIfLinkUnavailable(t, error);
      return;
    }
    assert.throws(() => assertSafeDestinationRoots(paths, options), (error) => error.code === "unsafe-root");
  });
});

test("a root batch rejects shared ancestor replacement during sibling validation", async (t) => {
  for (const occurrence of [1, 2]) await withTempRoot(async (root) => {
    const allowed = join(root, "package");
    const shared = join(allowed, "shared");
    const paths = [join(shared, "one"), join(shared, "two")];
    const outside = join(root, "outside");
    for (const path of [...paths, join(outside, "one"), join(outside, "two")]) await mkdir(path, { recursive: true });
    const linkType = process.platform === "win32" ? "junction" : "dir";
    try {
      await symlink(outside, join(root, "link-check"), linkType);
    } catch (error) {
      skipIfLinkUnavailable(t, error);
      return;
    }
    const original = fs.realpathSync.native;
    let swapped = false;
    let leafReads = 0;
    let failure;
    fs.realpathSync.native = function (path, ...args) {
      const result = original.call(this, path, ...args);
      if (path === paths[0]) leafReads += 1;
      if (!swapped && path === paths[0] && leafReads === occurrence) {
        swapped = true;
        fs.renameSync(shared, join(allowed, "original"));
        fs.symlinkSync(outside, shared, linkType);
      }
      return result;
    };
    try {
      assertSafeDestinationRoots(paths, { allowedProductRoots: [allowed], required: true });
    } catch (error) {
      failure = error;
    } finally {
      fs.realpathSync.native = original;
    }
    assert.equal(swapped, true);
    assert.equal(failure?.code, "unsafe-root", `replacement after leaf read ${occurrence}`);
  });
});

test("root batches preserve ordinary Windows short-name directory aliases", { skip: process.platform !== "win32" }, async (t) => {
  const rawRoot = await mkdtemp(join(tmpdir(), "aaa-root-alias-"));
  const canonicalRoot = fs.realpathSync.native(rawRoot);
  try {
    if (!/~\d/u.test(rawRoot) || rawRoot.toLowerCase() === canonicalRoot.toLowerCase()) {
      t.skip("the native temporary path does not expose a short-name alias");
      return;
    }
    const paths = [join(rawRoot, "one"), join(rawRoot, "two")];
    for (const path of paths) await mkdir(path);
    const options = { allowedProductRoots: [rawRoot], required: true };
    for (const path of paths) assert.equal(assertSafeDestinationRoot(path, options), path);
    assert.deepEqual(assertSafeDestinationRoots(paths, options), paths);
  } finally {
    assert.equal(dirname(canonicalRoot), fs.realpathSync.native(tmpdir()));
    await rm(canonicalRoot, { recursive: true, force: true });
  }
});

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

test("root resolution rejects traversal, malformed bases, unsupported platforms, and unsafe existing roots", async (t) => {
  assert.throws(() => resolveDestinationRoot({ surface: "claude", override: "../escape", env: {}, platform: "darwin", homeDir: "/Users/tester" }), /traversal|escape/u);
  assert.throws(() => resolveDestinationRoot({ surface: "claude", override: "/Users/tester/../escape", env: {}, platform: "darwin", homeDir: "/Users/tester" }), /traversal|escape/u);
  assert.throws(() => resolveDestinationRoot({ surface: "claude", override: "C:\\Users\\Test\\..\\escape", env: {}, platform: "win32", homeDir: "C:\\Users\\Test" }), /traversal|escape/u);
  assert.throws(() => resolveDestinationRoot({ surface: "claude", override: null, env: {}, platform: "win32", homeDir: "relative" }), RootResolutionError);
  assert.throws(() => resolveDestinationRoot({ surface: "claude", override: null, env: {}, platform: "linux", homeDir: "/home/tester" }), /platform/u);
  await withTempRoot(async (root) => {
    const target = join(root, "target");
    const link = join(root, "link");
    await mkdir(target);
    try {
      await symlink(target, link, "junction");
    } catch (error) {
      skipIfLinkUnavailable(t, error);
      return;
    }
    await lstat(link);
    assert.throws(() => resolveDestinationRoot({ surface: "claude", override: link, env: {}, platform: process.platform === "win32" ? "win32" : "darwin", homeDir: process.platform === "win32" ? win32.parse(root).root : posix.parse(root).root }), /symlink|junction|unsafe/u);
  });
});

test("root resolution fails closed when a nonexistent descendant crosses an existing link ancestor", async (t) => {
  await withTempRoot(async (root) => {
    const real = join(root, "real");
    const alias = join(root, "alias");
    await mkdir(real);
    try {
      await symlink(real, alias, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      skipIfLinkUnavailable(t, error);
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
