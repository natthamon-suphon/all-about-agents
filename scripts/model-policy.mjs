#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess } from "./lib/process-runner.mjs";
import { resolveNativeCommand } from "./lib/native-command.mjs";

const EFFORTS = Object.freeze(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
const SURFACES = new Set(["claude", "codex", "antigravity"]);
const SLUG = /^[a-z0-9][a-z0-9._-]{0,127}$/u;

function actualEffort(available, requested) {
  if (!Array.isArray(available) || available.length === 0 || available.some((value) => !EFFORTS.includes(value))) throw new Error("unavailable or unknown model effort");
  return available.includes(requested) ? requested : EFFORTS.filter((value) => available.includes(value)).at(-1);
}

/** Parse the observed CLI list conservatively; reject changed or partial formats. */
export function parseAntigravityModels(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 1024 * 1024) throw new Error("invalid model catalog");
  const records = [];
  for (const line of text.split(/\r?\n/u).filter(Boolean)) {
    if (line === "Fetching available models...") continue;
    const match = /^([a-z0-9][a-z0-9._-]{0,127})\t([^\u0000-\u001f\u007f]+)$/u.exec(line);
    if (!match || records.length >= 1000) throw new Error("unrecognized model catalog format");
    records.push({ model: match[1], label: match[2] });
  }
  if (records.length === 0) throw new Error("empty model catalog");
  return records;
}

/** Choose a release within the approved premium family, never across cheaper tiers. */
export function selectModel({ surface, runtime = "cli", catalog = [], effort = "xhigh" } = {}) {
  if (!SURFACES.has(surface) || !EFFORTS.includes(effort)) throw new TypeError("invalid surface or requested effort");
  if (runtime !== "cli") throw new Error("native automatic GUI model control unavailable; select the model in the product controls");
  if (surface === "claude") return { model: "opus[1m]", effort, requestedEffort: effort, effortFallback: false, source: "native-opus-alias", policy: "newest-approved-family" };
  if (!Array.isArray(catalog) || catalog.length === 0 || catalog.length > 1000) throw new Error("invalid model catalog");
  const ids = new Map();
  for (const entry of catalog) {
    if (!entry || typeof entry !== "object" || typeof entry.model !== "string" || !SLUG.test(entry.model)) throw new Error("invalid model catalog record");
    if (Object.hasOwn(entry, "hidden") && typeof entry.hidden !== "boolean") throw new Error("invalid model catalog hidden flag");
    if (ids.has(entry.model)) throw new Error("duplicate model catalog entry");
    ids.set(entry.model, entry);
  }
  if (surface === "codex") {
    for (const entry of catalog) {
      const visited = new Set();
      let current = entry;
      while (current?.upgrade != null) {
        if (typeof current.upgrade !== "string" || !SLUG.test(current.upgrade)) throw new Error("invalid model upgrade metadata");
        if (visited.has(current.model)) throw new Error("model upgrade cycle");
        visited.add(current.model);
        current = ids.get(current.upgrade);
        if (!current) throw new Error("missing upgrade target in model catalog");
      }
    }
  }
  const candidates = [];
  for (const entry of catalog) {
    if (entry.hidden === true) continue;
    const match = surface === "codex"
      ? /^gpt-(\d+)(?:\.(\d+))?-sol$/u.exec(entry.model)
      : /^gemini-(\d+)(?:\.(\d+))?-(?:argon|pro)-(low|medium|high|xhigh|max)$/u.exec(entry.model);
    if (!match) continue;
    const version = [Number(match[1]), Number(match[2] ?? 0)];
    if (version.some((value) => !Number.isSafeInteger(value))) throw new Error("invalid model release version");
    const available = surface === "codex"
      ? entry.supportedReasoningEfforts?.map((value) => value?.reasoningEffort)
      : catalog.filter((value) => value.model.replace(/-(?:low|medium|high|xhigh|max)$/u, "") === entry.model.replace(/-(?:low|medium|high|xhigh|max)$/u, "")).map((value) => value.model.split("-").at(-1));
    const selectedEffort = actualEffort(available, effort);
    if (surface === "antigravity" && match[3] !== selectedEffort) continue;
    candidates.push({ model: entry.model, effort: selectedEffort, version });
  }
  candidates.sort((left, right) => right.version[0] - left.version[0] || right.version[1] - left.version[1]);
  if (candidates.length === 0) throw new Error("no eligible premium model with a supported effort");
  if (candidates[1] && candidates[0].version.every((value, index) => value === candidates[1].version[index]) && candidates[0].model !== candidates[1].model) throw new Error("ambiguous model release; native policy review required");
  const { model, effort: selectedEffort } = candidates[0];
  return { model, effort: selectedEffort, requestedEffort: effort, effortFallback: selectedEffort !== effort, source: surface === "codex" ? "model/list" : "agy-models-observed-tsv", policy: "newest-approved-family" };
}

