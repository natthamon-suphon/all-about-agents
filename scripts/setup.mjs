#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, normalize, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertSafeDestinationRoot } from "../installers/lib/roots.mjs";
import { runProcess as defaultRunProcess } from "./lib/process-runner.mjs";
import { SURFACES as SUPPORTED_SURFACES } from "../adapters/shared/surfaces.mjs";

const MODES = new Set(["fresh", "update"]);
const SURFACES = SUPPORTED_SURFACES;
// A surface is not always its binary: the Antigravity CLI is `agy`.
const SURFACE_EXECUTABLES = Object.freeze({ antigravity: "agy", claude: "claude", codex: "codex" });
const PROFILES = new Set(["portable", "template"]);
const FORMATS = new Set(["text", "json"]);
const PLUGIN_ID = "all-about-agents@all-about-agents";
// agy uninstalls by plain plugin name; Claude and Codex use the marketplace id.
const SURFACE_PLUGIN_IDS = Object.freeze({ antigravity: "all-about-agents", claude: PLUGIN_ID, codex: PLUGIN_ID });
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = resolve(REPOSITORY_ROOT, "scripts", "aaa.mjs");
const SYNC_STATUS = resolve(REPOSITORY_ROOT, "scripts", "sync-status.mjs");
// A rendered package root always carries the managed state directory or a
// product plugin manifest. Requiring one of them keeps a mistyped path from
// being cleared.
const ROOT_MARKERS = Object.freeze([".all-about-agents", ".claude-plugin", ".codex-plugin"]);

export class SetupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SetupError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new SetupError(code, message);
}

function optionValue(token, argv, index) {
  const equals = token.indexOf("=");
  if (equals >= 0) return { name: token.slice(0, equals), value: token.slice(equals + 1), consumed: 0 };
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) fail("missing-value", `Missing value for ${token}`);
  return { name: token, value, consumed: 1 };
}

function expandHome(value, homeDir) {
  if (value === "~") return homeDir;
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(homeDir, value.slice(2));
  return value;
}

/** Parse the setup arguments. Parsing is pure and never touches the filesystem. */
export function parseSetupArgs(argv, { homeDir = homedir(), cwd = process.cwd() } = {}) {
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== "string")) fail("invalid-argv", "argv must be an array of strings");

  let mode = null;
  let surfaces = null;
  let profile = "template";
  let apply = false;
  let packageRoot = null;
  let statuslineName = null;
  let format = "text";

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "-h" || token === "--help") fail("help-requested", "Help requested");
    if (token === "--apply") {
      apply = true;
      continue;
    }
    if (token === "--dry-run") {
      apply = false;
      continue;
    }
    if (!token.startsWith("--")) fail("unexpected-argument", `Unexpected argument: ${token}`);
    const parsed = optionValue(token, argv, index);
    index += parsed.consumed;
    const { name, value } = parsed;
    switch (name) {
      case "--mode":
        if (!MODES.has(value)) fail("invalid-mode", `--mode must be fresh or update; received ${value}`);
        mode = value;
        break;
      case "--surface":
        if (value === "all") surfaces = [...SURFACES];
        else if (SURFACES.includes(value)) surfaces = [value];
        else fail("invalid-surface", `--surface must be one of ${[...SURFACES, "all"].join(", ")}`);
        break;
      case "--profile":
        if (!PROFILES.has(value)) fail("invalid-profile", "--profile must be portable or template");
        profile = value;
        break;
      case "--package-root":
        if (value.trim() === "" || value.includes("\0")) fail("invalid-package-root", "--package-root must be a non-empty path");
        packageRoot = value;
        break;
      case "--statusline-name":
        statuslineName = value.trim();
        break;
      case "--format":
        if (!FORMATS.has(value)) fail("invalid-format", "--format must be text or json");
        format = value;
        break;
      default:
        fail("unknown-option", `Unknown option: ${name}`);
    }
  }

  if (mode === null) fail("mode-required", "--mode is required; choose fresh (clear and reinstall) or update (sync from this checkout)");
  const selected = packageRoot === null ? join(homeDir, ".all-about-agents", "package") : expandHome(packageRoot, homeDir);
  return Object.freeze({
    mode,
    surfaces: Object.freeze(surfaces ?? [...SURFACES]),
    profile,
    apply,
    format,
    statuslineName,
    packageRoot: resolve(cwd, selected)
  });
}

