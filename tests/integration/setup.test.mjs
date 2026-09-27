import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { withTempRoot } from "../helpers/temp-root.mjs";
import { main, planSetup } from "../../scripts/setup.mjs";

function recorder(results = {}) {
  const calls = [];
  return {
    calls,
    run: async (request) => {
      calls.push(request);
      const key = `${request.executable} ${request.args.join(" ")}`;
      for (const [pattern, result] of Object.entries(results)) {
        if (key.includes(pattern)) return { exitCode: 0, stdout: "", stderr: "", unavailable: false, timedOut: false, outputTooLarge: false, ...result };
      }
      return { exitCode: 0, stdout: "", stderr: "", unavailable: false, timedOut: false, outputTooLarge: false };
    }
  };
}

function collector() {
  const chunks = [];
  return { chunks, write: (value) => chunks.push(value), text: () => chunks.join("") };
}

const SETUP_SCRIPT = fileURLToPath(new URL("../../scripts/setup.mjs", import.meta.url));
// Never created. Every run gets a fake home, an empty environment, and a
// recording runner, so no test can reach the real home or spawn a product.
const UNUSED_HOME = resolve(tmpdir(), "aaa-setup-test-home-never-created");

async function runMain(argv, { runProcess = recorder().run, homeDir = UNUSED_HOME, env = {}, repositoryRoot } = {}) {
  const output = collector();
  const errorOutput = collector();
  const code = await main(argv, output, errorOutput, { runProcess, homeDir, env, ...(repositoryRoot ? { repositoryRoot } : {}) });
  return { code, stdout: output.text(), stderr: errorOutput.text() };
}

function stepsById(report) {
  return Object.fromEntries(report.steps.map((step) => [step.id, step]));
}

// Recorder patterns for one surface's registration. The preview and the apply
// differ only in the mode flag that follows the surface package root.
const registerApply = (surface) => `${sep}${surface} --apply --format json`;
const registerPreview = (surface) => `${sep}${surface} --dry-run --format json`;

// Name each preview, plugin removal, and registration call so the order can be compared.
function pluginLifecycle(calls) {
  return calls
    .map((call) => {
      if (!call.args.includes("register")) return `${call.executable} ${call.args.slice(0, 2).join(" ")}`;
      return `${call.args.includes("--dry-run") ? "preview" : "register"} ${call.args[call.args.indexOf("--surface") + 1]}`;
    })
    .filter((label) => /^(?:preview|register) |plugin (?:uninstall|remove)$/u.test(label));
}

/** Create a directory that carries the markers of a rendered package root. */
async function packageRoot(root, children = ["claude", "codex"]) {
  const target = resolve(root, "package");
  await mkdir(resolve(target, ".all-about-agents"), { recursive: true });
  await writeFile(resolve(target, ".all-about-agents", "state.json"), "{}\n", "utf8");
  for (const child of children) {
    await mkdir(resolve(target, child), { recursive: true });
    await writeFile(resolve(target, child, "marker.txt"), "rendered\n", "utf8");
  }
  return target;
}

test("a missing or unknown mode is refused before any step runs", async () => {
  const missing = await runMain(["--package-root", "ignored"]);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr + missing.stdout, /mode-required/u);

  const unknown = await runMain(["--mode", "rebuild"]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr + unknown.stdout, /invalid-mode/u);
});

test("fresh plans the package-root clear step and update does not", () => {
  const fresh = planSetup({ mode: "fresh", surfaces: ["claude", "codex"], profile: "template", packageRoot: "/tmp/pkg" });
  const update = planSetup({ mode: "update", surfaces: ["claude", "codex"], profile: "template", packageRoot: "/tmp/pkg" });

  assert.ok(fresh.steps.some((step) => step.id === "package-root-clear"), "fresh must clear the package root");
  assert.ok(!update.steps.some((step) => step.id === "package-root-clear"), "update must keep the package root");

  const sharedIds = (plan) => plan.steps.map((step) => step.id).filter((id) => id !== "package-root-clear");
  assert.deepEqual(sharedIds(fresh), sharedIds(update), "both modes must run the same remaining pipeline");
  assert.ok(fresh.steps.every((step) => typeof step.mutates === "boolean"));
});

test("every planned command carries a structured argument list and no shell string", () => {
  const plan = planSetup({ mode: "fresh", surfaces: ["claude", "codex"], profile: "template", packageRoot: "/tmp/pkg" });
  for (const step of plan.steps) {
    if (!("executable" in step)) continue;
    assert.equal(typeof step.executable, "string");
    assert.ok(step.executable.trim().length > 0, `${step.id} needs an executable`);
    assert.ok(Array.isArray(step.args), `${step.id} needs an argument array`);
    assert.ok(step.args.every((arg) => typeof arg === "string"), `${step.id} args must be strings`);
    assert.ok(!step.executable.includes(" "), `${step.id} must not embed a shell string`);
  }
});

