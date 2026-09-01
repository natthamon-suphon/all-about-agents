import assert from "node:assert/strict";
import { test } from "node:test";

let syncModule;
try {
  syncModule = await import("../../scripts/sync-status.mjs");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

const SHA = "b".repeat(40);
const forbiddenGitActions = new Set(["fetch", "pull", "merge", "rebase", "stash", "reset", "commit", "push"]);

function result(exitCode = 0, stdout = "", stderr = "") {
  return { exitCode, stdout, stderr, signal: null, unavailable: false, timedOut: false, outputTooLarge: false };
}

function gitRunner({
  repository = true,
  status = "",
  branch = "main",
  commit = SHA,
  upstream = "origin/main",
  counts = "0\t0\n",
  gitUnavailable = false
} = {}) {
  const calls = [];
  const run = async ({ executable, args, cwd }) => {
    calls.push({ executable, args: [...args], cwd });
    assert.equal(executable, "git");
    assert.equal(args.some((arg) => forbiddenGitActions.has(arg)), false, `mutating/network Git action in ${args.join(" ")}`);
    if (gitUnavailable) return { ...result(null, "", "git is unavailable"), unavailable: true };
    const key = args.join(" ");
    if (key === "rev-parse --is-inside-work-tree") return repository ? result(0, "true\n") : result(128, "", "not a git repository");
    if (key === "status --porcelain=v1 -z --untracked-files=all") return result(0, status);
    if (key === "symbolic-ref --quiet --short HEAD") return branch === null ? result(1) : result(0, `${branch}\n`);
    if (key === "rev-parse HEAD") return result(0, `${commit}\n`);
    if (key === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") return upstream === null ? result(128, "", "no upstream") : result(0, `${upstream}\n`);
    if (key === "rev-list --left-right --count HEAD...@{upstream}") return result(0, counts);
    assert.fail(`unexpected Git call: ${key}`);
  };
  return { run, calls };
}

test("sync status exposes its read-only public interface", () => {
  assert.equal(typeof syncModule?.inspectSyncStatus, "function");
  assert.equal(typeof syncModule?.formatSyncStatus, "function");
  assert.equal(typeof syncModule?.main, "function");
});

test("sync status reports a clean up-to-date main checkout", async () => {
  const fixture = gitRunner();
  const status = await syncModule.inspectSyncStatus({ cwd: "C:\\repo", run: fixture.run });

  assert.deepEqual(status, {
    schemaVersion: 1,
    branch: "main",
    commit: SHA,
    upstream: "origin/main",
    dirty: false,
    changedPaths: [],
    ahead: 0,
    behind: 0,
    relation: "up-to-date",
    refBasis: "local",
    networkAccess: false,
    readyFor: { pull: false, quality: true, install: true },
    nextAction: "Run npm run quality:quick before an explicit install."
  });
  assert.equal(fixture.calls.length, 6);
});

test("sync status keeps dirty paths with spaces and stops update readiness", async () => {
  const fixture = gitRunner({ status: " M docs/file with spaces.md\0?? new file.md\0" });
  const status = await syncModule.inspectSyncStatus({ cwd: "C:\\repo", run: fixture.run });

  assert.equal(status.dirty, true);
  assert.deepEqual(status.changedPaths, ["docs/file with spaces.md", "new file.md"]);
  assert.deepEqual(status.readyFor, { pull: false, quality: true, install: false });
  assert.match(status.nextAction, /preserve|commit|clean/iu);
});

test("sync status reports detached and missing-upstream states", async () => {
  const detached = await syncModule.inspectSyncStatus({ cwd: "C:\\repo", run: gitRunner({ branch: null }).run });
  assert.equal(detached.relation, "detached");
  assert.equal(detached.branch, null);
  assert.deepEqual(detached.readyFor, { pull: false, quality: true, install: false });
  assert.match(detached.nextAction, /git switch main/iu);

  const noUpstream = await syncModule.inspectSyncStatus({ cwd: "C:\\repo", run: gitRunner({ upstream: null }).run });
  assert.equal(noUpstream.relation, "no-upstream");
  assert.equal(noUpstream.upstream, null);
  assert.match(noUpstream.nextAction, /set-upstream-to=origin\/main/iu);
});

test("sync status reports ahead, behind, and diverged local refs", async () => {
  const ahead = await syncModule.inspectSyncStatus({ cwd: "C:\\repo", run: gitRunner({ counts: "2\t0\n" }).run });
  assert.equal(ahead.relation, "ahead");
  assert.deepEqual([ahead.ahead, ahead.behind], [2, 0]);
  assert.deepEqual(ahead.readyFor, { pull: false, quality: true, install: false });

  const behind = await syncModule.inspectSyncStatus({ cwd: "C:\\repo", run: gitRunner({ counts: "0 3\n" }).run });
  assert.equal(behind.relation, "behind");
  assert.deepEqual([behind.ahead, behind.behind], [0, 3]);
  assert.deepEqual(behind.readyFor, { pull: true, quality: true, install: false });
  assert.equal(behind.nextAction, "Run git pull --ff-only origin main, then run sync status again.");

  const diverged = await syncModule.inspectSyncStatus({ cwd: "C:\\repo", run: gitRunner({ counts: "2 3\n" }).run });
  assert.equal(diverged.relation, "diverged");
  assert.deepEqual(diverged.readyFor, { pull: false, quality: true, install: false });
  assert.match(diverged.nextAction, /manual|review/iu);
});

test("sync status rejects wrong branch and upstream for receiving-machine install", async () => {
  const wrongBranch = await syncModule.inspectSyncStatus({ cwd: "C:\\repo", run: gitRunner({ branch: "feature", upstream: "origin/feature" }).run });
  assert.equal(wrongBranch.relation, "up-to-date");
  assert.equal(wrongBranch.readyFor.install, false);
  assert.match(wrongBranch.nextAction, /git switch main/iu);

  const wrongUpstream = await syncModule.inspectSyncStatus({ cwd: "C:\\repo", run: gitRunner({ upstream: "fork/main" }).run });
  assert.equal(wrongUpstream.readyFor.install, false);
  assert.match(wrongUpstream.nextAction, /origin\/main/iu);
});

test("sync status reports non-repository and unavailable Git without guessing", async () => {
  const notRepository = await syncModule.inspectSyncStatus({ cwd: "C:\\repo", run: gitRunner({ repository: false }).run });
  assert.equal(notRepository.relation, "not-a-repository");
  assert.equal(notRepository.commit, null);
  assert.equal(notRepository.refBasis, "local");
  assert.deepEqual(notRepository.readyFor, { pull: false, quality: false, install: false });

  const unavailable = await syncModule.inspectSyncStatus({ cwd: "C:\\repo", run: gitRunner({ gitUnavailable: true }).run });
  assert.equal(unavailable.relation, "git-unavailable");
  assert.match(unavailable.nextAction, /install Git|PATH/iu);
});

test("sync status fails closed on malformed Git output", async () => {
  await assert.rejects(
    () => syncModule.inspectSyncStatus({ cwd: "C:\\repo", run: gitRunner({ status: "not-porcelain\0" }).run }),
    (error) => error?.code === "invalid-status"
  );
  await assert.rejects(
    () => syncModule.inspectSyncStatus({ cwd: "C:\\repo", run: gitRunner({ counts: "unknown\n" }).run }),
    (error) => error?.code === "invalid-revision-count"
  );
});

test("sync status fails closed on timed-out or truncated Git output", async () => {
  await assert.rejects(
    () => syncModule.inspectSyncStatus({ cwd: "C:\\repo", run: async () => ({ ...result(0, "true\n"), outputTooLarge: true }) }),
    (error) => error?.code === "git-output-too-large"
  );
  await assert.rejects(
    () => syncModule.inspectSyncStatus({ cwd: "C:\\repo", run: async () => ({ ...result(null), timedOut: true }) }),
    (error) => error?.code === "git-command-timeout"
  );
});

test("sync status text and JSON state that remote information uses local refs", async () => {
  const status = await syncModule.inspectSyncStatus({ cwd: "C:\\repo", run: gitRunner({ counts: "0 1\n" }).run });
  const text = syncModule.formatSyncStatus(status, { format: "text" });
  const json = syncModule.formatSyncStatus(status, { format: "json" });

  assert.match(text, /local refs/iu);
  assert.match(text, /git fetch origin/iu);
  assert.deepEqual(JSON.parse(json), status);
  assert.equal(json.endsWith("\n"), true);
  assert.throws(() => syncModule.formatSyncStatus(status, { format: "yaml" }), /format/iu);
});

test("sync status CLI validates options and returns state-based exit codes", async () => {
  const output = [];
  const errors = [];
  const io = { stdout: { write: (value) => output.push(value) }, stderr: { write: (value) => errors.push(value) } };

  assert.equal(await syncModule.main(["--format", "json"], io, { cwd: "C:\\repo", run: gitRunner().run }), 0);
  assert.equal(JSON.parse(output.join("")).relation, "up-to-date");
  assert.equal(await syncModule.main(["--bad"], io, { cwd: "C:\\repo", run: gitRunner().run }), 2);
  assert.match(errors.join(""), /unknown option/iu);
});