function comparable(value) {
  const normalized = normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function assertPackageRootIsSafe(root, { homeDir, env }) {
  assertSafeDestinationRoot(root, { homeDir, allowedProductRoots: [root] });
  const reserved = [
    join(homeDir, ".claude"),
    join(homeDir, ".codex"),
    REPOSITORY_ROOT,
    typeof env.CLAUDE_CONFIG_DIR === "string" && env.CLAUDE_CONFIG_DIR.trim() !== "" ? resolve(env.CLAUDE_CONFIG_DIR) : null,
    typeof env.CODEX_HOME === "string" && env.CODEX_HOME.trim() !== "" ? resolve(env.CODEX_HOME) : null
  ].filter((value) => value !== null);
  if (reserved.some((value) => comparable(value) === comparable(root))) {
    fail("unsafe-package-root", "the package root may not be a live product root or this repository; it is a separate directory the products point at");
  }
}

async function assertClearable(root) {
  if (!existsSync(root)) return [];
  const entries = await readdir(root);
  if (entries.length === 0) return [];
  const markers = new Set(ROOT_MARKERS);
  const recognized = entries.some((entry) => markers.has(entry))
    || (await Promise.all(entries.map(async (entry) => ROOT_MARKERS.some((marker) => existsSync(join(root, entry, marker)))))).some(Boolean);
  if (!recognized) {
    fail("not-a-package-root", `${root} holds no rendered package marker; refusing to clear a directory this installer does not own`);
  }
  return entries;
}

async function renderedStatuslineName(root) {
  const configPath = join(root, "claude", "all-about-agents", "statusline.json");
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8"));
    return typeof parsed?.displayName === "string" && parsed.displayName.trim() !== "" ? parsed.displayName : null;
  } catch {
    return null;
  }
}

function command(id, title, executable, args, extra = {}) {
  return { id, title, kind: "command", executable, args, mutates: false, tolerate: false, ...extra };
}

/**
 * Build the ordered step list for one setup run. The plan is pure: it names
 * every program and argument without resolving product state or spawning work.
 */