test("dry-run is the default and runs no mutating step", async () => {
  await withTempRoot(async (root) => {
    const target = await packageRoot(root);
    const runner = recorder();
    const result = await runMain(["--mode", "fresh", "--package-root", target], { runProcess: runner.run });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /mode=fresh/u);
    const mutating = runner.calls.filter((call) => call.args.includes("--apply") || call.args.includes("uninstall") || call.args.includes("remove"));
    assert.deepEqual(mutating, [], "a dry-run must not spawn a mutating command");
    assert.deepEqual((await readdir(target)).sort(), [".all-about-agents", "claude", "codex"], "a dry-run must not delete anything");
    assert.match(result.stdout, /pending/u, "mutating steps must be reported as pending");
    assert.match(result.stdout, /register-preview-claude\s+pending/u, "the registration preview waits for the render of an --apply run");
    assert.ok(!runner.calls.some((call) => call.args.includes("register")), "a dry-run must not run register at all");
  });
});

test("fresh --apply empties a whole-root or a per-surface package root and keeps the root itself", async () => {
  await withTempRoot(async (root) => {
    const whole = await packageRoot(resolve(root, "whole"), ["antigravity", "claude", "codex"]);
    const perSurface = resolve(root, "per-surface", "package");
    for (const surface of ["antigravity", "claude", "codex"]) {
      await mkdir(resolve(perSurface, surface, ".all-about-agents"), { recursive: true });
      await writeFile(resolve(perSurface, surface, ".all-about-agents", "state.json"), "{}\n", "utf8");
    }

    for (const [target, removed] of [[whole, 4], [perSurface, 3]]) {
      const runner = recorder();
      // The real install recreates the surface directories the later steps read.
      const rendering = async (request) => {
        const result = await runner.run(request);
        if (request.args.includes("install")) await mkdir(resolve(target, "codex"), { recursive: true });
        return result;
      };
      const result = await runMain(["--mode", "fresh", "--package-root", target, "--apply"], { runProcess: rendering });

      assert.equal(result.code, 0, result.stderr + result.stdout);
      assert.match(result.stdout, new RegExp(`package-root-clear\\s+completed — removed ${String(removed)} entries`, "u"));
      assert.ok(!(await readdir(target)).includes(".all-about-agents"), "the previous managed state must not survive");
      assert.ok(!existsSync(resolve(target, "claude", ".all-about-agents")), "a nested managed state must not survive");
      const installed = runner.calls.some((call) => call.args.includes("install") && call.args.includes("--apply"));
      assert.ok(installed, "the clear step must be followed by a real install");
    }
  });
});

test("an entry the installer does not write blocks the fresh clear and nothing is deleted", async () => {
  await withTempRoot(async (root) => {
    const target = await packageRoot(root, ["claude", "codex", "retired-surface"]);
    await writeFile(resolve(target, "notes.txt"), "operator data\n", "utf8");
    const runner = recorder();
    const result = await runMain(["--mode", "fresh", "--package-root", target, "--apply"], { runProcess: runner.run });

    assert.notEqual(result.code, 0);
    assert.match(result.stdout + result.stderr, /not-a-package-root[^\n]*notes\.txt, retired-surface/u, "the refusal must name every unknown entry");
    assert.equal(runner.calls.length, 0, "nothing may run before the refusal");
    assert.deepEqual((await readdir(target)).sort(), [".all-about-agents", "claude", "codex", "notes.txt", "retired-surface"]);
  });
});

test("Finder metadata at the package root is cleared with the package but never makes another entry clearable", async () => {
  await withTempRoot(async (root) => {
    const target = await packageRoot(resolve(root, "real"), ["antigravity", "claude", "codex"]);
    await writeFile(resolve(target, ".DS_Store"), "finder\n", "utf8");
    const rendering = async (request) => {
      if (request.args.includes("install")) await mkdir(resolve(target, "codex"), { recursive: true });
      return recorder().run(request);
    };
    const cleared = await runMain(["--mode", "fresh", "--package-root", target, "--apply"], { runProcess: rendering });
    assert.equal(cleared.code, 0, cleared.stderr + cleared.stdout);
    assert.match(cleared.stdout, /package-root-clear\s+completed — removed 5 entries/u);
    assert.ok(!existsSync(resolve(target, ".DS_Store")));

    const other = resolve(root, "other");
    await mkdir(other, { recursive: true });
    await writeFile(resolve(other, ".DS_Store"), "finder\n", "utf8");
    await writeFile(resolve(other, "notes.txt"), "operator data\n", "utf8");
    const runner = recorder();
    const refused = await runMain(["--mode", "fresh", "--package-root", other, "--apply"], { runProcess: runner.run });
    assert.notEqual(refused.code, 0);
    assert.match(refused.stdout + refused.stderr, /not-a-package-root[^\n]*does not write: notes\.txt;/u, "only the unknown entry is named");
    assert.equal(runner.calls.length, 0);
    assert.deepEqual((await readdir(other)).sort(), [".DS_Store", "notes.txt"]);
  });
});