/** Build native argv without shell evaluation or ambiguous competing overrides. */
export function planModelLaunch({ surface, selection, args = [], profile = "template" } = {}) {
  if (!SURFACES.has(surface) || !["portable", "template"].includes(profile) || !Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) throw new TypeError("invalid launch arguments");
  const executable = { claude: "claude", codex: "codex", antigravity: "agy" }[surface];
  if (profile === "portable") return { executable, args: [...args], profile };
  const shortOverrides = surface === "codex" ? /^-[mcp]/u : /^-m/u;
  if (args.some((arg) => shortOverrides.test(arg) || /^--(?:model|effort|config|profile)(?:=|$)/u.test(arg))) throw new Error("native model/config override conflicts with automatic policy");
  if (!selection || typeof selection.model !== "string" || !(SLUG.test(selection.model) || selection.model === "opus[1m]") || !EFFORTS.includes(selection.effort)) throw new TypeError("invalid model selection");
  const policyArgs = surface === "codex"
    ? ["--model", selection.model, "--config", `model_reasoning_effort=${JSON.stringify(selection.effort)}`, "--sandbox", "danger-full-access", "--ask-for-approval", "never"]
    : ["--model", selection.model, "--effort", selection.effort, "--dangerously-skip-permissions"];
  return { executable, args: [...policyArgs, ...args], profile, selection };
}

/** Read only model metadata using the documented App Server handshake and paging. */
export async function readCodexModels({ executable = "codex", argsPrefix = [], timeoutMs = 30_000, maxOutputBytes = 1024 * 1024 } = {}) {
  if (typeof executable !== "string" || !executable || executable.includes("\0") || !Array.isArray(argsPrefix) || argsPrefix.some((value) => typeof value !== "string" || value.includes("\0")) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) throw new TypeError("invalid catalog process options");
  return new Promise((resolveCatalog, reject) => {
    const native = resolveNativeCommand(executable);
    const child = spawn(native.executable, [...native.argsPrefix, ...argsPrefix, "app-server"], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let settled = false;
    let delivered = false;
    let finishError;
    let killTimer;
    let closeTimer;
    let pending = "";
    let size = 0;
    let requestId = 1;
    let pages = 0;
    const models = [];
    const cursors = new Set();
    const deliver = () => {
      if (delivered) return;
      delivered = true;
      clearTimeout(killTimer);
      clearTimeout(closeTimer);
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      if (finishError) reject(finishError); else resolveCatalog(models);
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      finishError = error;
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      killTimer = setTimeout(() => { child.kill("SIGKILL"); closeTimer = setTimeout(deliver, 1000); }, 500);
      if (!child.pid) deliver();
    };
    const send = (message) => { if (!settled) child.stdin.write(`${JSON.stringify(message)}\n`); };
    const timer = setTimeout(() => finish(new Error("native model catalog timed out")), timeoutMs);
    child.on("error", () => finish(new Error("native Codex executable unavailable")));
    child.on("close", () => { if (!settled) finish(new Error("native model catalog closed before a complete response")); deliver(); });
    child.stdin.on("error", () => finish(new Error("native model catalog input closed")));
    child.stderr.on("data", (chunk) => { size += chunk.length; if (size > maxOutputBytes) finish(new Error("native model catalog output limit exceeded")); });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (settled) return;
      size += Buffer.byteLength(chunk);
      if (size > maxOutputBytes) return finish(new Error("native model catalog output limit exceeded"));
      pending += chunk;
      let end;
      while (!settled && (end = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          if (message.id !== requestId) continue;
          if (message.error || !message.result) throw new Error("native model catalog request rejected");
          if (requestId === 1) {
            send({ method: "initialized", params: {} });
          } else {
            if (!Array.isArray(message.result.data) || ++pages > 20 || models.length + message.result.data.length > 1000) throw new Error("invalid or oversized model catalog page");
            models.push(...message.result.data);
            const cursor = message.result.nextCursor;
            if (cursor == null) return finish();
            if (typeof cursor !== "string" || !cursor || cursors.has(cursor)) throw new Error("invalid model catalog pagination");
            cursors.add(cursor);
          }
          requestId += 1;
          send({ method: "model/list", id: requestId, params: { limit: 100, includeHidden: false, ...(cursors.size ? { cursor: [...cursors].at(-1) } : {}) } });
        } catch (error) { finish(error instanceof SyntaxError ? new Error("invalid native model catalog JSON") : error); }
      }
    });
    send({ method: "initialize", id: 1, params: { clientInfo: { name: "all-about-agents-model-policy", version: "1" } } });
  });
}