export function planSetup({ mode, surfaces, profile, packageRoot, statuslineName = null } = {}) {
  if (!MODES.has(mode)) fail("invalid-mode", "planSetup requires mode fresh or update");
  const selected = Array.isArray(surfaces) && surfaces.length > 0 ? surfaces : [...SURFACES];
  const steps = [];

  steps.push(command("repository-validate", "Validate this checkout renders both profiles", process.execPath, [CLI, "validate", "--scope", "all", "--format", "json"], { cwd: REPOSITORY_ROOT }));
  steps.push(command("repository-sync-status", "Report how this checkout compares with its upstream", process.execPath, [SYNC_STATUS, "--format", "json"], { cwd: REPOSITORY_ROOT, kind: "sync-status", tolerate: true }));

  if (mode === "fresh") {
    steps.push({ id: "package-root-clear", title: "Remove every previous render from the package root", kind: "clear", mutates: true, tolerate: false });
  }

  // `--surface all` namespaces each package under the root by itself. A subset
  // must ask for the same layout explicitly, or the render would land at the
  // root while registration below looks for `<root>/<surface>`.
  const statuslineArgs = typeof statuslineName === "string" && statuslineName !== "" ? ["--statusline-name", statuslineName] : [];
  if (selected.length === SURFACES.length) {
    const installArgs = [CLI, "install", "--surface", "all", "--profile", profile, "--destination-root", packageRoot, ...statuslineArgs, "--apply", "--format", "json"];
    steps.push(command("package-install", "Render this checkout into the package root", process.execPath, installArgs, { cwd: REPOSITORY_ROOT, kind: "install", mutates: true }));
  } else {
    for (const surface of selected) {
      const installArgs = [CLI, "install", "--surface", surface, "--profile", profile, "--destination-root", join(packageRoot, surface), ...(surface === "claude" ? statuslineArgs : []), "--apply", "--format", "json"];
      steps.push(command(`package-install-${surface}`, `Render this checkout into the ${surface} package namespace`, process.execPath, installArgs, { cwd: REPOSITORY_ROOT, kind: "install", mutates: true }));
    }
  }

  if (selected.includes("codex")) {
    steps.push({ id: "codex-source-commit", title: "Commit the Codex plugin source so its clone serves the new render", kind: "codex-source", mutates: true, tolerate: false });
  }

  // Both products serve a cached snapshot, and a version-keyed cache does not
  // refresh in place, so the old installation is removed first. This runs after
  // the render: a failed render must leave the working installation alone.
  if (selected.includes("claude")) {
    steps.push(command("plugin-uninstall-claude", "Remove the installed Claude plugin", "claude", ["plugin", "uninstall", PLUGIN_ID], { mutates: true, tolerate: true }));
  }
  if (selected.includes("codex")) {
    steps.push(command("plugin-remove-codex", "Remove the installed Codex plugin", "codex", ["plugin", "remove", PLUGIN_ID], { mutates: true, tolerate: true }));
  }
  if (selected.includes("antigravity")) {
    steps.push(command("plugin-uninstall-antigravity", "Remove the installed Antigravity plugin", SURFACE_EXECUTABLES.antigravity, ["plugin", "uninstall", SURFACE_PLUGIN_IDS.antigravity], { mutates: true, tolerate: true }));
  }

  for (const surface of selected) {
    steps.push(command(`register-${surface}`, `Register the ${surface} package with its product`, process.execPath, [CLI, "register", "--surface", surface, "--profile", profile, "--package-root", join(packageRoot, surface), "--apply", "--format", "json"], { cwd: REPOSITORY_ROOT, mutates: true }));
  }
  for (const surface of selected) {
    steps.push(command(`verify-${surface}`, `List the plugins ${surface} reports`, SURFACE_EXECUTABLES[surface], ["plugin", "list"], { tolerate: true }));
  }

  return { schemaVersion: 1, mode, profile, packageRoot, surfaces: [...selected], steps };
}

function oneLine(value, limit = 160) {
  const collapsed = String(value ?? "").replace(/s+/gu, " ").trim();
  return collapsed.length > limit ? `${collapsed.slice(0, limit - 1)}…` : collapsed;
}

function evidenceOf(result) {
  try {
    const parsed = JSON.parse(result.stdout);
    const reported = parsed?.error;
    if (reported) return oneLine(typeof reported === "string" ? reported : reported.message ?? JSON.stringify(reported));
  } catch {
    // Not a report; fall back to the raw streams below.
  }
  return oneLine((result.stderr || "").trim() || (result.stdout || "").trim() || `exit ${String(result.exitCode)}`);
}

// The checkout state is reported, never enforced: a dirty or behind tree is
// information the operator acts on, not a reason to stop installing.
async function reportSyncStatus(step, run) {
  const result = await run({ executable: step.executable, args: step.args, cwd: step.cwd });
  if (result.unavailable) return { status: "not-run-unavailable", reason: "node is not on PATH" };
  let parsed = null;
  try { parsed = JSON.parse(result.stdout); } catch { parsed = null; }
  if (parsed === null) return { status: "skipped", reason: evidenceOf(result) };
  const changed = Array.isArray(parsed.changedPaths) ? parsed.changedPaths.length : 0;
  const behind = parsed.relation === "behind" ? "; pull before installing" : "";
  return { status: "completed", reason: `branch=${parsed.branch ?? "unknown"} relation=${parsed.relation ?? "unknown"} dirty=${String(parsed.dirty === true)} changed=${String(changed)}${behind}` };
}