test("a parent folder that holds a repository next to a package is refused and stays untouched", async () => {
  await withTempRoot(async (root) => {
    const parent = resolve(root, "workspaces");
    await packageRoot(parent);
    for (const entry of [".claude-plugin", ".git"]) await mkdir(resolve(parent, "other-repo", entry), { recursive: true });
    await writeFile(resolve(parent, "other-repo", "README.md"), "work\n", "utf8");
    const runner = recorder();
    const result = await runMain(["--mode", "fresh", "--package-root", parent, "--apply"], { runProcess: runner.run });

    assert.notEqual(result.code, 0);
    assert.match(result.stdout + result.stderr, /not-a-package-root[^\n]*other-repo/u);
    assert.equal(runner.calls.length, 0, "nothing may run before the refusal");
    assert.deepEqual((await readdir(parent)).sort(), ["other-repo", "package"]);
    assert.deepEqual((await readdir(resolve(parent, "other-repo"))).sort(), [".claude-plugin", ".git", "README.md"]);
  });
});

test("a package root that contains or sits inside the repository or a live product root is refused", async () => {
  await withTempRoot(async (root) => {
    const home = resolve(root, "home");
    const repositoryRoot = resolve(root, "workspaces", "all-about-agents");
    const env = { CLAUDE_CONFIG_DIR: resolve(root, "config", "claude") };
    for (const directory of [resolve(repositoryRoot, ".claude-plugin"), resolve(env.CLAUDE_CONFIG_DIR, ".all-about-agents"), resolve(home, ".codex", "package", ".all-about-agents")]) {
      await mkdir(directory, { recursive: true });
    }
    const candidates = [
      resolve(root, "workspaces"),
      resolve(repositoryRoot, "package"),
      resolve(root, "config"),
      resolve(home, ".codex", "package"),
      resolve(home, ".Claude")
    ];

    for (const candidate of candidates) {
      const runner = recorder();
      const result = await runMain(["--mode", "fresh", "--package-root", candidate, "--apply"], { runProcess: runner.run, homeDir: home, env, repositoryRoot });
      assert.notEqual(result.code, 0, `${candidate} must be refused`);
      assert.match(result.stdout + result.stderr, /unsafe-package-root/u, `${candidate} must be refused as overlapping a reserved root`);
      assert.equal(runner.calls.length, 0, `nothing may run for ${candidate}`);
    }
    assert.ok(existsSync(resolve(repositoryRoot, ".claude-plugin")), "the repository must stay untouched");
    assert.ok(existsSync(resolve(env.CLAUDE_CONFIG_DIR, ".all-about-agents")), "the product root must stay untouched");
  });
});

test("a product root reached through a symlink is still refused as a package root", async (t) => {
  await withTempRoot(async (root) => {
    const real = resolve(root, "real-codex");
    await mkdir(resolve(real, ".all-about-agents"), { recursive: true });
    const link = resolve(root, "codex-link");
    try {
      await symlink(real, link, "dir");
    } catch (error) {
      if (error?.code !== "EPERM" && error?.code !== "EACCES") throw error;
      t.skip(`symlink unavailable: ${error.code}`);
      return;
    }
    const runner = recorder();
    const result = await runMain(["--mode", "fresh", "--package-root", real, "--apply"], { runProcess: runner.run, env: { CODEX_HOME: link } });

    assert.notEqual(result.code, 0);
    assert.match(result.stdout + result.stderr, /unsafe-package-root/u);
    assert.equal(runner.calls.length, 0);
    assert.ok(existsSync(resolve(real, ".all-about-agents")));
  });
});

test("a path without package-root markers is refused before deletion", async () => {
  await withTempRoot(async (root) => {
    const target = resolve(root, "documents");
    await mkdir(target, { recursive: true });
    await writeFile(resolve(target, "notes.txt"), "personal\n", "utf8");

    const result = await runMain(["--mode", "fresh", "--package-root", target, "--apply"]);
    assert.notEqual(result.code, 0);
    assert.match(result.stdout + result.stderr, /not-a-package-root/u);
    assert.deepEqual(await readdir(target), ["notes.txt"], "an unrecognized directory must stay untouched");
  });
});