export async function discoverModelSelection({ surface, runtime = "cli", profile = "template", run = runProcess, readCodex = readCodexModels } = {}) {
  if (!SURFACES.has(surface) || !["portable", "template"].includes(profile)) throw new TypeError("invalid surface or profile");
  if (runtime !== "cli") throw new Error("native automatic GUI model control unavailable");
  if (profile === "portable") return null;
  let catalog = [];
  if (surface === "codex") catalog = await readCodex();
  if (surface === "antigravity") {
    const result = await run({ executable: "agy", args: ["models"], timeoutMs: 30_000, maxOutputBytes: 1024 * 1024 });
    if (result.exitCode !== 0 || result.timedOut || result.unavailable || result.outputTooLarge) throw new Error("native Antigravity model catalog unavailable");
    catalog = parseAntigravityModels(result.stdout);
  }
  return selectModel({ surface, runtime, catalog });
}

export async function main(argv = process.argv.slice(2)) {
  const nativeArgumentStart = argv.indexOf("--");
  const policyArguments = nativeArgumentStart < 0 ? argv : argv.slice(0, nativeArgumentStart);
  if (policyArguments.includes("--help")) {
    process.stdout.write("node scripts/model-policy.mjs --surface claude|codex|antigravity [--profile template|portable] [--runtime cli] [--launch] [-- native arguments]\nDry-run by default. Re-resolves eligible models before each managed launch; never edits live configuration.\n");
    return 0;
  }
  const options = { runtime: "cli", profile: "template" };
  let launch = false;
  let args = [];
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--") { args = argv.slice(index + 1); break; }
    if (flag === "--launch") { launch = true; continue; }
    if (!["--surface", "--runtime", "--profile"].includes(flag) || index + 1 >= argv.length || argv[index + 1].startsWith("--")) throw new TypeError("invalid model policy arguments; use --help");
    options[flag.slice(2)] = argv[++index];
  }
  const selection = await discoverModelSelection(options);
  const plan = planModelLaunch({ ...options, selection, args });
  if (!launch) { process.stdout.write(`${JSON.stringify({ status: "dry-run", ...plan }, null, 2)}\n`); return 0; }
  return new Promise((resolveExit) => {
    const native = resolveNativeCommand(plan.executable);
    const child = spawn(native.executable, [...native.argsPrefix, ...plan.args], { shell: false, windowsHide: true, stdio: "inherit" });
    child.on("error", () => { process.stderr.write("Native executable unavailable; install it using its official installer.\n"); resolveExit(1); });
    child.on("exit", (code) => resolveExit(code ?? 1));
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