async function verifyPluginList(step, run) {
  const result = await run({ executable: step.executable, args: step.args, cwd: step.cwd });
  if (result.unavailable) return { status: "not-run-unavailable", reason: `${step.executable} is not on PATH` };
  if (result.exitCode !== 0) return { status: "skipped", reason: evidenceOf(result) };
  const listed = `${result.stdout}`.includes("all-about-agents");
  return { status: "completed", reason: listed ? "the product lists all-about-agents" : "the product does not list all-about-agents yet" };
}

async function runCommandStep(step, run) {
  const result = await run({ executable: step.executable, args: step.args, cwd: step.cwd });
  if (result.unavailable) return { status: "not-run-unavailable", reason: `${step.executable} is not on PATH` };
  if (result.timedOut) return { status: "failed", reason: `${step.executable} timed out` };
  if (result.exitCode !== 0) return { status: step.tolerate ? "skipped" : "failed", reason: evidenceOf(result) };
  return { status: "completed", reason: null, evidence: (result.stdout || "").trim().split("\n").at(-1) ?? "" };
}

// A registration can exit 0 while refusing to write a guarded file: a
// no-clobber destination that already differs reports `manual-required` and is
// skipped. Reporting only the exit code hides that, and the operator is left
// believing a file was deployed when it was not.
async function reportRegistration(step, run) {
  const result = await run({ executable: step.executable, args: step.args, cwd: step.cwd });
  if (result.unavailable) return { status: "not-run-unavailable", reason: `${step.executable} is not on PATH` };
  if (result.timedOut) return { status: "failed", reason: `${step.executable} timed out` };
  if (result.exitCode !== 0) return { status: step.tolerate ? "skipped" : "failed", reason: evidenceOf(result) };

  let report = null;
  try { report = JSON.parse(result.stdout); } catch { report = null; }
  const actions = Array.isArray(report?.actions) ? report.actions : [];
  const manual = actions.filter((action) => action?.status === "manual-required");
  if (manual.length === 0) return { status: "completed", reason: null, evidence: (result.stdout || "").trim().split("\n").at(-1) ?? "" };
  const ids = manual.map((action) => action.id).join(", ");
  return { status: "completed", reason: `${manual.length} step(s) need a manual follow-up: ${ids}` };
}

function planCounts(report) {
  const plans = Array.isArray(report?.plans) ? report.plans : [];
  const counts = new Map();
  let unreadableState = false;
  let rejected = false;
  for (const plan of plans) {
    for (const diagnostic of plan.diagnostics ?? []) {
      if (diagnostic.code === "invalid-previous-state") unreadableState = true;
    }
    for (const action of plan.actions ?? []) {
      counts.set(action.kind, (counts.get(action.kind) ?? 0) + 1);
      if (action.kind === "reject") rejected = true;
    }
  }
  const summary = [...counts].map(([kind, total]) => `${kind}=${String(total)}`).join(" ");
  return { summary, unreadableState, rejected };
}

// An update keeps the existing package root, so its plan is worth showing
// before the operator commits to a mutating run.
async function previewInstall(step, run) {
  const args = step.args.map((arg) => (arg === "--apply" ? "--dry-run" : arg));
  const result = await run({ executable: step.executable, args, cwd: step.cwd });
  if (result.unavailable) return { status: "not-run-unavailable", reason: "node is not on PATH" };
  let report = null;
  try { report = JSON.parse(result.stdout); } catch { report = null; }
  if (report === null) return { status: result.exitCode === 0 ? "pending" : "failed", reason: evidenceOf(result) };
  const { summary, unreadableState, rejected } = planCounts(report);
  if (unreadableState || rejected) {
    return { status: "blocked", reason: "this version cannot read the managed state in the package root; rerun with --mode fresh" };
  }
  if (result.exitCode !== 0) return { status: "failed", reason: evidenceOf(result) };
  return { status: "pending", reason: summary === "" ? "no change planned" : summary };
}