test("the home directory, every live product root, and every product root override are refused as package roots", async () => {
  await withTempRoot(async (root) => {
    const home = resolve(root, "home");
    const overrides = { AAA_ANTIGRAVITY_ROOT: resolve(root, "gemini-override"), CLAUDE_CONFIG_DIR: resolve(root, "claude-override"), CODEX_HOME: resolve(root, "codex-override") };
    const candidates = [home, resolve(home, ".claude"), resolve(home, ".codex"), resolve(home, ".gemini"), ...Object.values(overrides)];
    // Each candidate holds operator data next to a package marker. The error
    // code tells the reserved-root refusal apart from the unknown-entry one.
    for (const candidate of candidates) {
      await mkdir(resolve(candidate, ".all-about-agents"), { recursive: true });
      await writeFile(resolve(candidate, "live.txt"), "operator data\n", "utf8");
    }

    for (const candidate of candidates) {
      const runner = recorder();
      const result = await runMain(["--mode", "fresh", "--package-root", candidate, "--apply"], { runProcess: runner.run, homeDir: home, env: overrides });
      assert.notEqual(result.code, 0, `${candidate} must be refused`);
      assert.match(result.stdout + result.stderr, /unsafe-package-root|broad-root/u, `${candidate} must be refused as a reserved root`);
      assert.equal(runner.calls.length, 0, `nothing may run for ${candidate}`);
      assert.ok((await readdir(candidate)).includes("live.txt"), `${candidate} must stay untouched`);
    }
  });
});

test("a not-installed plugin is skipped while a failed install stops the run", async () => {
  await withTempRoot(async (root) => {
    const target = await packageRoot(root);
    const runner = recorder({ "plugin uninstall": { exitCode: 1, stderr: "plugin not installed" } });
    const skipped = await runMain(["--mode", "update", "--package-root", target, "--apply"], { runProcess: runner.run });
    assert.equal(skipped.code, 0, skipped.stderr + skipped.stdout);
    assert.match(skipped.stdout, /skipped/u);
    assert.ok(runner.calls.some((call) => call.args.includes("register")), "a tolerated skip must not stop the pipeline");

    const failing = recorder({ "aaa.mjs install": { exitCode: 1, stderr: "render failed" } });
    const stopped = await runMain(["--mode", "update", "--package-root", target, "--apply"], { runProcess: failing.run });
    assert.notEqual(stopped.code, 0);
    assert.match(stopped.stdout, /failed/u);
    assert.ok(!failing.calls.some((call) => call.args.includes("register")), "a failed install must stop the pipeline");
  });
});

test("the Codex source commit is skipped when its tree has no change", async () => {
  await withTempRoot(async (root) => {
    const target = await packageRoot(root);
    const clean = recorder({ "status --porcelain": { exitCode: 0, stdout: "" } });
    const result = await runMain(["--mode", "update", "--package-root", target, "--apply"], { runProcess: clean.run });

    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.ok(!clean.calls.some((call) => call.executable === "git" && call.args.includes("commit")), "a clean source tree needs no commit");
    assert.match(result.stdout, /codex-source-commit\s+skipped/u);
  });
});

test("a dry-run never initializes the Codex source repository", async () => {
  await withTempRoot(async (root) => {
    const target = await packageRoot(root);
    const runner = recorder();
    const result = await runMain(["--mode", "update", "--package-root", target], { runProcess: runner.run });

    assert.equal(result.code, 0, result.stderr);
    assert.ok(!runner.calls.some((call) => call.executable === "git"), "a dry-run must not run git at all");
    assert.match(result.stdout, /codex-source-commit\s+pending/u);
  });
});

test("the sync-status step reports one compact line and never blocks the run", async () => {
  await withTempRoot(async (root) => {
    const target = await packageRoot(root);
    const status = JSON.stringify({ branch: "main", relation: "behind", dirty: true, changedPaths: ["a", "b"], ahead: 0, behind: 3 }, null, 2);
    const runner = recorder({ "sync-status.mjs": { exitCode: 1, stdout: status } });
    const result = await runMain(["--mode", "update", "--package-root", target], { runProcess: runner.run });

    assert.equal(result.code, 0, result.stderr);
    const line = result.stdout.split("\n").find((entry) => entry.includes("repository-sync-status"));
    assert.ok(line, "the step must appear in the report");
    assert.ok(!line.includes("{"), "the raw JSON report must not be embedded");
    assert.match(line, /branch=main/u);
    assert.match(line, /relation=behind/u);
    assert.match(line, /dirty=true/u);
  });
});

test("a fresh dry-run does not judge the Codex source it is about to replace", async () => {
  await withTempRoot(async (root) => {
    const target = await packageRoot(root);
    const runner = recorder({ "status --porcelain": { exitCode: 0, stdout: "" } });
    const result = await runMain(["--mode", "fresh", "--package-root", target], { runProcess: runner.run });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /codex-source-commit\s+pending/u, "the current source is replaced first, so its state says nothing");
  });
});

