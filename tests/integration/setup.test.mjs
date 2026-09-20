import assert from "node:assert/strict";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

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

async function runMain(argv, { runProcess } = {}) {
  const output = collector();
  const errorOutput = collector();
  const code = await main(argv, output, errorOutput, runProcess ? { runProcess } : {});
  return { code, stdout: output.text(), stderr: errorOutput.text() };
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
    if (step.kind !== "command") continue;
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
  });
});

test("fresh --apply empties the package root and keeps the root itself", async () => {
  await withTempRoot(async (root) => {
    const target = await packageRoot(root, ["claude", "codex", "retired-surface"]);
    const runner = recorder();
    // The real install recreates the surface directories the later steps read.
    const rendering = async (request) => {
      const result = await runner.run(request);
      if (request.args.includes("install")) await mkdir(resolve(target, "codex"), { recursive: true });
      return result;
    };
    const result = await runMain(["--mode", "fresh", "--package-root", target, "--apply"], { runProcess: rendering });

    assert.equal(result.code, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /package-root-clear\s+completed — removed 4 entries/u);
    const remaining = await readdir(target);
    assert.ok(!remaining.includes("retired-surface"), "a render from a removed surface must not survive");
    assert.ok(!remaining.includes(".all-about-agents"), "the previous managed state must not survive");
    const installed = runner.calls.some((call) => call.args.includes("install") && call.args.includes("--apply"));
    assert.ok(installed, "the clear step must be followed by a real install");
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

test("the home directory and a live product root are refused as package roots", async () => {
  for (const candidate of [homedir(), resolve(homedir(), ".claude"), resolve(homedir(), ".codex")]) {
    const result = await runMain(["--mode", "fresh", "--package-root", candidate, "--apply"]);
    assert.notEqual(result.code, 0, `${candidate} must be refused`);
    assert.match(result.stdout + result.stderr, /unsafe-package-root|broad-root/u);
  }
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