async function clearPackageRoot(root, apply) {
  const entries = await assertClearable(root);
  if (entries.length === 0) return { status: "completed", reason: "the package root is already empty" };
  if (!apply) return { status: "pending", reason: `${String(entries.length)} entries would be removed` };
  for (const entry of entries) await rm(join(root, entry), { recursive: true, force: true });
  return { status: "completed", reason: `removed ${String(entries.length)} entries` };
}

async function commitCodexSource(root, run, apply, mode) {
  const cwd = join(root, "codex");
  // A fresh run replaces this tree before the commit step, so its current
  // state carries no information for the plan.
  if (!apply && mode === "fresh") return { status: "pending", reason: "the freshly rendered Codex source would be committed" };
  if (!existsSync(cwd)) return { status: "failed", reason: `${cwd} does not exist; the install step must run first` };
  if (!existsSync(join(cwd, ".git"))) {
    if (!apply) return { status: "pending", reason: "the Codex plugin source would be initialized and committed" };
    const init = await run({ executable: "git", args: ["init"], cwd });
    if (init.unavailable) return { status: "not-run-unavailable", reason: "git is not on PATH" };
    if (init.exitCode !== 0) return { status: "failed", reason: evidenceOf(init) };
  }
  const status = await run({ executable: "git", args: ["status", "--porcelain"], cwd });
  if (status.unavailable) return { status: "not-run-unavailable", reason: "git is not on PATH" };
  if (status.exitCode !== 0) return { status: "failed", reason: evidenceOf(status) };
  if (status.stdout.trim() === "") return { status: "skipped", reason: "the Codex plugin source has no change to commit" };
  if (!apply) return { status: "pending", reason: "the Codex plugin source would be committed" };

  const added = await run({ executable: "git", args: ["add", "-A"], cwd });
  if (added.exitCode !== 0) return { status: "failed", reason: evidenceOf(added) };
  const committed = await run({
    executable: "git",
    args: ["-c", "user.name=all-about-agents", "-c", "user.email=all-about-agents@invalid.example", "commit", "-m", "Prepare local Codex plugin source"],
    cwd
  });
  if (committed.exitCode !== 0) return { status: "failed", reason: evidenceOf(committed) };
  return { status: "completed", reason: null };
}

/**
 * Refuse to mix whole-root and per-surface management in one package root.
 *
 * `--surface all` keeps one managed state at the root. A subset renders into
 * `<root>/<surface>` and writes a second state there. Registration prefers the
 * nested state when it exists, so the two drift apart on the next render and
 * the surface fails with a hash mismatch. Fail closed instead of building that
 * split state.
 */
function assertSurfaceSelectionMatchesRoot({ packageRoot, surfaces }) {
  const selected = Array.isArray(surfaces) && surfaces.length > 0 ? surfaces : [...SURFACES];
  if (selected.length === SURFACES.length) return;
  if (!existsSync(join(packageRoot, ".all-about-agents", "state.json"))) return;
  fail(
    "surface-subset-in-managed-root",
    `${packageRoot} is already managed as a whole root. Rerun with --surface all, or choose a package root that this repository does not manage yet.`
  );
}