test("a failed render leaves the installed plugin in place", async () => {
  await withTempRoot(async (root) => {
    const target = await packageRoot(root);
    const runner = recorder({ "aaa.mjs install": { exitCode: 1, stdout: JSON.stringify({ action: "install", error: "render validation failed" }) } });
    const result = await runMain(["--mode", "update", "--package-root", target, "--apply"], { runProcess: runner.run });

    assert.notEqual(result.code, 0);
    assert.match(result.stdout, /package-install\s+failed — render validation failed/u, "the report must name the render failure");
    const removals = runner.calls.filter((call) => call.args.includes("uninstall") || call.args.includes("remove"));
    assert.deepEqual(removals, [], "the working installation must survive a failed render");
  });
});

test("update is blocked when the package root holds a state this version cannot read", async () => {
  await withTempRoot(async (root) => {
    const target = await packageRoot(root);
    const legacyPlan = JSON.stringify({
      plans: [{
        diagnostics: [{ code: "invalid-previous-state", severity: "warning", message: "Previous managed state is missing or malformed; pruning is disabled." }],
        actions: [{ kind: "replace" }, { kind: "unchanged" }]
      }]
    });
    const runner = recorder({ "aaa.mjs install": { exitCode: 0, stdout: legacyPlan } });
    const result = await runMain(["--mode", "update", "--package-root", target], { runProcess: runner.run });

    assert.equal(result.code, 1, "a blocked plan must not report success");
    assert.match(result.stdout, /package-install\s+blocked/u);
    assert.match(result.stdout, /--mode fresh/u, "the report must name the remedy");
    assert.ok(runner.calls.some((call) => call.args.includes("--dry-run")), "the preview must run the real planner");
    assert.ok(!runner.calls.some((call) => call.args.includes("--apply")), "a preview must never apply");
  });
});

test("a surface subset is refused inside a root this repository already manages as a whole", async () => {
  await withTempRoot(async (root) => {
    const target = await packageRoot(root);

    const runner = recorder();
    const refused = await runMain(["--mode", "update", "--surface", "antigravity", "--package-root", target], { runProcess: runner.run });
    assert.notEqual(refused.code, 0, "a subset render would write a second managed state that shadows this one");
    assert.match(`${refused.stdout}${refused.stderr}`, /surface-subset-in-managed-root/u);
    assert.equal(runner.calls.length, 0, "nothing may run before the refusal");

    const accepted = await runMain(["--mode", "update", "--surface", "all", "--package-root", target], { runProcess: recorder().run });
    assert.doesNotMatch(`${accepted.stdout}${accepted.stderr}`, /surface-subset-in-managed-root/u, "the whole-root selection stays allowed");
  });
});

test("a registration that exits zero while refusing a guarded file is not reported as a plain success", async () => {
  await withTempRoot(async (root) => {
    const target = await packageRoot(root, ["antigravity", "claude", "codex"]);

    const refusedDeploy = JSON.stringify({
      action: "register",
      status: "complete",
      actions: [
        { id: "antigravity-instructions-deploy", kind: "file-copy", status: "manual-required" },
        { id: "antigravity-plugin-install", kind: "process", status: "complete" }
      ]
    });
    const runner = recorder({ "register --surface antigravity": { stdout: refusedDeploy } });
    const result = await runMain(["--mode", "update", "--surface", "all", "--package-root", target, "--apply", "--format", "json"], { runProcess: runner.run });

    const report = JSON.parse(result.stdout);
    const step = (report.steps ?? []).find((entry) => entry.id === "register-antigravity");
    assert.ok(step, "the antigravity registration must be reported");
    assert.match(
      step.reason ?? "",
      /manual follow-up: antigravity-instructions-deploy/u,
      "a refused no-clobber deploy must be visible in the summary, not hidden behind exit code 0"
    );
  });
});

test("a missing product CLI is not run, and every later surface still removes and registers its own plugin", async () => {
  await withTempRoot(async (root) => {
    const target = await packageRoot(root, ["antigravity", "claude", "codex"]);
    const agyMissing = JSON.stringify({
      action: "register",
      status: "partial",
      completed: [{ id: "antigravity-instructions-deploy" }],
      error: { code: "native-executable-unavailable", message: "agy is unavailable; install it and retry registration" }
    });
    const runner = recorder({
      "agy plugin uninstall": { unavailable: true, exitCode: null },
      [registerApply("antigravity")]: { exitCode: 1, stdout: agyMissing }
    });
    const result = await runMain(["--mode", "update", "--surface", "all", "--package-root", target, "--apply", "--format", "json"], { runProcess: runner.run });

    assert.equal(result.code, 0, result.stderr + result.stdout);
    const steps = stepsById(JSON.parse(result.stdout));
    assert.equal(steps["plugin-uninstall-antigravity"].status, "not-run-unavailable");
    assert.equal(steps["register-antigravity"].status, "not-run-unavailable");
    assert.match(steps["register-antigravity"].reason, /agy is unavailable[\s\S]*1 earlier action\(s\) completed/u, "a write made before the stop must be visible");
    assert.equal(steps["register-claude"].status, "completed");
    assert.equal(steps["register-codex"].status, "completed");
    assert.deepEqual(pluginLifecycle(runner.calls), [
      "preview antigravity",
      "agy plugin uninstall",
      "register antigravity",
      "preview claude",
      "claude plugin uninstall",
      "register claude",
      "preview codex",
      "codex plugin remove",
      "register codex"
    ], "each product must be previewed, then removed right before its own registration");
    const claudeRemoval = runner.calls.find((call) => call.executable === "claude" && call.args[1] === "uninstall");
    assert.deepEqual(claudeRemoval.args, ["plugin", "uninstall", "all-about-agents@all-about-agents", "--scope", "user", "--keep-data"], "the removal must keep the plugin's persistent data");
  });
});

test("a failed registration stops the run before the next product loses its plugin", async () => {
  await withTempRoot(async (root) => {
    const target = await packageRoot(root, ["antigravity", "claude", "codex"]);
    const runner = recorder({ [registerApply("antigravity")]: { exitCode: 1, stderr: "antigravity-plugin-validate exited with code 1" } });
    const result = await runMain(["--mode", "update", "--surface", "all", "--package-root", target, "--apply", "--format", "json"], { runProcess: runner.run });

    assert.equal(result.code, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(stepsById(report)["register-antigravity"].status, "failed");
    assert.deepEqual(pluginLifecycle(runner.calls), ["preview antigravity", "agy plugin uninstall", "register antigravity"], "Claude and Codex must keep their installed plugin");
    for (const id of ["plugin-uninstall-claude", "register-claude", "plugin-remove-codex", "register-codex"]) {
      assert.ok(report.notAttempted.includes(id), `${id} must be listed as not attempted`);
    }
  });
});

test("a registration that ends with a required manual step goes on to the next surface and ends nonzero", async () => {
  await withTempRoot(async (root) => {
    const target = await packageRoot(root, ["antigravity", "claude", "codex"]);
    const denyInvalid = "settings.json permissions.deny is not a list; merge the managed rules by hand";
    const claudeManual = JSON.stringify({
      action: "register",
      status: "manual-required",
      actions: [
        { id: "claude-settings-deploy", kind: "settings-overlay", status: "manual-required", reason: denyInvalid },
        { id: "claude-plugin-install", kind: "process", status: "complete" },
        { id: "claude-reload", kind: "manual", status: "manual-required", message: "Restart Claude Code or reload the plugin before checking native behavior." }
      ],
      error: { code: "manual-step-required", message: denyInvalid }
    });
    const codexStale = JSON.stringify({
      action: "register",
      status: "manual-required",
      actions: [{ id: "codex-plugin-source-check", kind: "git-source-check", status: "manual-required", reason: "the Codex clone is older than the package source" }],
      error: { code: "installed-copy-not-confirmed", message: "the Codex clone is older than the package source" }
    });
    const runner = recorder({
      [registerApply("claude")]: { exitCode: 1, stdout: claudeManual },
      [registerApply("codex")]: { exitCode: 1, stdout: codexStale }
    });
    const result = await runMain(["--mode", "update", "--surface", "all", "--package-root", target, "--apply", "--format", "json"], { runProcess: runner.run });

    assert.equal(result.code, 1, "a manual follow-up left behind must not look like success");
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "manual-required");
    assert.deepEqual(report.notAttempted, [], "a manual follow-up must not stop the run");
    const steps = stepsById(report);
    assert.equal(steps["register-claude"].status, "manual-required");
    assert.match(steps["register-claude"].reason, /claude-settings-deploy \(settings\.json permissions\.deny is not a list[^)]*\); claude-reload \(Restart Claude Code/u);
    assert.equal(steps["register-codex"].status, "manual-required");
    assert.match(steps["register-codex"].reason, /codex-plugin-source-check \(the Codex clone is older/u);
    assert.deepEqual(pluginLifecycle(runner.calls).slice(-4), ["register claude", "preview codex", "codex plugin remove", "register codex"], "Codex must still be removed and registered");
    assert.ok(runner.calls.some((call) => call.executable === "codex" && call.args.join(" ") === "plugin list"), "the verify steps must still run");

    const text = await runMain(["--mode", "update", "--surface", "all", "--package-root", target, "--apply"], { runProcess: runner.run });
    assert.equal(text.code, 1);
    assert.match(text.stdout, /status=manual-required/u);
    assert.match(text.stdout, /register-claude\s+manual-required — 2 step\(s\) need a manual follow-up: claude-settings-deploy/u);
    assert.match(text.stdout, /Next: do the manual follow-up steps listed above, then rerun\./u);

    const unknown = recorder({ [registerApply("claude")]: { exitCode: 1, stdout: JSON.stringify({ action: "register", status: "manual-required", actions: [], error: { code: "something-else", message: "unexpected" } }) } });
    const stopped = await runMain(["--mode", "update", "--surface", "all", "--package-root", target, "--apply", "--format", "json"], { runProcess: unknown.run });
    assert.equal(stepsById(JSON.parse(stopped.stdout))["register-claude"].status, "failed", "an unknown error code must fail closed");
    assert.ok(!unknown.calls.some((call) => call.executable === "codex" && call.args[1] === "remove"), "a failed registration must stop before Codex");
  });
});

test("a refused no-clobber deploy that registration marks as a required manual step ends setup manual-required", async () => {
  await withTempRoot(async (root) => {
    const target = await packageRoot(root, ["antigravity", "claude", "codex"]);
    const refused = "GEMINI.md already exists and differs from the managed source; merge the managed keys by hand instead of overwriting unowned content";
    const antigravityManual = JSON.stringify({
      action: "register",
      status: "manual-required",
      actions: [{ id: "antigravity-instructions-deploy", kind: "file-copy", status: "manual-required", reason: refused }],
      error: { code: "manual-step-required", message: refused }
    });
    const runner = recorder({ [registerApply("antigravity")]: { exitCode: 1, stdout: antigravityManual } });
    const result = await runMain(["--mode", "update", "--surface", "all", "--package-root", target, "--apply", "--format", "json"], { runProcess: runner.run });

    assert.equal(result.code, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "manual-required");
    const steps = stepsById(report);
    assert.match(steps["register-antigravity"].reason, /antigravity-instructions-deploy \(GEMINI\.md already exists/u);
    assert.equal(steps["register-claude"].status, "completed");
    assert.equal(steps["register-codex"].status, "completed");
  });
});

test("a failed registration preview stops the run before that product loses its plugin", async () => {
  await withTempRoot(async (root) => {
    const target = await packageRoot(root, ["antigravity", "claude", "codex"]);
    const planFailure = JSON.stringify({ status: "fail", error: { code: "invalid-root", message: "productRoot must be absolute; resolve repository-relative CLI input before planning" } });
    const runner = recorder({ [registerPreview("claude")]: { exitCode: 1, stdout: planFailure } });
    const result = await runMain(["--mode", "update", "--surface", "all", "--package-root", target, "--apply", "--format", "json"], { runProcess: runner.run });

    assert.equal(result.code, 1);
    const report = JSON.parse(result.stdout);
    const preview = stepsById(report)["register-preview-claude"];
    assert.equal(preview.status, "failed");
    assert.match(preview.reason, /productRoot must be absolute/u);
    assert.deepEqual(pluginLifecycle(runner.calls), ["preview antigravity", "agy plugin uninstall", "register antigravity", "preview claude"], "Claude must keep its installed plugin");
    for (const id of ["plugin-uninstall-claude", "register-claude", "plugin-remove-codex", "register-codex"]) {
      assert.ok(report.notAttempted.includes(id), `${id} must be listed as not attempted`);
    }
  });
});

test("fresh with a surface subset clears only the selected surface folders", async () => {
  await withTempRoot(async (root) => {
    const target = resolve(root, "package");
    for (const surface of ["claude", "codex"]) {
      await mkdir(resolve(target, surface, ".all-about-agents"), { recursive: true });
      await writeFile(resolve(target, surface, ".all-about-agents", "state.json"), `{"surface":"${surface}"}\n`, "utf8");
    }
    await mkdir(resolve(target, "codex", ".git"), { recursive: true });
    await writeFile(resolve(target, "codex", ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
    await writeFile(resolve(target, ".DS_Store"), "finder\n", "utf8");
    const runner = recorder();
    const result = await runMain(["--mode", "fresh", "--surface", "claude", "--package-root", target, "--apply"], { runProcess: runner.run });

    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /package-root-clear\s+completed — removed 2 entries/u);
    assert.deepEqual((await readdir(target)).sort(), ["codex"], "only the selected surface and Finder metadata are cleared");
    assert.equal(await readFile(resolve(target, "codex", ".git", "HEAD"), "utf8"), "ref: refs/heads/main\n", "the Codex source repository must survive");
    assert.equal(await readFile(resolve(target, "codex", ".all-about-agents", "state.json"), "utf8"), '{"surface":"codex"}\n');
  });
});

test("a symlinked surface marker does not make a folder clearable", async (t) => {
  await withTempRoot(async (root) => {
    const target = resolve(root, "package");
    const elsewhere = resolve(root, "elsewhere-state");
    await mkdir(resolve(target, "claude"), { recursive: true });
    await mkdir(elsewhere, { recursive: true });
    try {
      await symlink(elsewhere, resolve(target, "claude", ".all-about-agents"), "junction");
    } catch (error) {
      if (error?.code !== "EPERM" && error?.code !== "EACCES") throw error;
      t.skip(`symlink unavailable: ${error.code}`);
      return;
    }
    const runner = recorder();
    const result = await runMain(["--mode", "fresh", "--surface", "claude", "--package-root", target, "--apply"], { runProcess: runner.run });

    assert.notEqual(result.code, 0);
    assert.match(result.stdout + result.stderr, /not-a-package-root[^\n]*does not write: claude;/u);
    assert.equal(runner.calls.length, 0);
    assert.deepEqual(await readdir(resolve(target, "claude")), [".all-about-agents"]);
  });
});

test("step evidence collapses every whitespace run into one line", async () => {
  await withTempRoot(async (root) => {
    const target = await packageRoot(root);
    const runner = recorder({ "aaa.mjs install": { exitCode: 1, stderr: "sync stopped\n\n  at   step two" } });
    const result = await runMain(["--mode", "update", "--package-root", target, "--apply", "--format", "json"], { runProcess: runner.run });

    assert.equal(stepsById(JSON.parse(result.stdout))["package-install"].reason, "sync stopped at step two");
  });
});

test("the help lists every surface the parser accepts", async () => {
  const result = await runMain(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /--surface antigravity\|claude\|codex\|all\s/u);
});

test("the Codex source commit runs git without inherited GIT_* variables", async () => {
  await withTempRoot(async (root) => {
    const target = await packageRoot(root);
    const runner = recorder({ "status --porcelain": { stdout: " M plugin.json\n" } });
    const env = { GIT_DIR: resolve(root, "elsewhere"), git_work_tree: resolve(root, "elsewhere"), PATH: "/usr/bin" };
    const result = await runMain(["--mode", "update", "--package-root", target, "--apply"], { runProcess: runner.run, env });

    assert.equal(result.code, 0, result.stderr + result.stdout);
    const gitCalls = runner.calls.filter((call) => call.executable === "git");
    assert.ok(gitCalls.some((call) => call.args.includes("commit")), "the changed source must be committed");
    for (const call of gitCalls) {
      assert.equal(call.env?.PATH, "/usr/bin", `git ${call.args.join(" ")} must keep the rest of the environment`);
      assert.deepEqual(Object.keys(call.env).filter((key) => /^GIT_/iu.test(key)), [], `git ${call.args.join(" ")} must not inherit a GIT_* variable`);
    }
  });
});

test("the whole root is refused over a per-surface managed state unless fresh clears it first", async () => {
  await withTempRoot(async (root) => {
    const target = resolve(root, "package");
    await mkdir(resolve(target, "claude", ".all-about-agents"), { recursive: true });
    await writeFile(resolve(target, "claude", ".all-about-agents", "state.json"), "{}\n", "utf8");

    const runner = recorder();
    const refused = await runMain(["--mode", "update", "--surface", "all", "--package-root", target], { runProcess: runner.run });
    assert.notEqual(refused.code, 0, "registration would keep reading the stale nested state");
    assert.match(`${refused.stdout}${refused.stderr}`, /whole-root-in-surface-managed-root[\s\S]*--mode fresh/u);
    assert.equal(runner.calls.length, 0, "nothing may run before the refusal");

    const fresh = await runMain(["--mode", "fresh", "--surface", "all", "--package-root", target], { runProcess: recorder().run });
    assert.equal(fresh.code, 0, fresh.stderr + fresh.stdout);
    assert.match(fresh.stdout, /package-root-clear\s+pending/u, "fresh clears the nested state before the whole-root render");
  });
});

test("the script runs when it is started through a symlink", async (t) => {
  await withTempRoot(async (root) => {
    const link = resolve(root, "setup.mjs");
    try {
      await symlink(SETUP_SCRIPT, link);
    } catch (error) {
      if (error?.code !== "EPERM" && error?.code !== "EACCES") throw error;
      t.skip(`symlink unavailable: ${error.code}`);
      return;
    }
    const result = spawnSync(process.execPath, [link, "--help"], { encoding: "utf8", shell: false });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Usage: node scripts\/setup\.mjs/u);

    // With --preserve-symlinks-main the module URL keeps the link path, so both
    // sides of the comparison must be resolved.
    const linkedCheckout = resolve(root, "checkout");
    try {
      await symlink(resolve(SETUP_SCRIPT, "..", ".."), linkedCheckout, "junction");
    } catch (error) {
      if (error?.code !== "EPERM" && error?.code !== "EACCES") throw error;
      t.skip(`symlink unavailable: ${error.code}`);
      return;
    }
    try {
      const preserved = spawnSync(process.execPath, ["--preserve-symlinks-main", resolve(linkedCheckout, "scripts", "setup.mjs"), "--help"], { encoding: "utf8", shell: false });
      assert.equal(preserved.status, 0, preserved.stderr);
      assert.match(preserved.stdout, /^Usage: node scripts\/setup\.mjs/u);
    } finally {
      // Unlink the live-repository link before withTempRoot deletes the root recursively.
      await rm(linkedCheckout, { force: true, recursive: false });
    }
  });
});