/** Execute one setup plan. Every external program runs through the injected runner. */
export async function runSetup(options, { runProcess = defaultRunProcess, env = process.env, homeDir = homedir() } = {}) {
  assertPackageRootIsSafe(options.packageRoot, { homeDir, env });
  assertSurfaceSelectionMatchesRoot(options);
  if (options.mode === "fresh") await assertClearable(options.packageRoot);
  const statuslineName = options.statuslineName ?? (await renderedStatuslineName(options.packageRoot));
  const plan = planSetup({ ...options, statuslineName });
  const reports = [];
  let status = "complete";

  for (const step of plan.steps) {
    if (!options.apply && step.mutates && step.kind === "command") {
      reports.push({ id: step.id, title: step.title, status: "pending", reason: "mutating step; rerun with --apply" });
      continue;
    }
    let outcome;
    if (step.kind === "sync-status") outcome = await reportSyncStatus(step, runProcess);
    else if (step.kind === "install" && !options.apply) outcome = options.mode === "fresh"
      ? { status: "pending", reason: "planned against the cleared package root" }
      : await previewInstall(step, runProcess);
    else if (step.id.startsWith("verify-")) outcome = await verifyPluginList(step, runProcess);
    else if (step.id.startsWith("register-")) outcome = await reportRegistration(step, runProcess);
    else if (step.kind === "clear") outcome = await clearPackageRoot(options.packageRoot, options.apply);
    else if (step.kind === "codex-source") outcome = await commitCodexSource(options.packageRoot, runProcess, options.apply, options.mode);
    else outcome = await runCommandStep(step, runProcess);

    reports.push({ id: step.id, title: step.title, status: outcome.status, reason: outcome.reason ?? null, evidence: outcome.evidence ?? null });
    if (outcome.status === "failed" || outcome.status === "blocked") {
      status = outcome.status;
      break;
    }
  }

  const remaining = plan.steps.length - reports.length;
  return {
    schemaVersion: 1,
    action: "setup",
    mode: options.mode,
    apply: options.apply,
    status: status === "complete" ? (options.apply ? "complete" : "dry-run") : status,
    profile: options.profile,
    surfaces: [...options.surfaces],
    packageRoot: options.packageRoot,
    steps: reports,
    notAttempted: remaining > 0 ? plan.steps.slice(reports.length).map((step) => step.id) : []
  };
}

function setupText(report) {
  const lines = [
    `action=setup mode=${report.mode} apply=${String(report.apply)} status=${report.status}`,
    `package-root=${report.packageRoot} profile=${report.profile} surfaces=${report.surfaces.join(",")}`
  ];
  for (const step of report.steps) {
    lines.push(`  ${step.id.padEnd(24)} ${step.status}${step.reason ? ` — ${step.reason}` : ""}`);
  }
  if (report.notAttempted.length > 0) lines.push(`  not attempted: ${report.notAttempted.join(", ")}`);
  lines.push(report.status === "dry-run"
    ? "Next: review the pending steps, then rerun the same command with --apply."
    : report.status === "complete"
      ? "Next: restart the product, then confirm the plugin list and run npm run test:model."
      : report.status === "blocked"
        ? "Next: rerun with --mode fresh; this package root cannot be updated in place."
        : "Next: fix the failed step, then rerun.");
  return `${lines.join("\n")}\n`;
}

const USAGE = `Usage: node scripts/setup.mjs --mode fresh|update [options]

Modes:
  fresh     Clear every previous render from the package root, then install and register
  update    Keep the package root and sync it with this checkout, then register

Options:
  --package-root <path>   Package root (default: ~/.all-about-agents/package)
  --surface claude|codex|all   Surfaces to install (default: all)
  --profile portable|template  Render profile (default: template)
  --statusline-name <name>     Claude statusline display name (default: the rendered name)
  --dry-run | --apply     Plan only by default; --apply performs the run
  --format text|json      Select human or machine-readable output
  -h, --help              Show this help
`;

export async function main(argv, output = process.stdout, errorOutput = process.stderr, runtime = {}) {
  let options;
  try {
    options = parseSetupArgs(argv, { homeDir: runtime.homeDir ?? homedir() });
  } catch (error) {
    if (error.code === "help-requested") {
      output.write(USAGE);
      return 0;
    }
    errorOutput.write(`${error.code || "invalid-arguments"}: ${error.message}\n`);
    return 2;
  }
  try {
    const report = await runSetup(options, runtime);
    output.write(options.format === "json" ? `${JSON.stringify(report, null, 2)}\n` : setupText(report));
    return report.status === "failed" || report.status === "blocked" ? 1 : 0;
  } catch (error) {
    const code = error.code || "setup-failed";
    output.write(options.format === "json" ? `${JSON.stringify({ action: "setup", status: "failed", error: { code, message: error.message } }, null, 2)}\n` : `action=setup status=failed\n  ${code} — ${error.message}\n`);
    errorOutput.write(`${code}: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
