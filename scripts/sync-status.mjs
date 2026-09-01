#!/usr/bin/env node

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runProcess } from "./lib/process-runner.mjs";

const FORMATS = new Set(["text", "json"]);
const SHA = /^[0-9a-f]{40,64}$/u;
const FORBIDDEN_GIT_ACTIONS = new Set(["fetch", "pull", "merge", "rebase", "stash", "reset", "commit", "push"]);
const compareCodePoints = (left, right) => left === right ? 0 : left < right ? -1 : 1;

export class SyncStatusError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SyncStatusError";
    this.code = code;
  }
}

function baseStatus(relation, nextAction) {
  return {
    schemaVersion: 1,
    branch: null,
    commit: null,
    upstream: null,
    dirty: false,
    changedPaths: [],
    ahead: null,
    behind: null,
    relation,
    refBasis: "local",
    networkAccess: false,
    readyFor: { pull: false, quality: false, install: false },
    nextAction
  };
}

function gitFailure(command, result) {
  const evidence = result.stderr.trim() || result.stdout.trim() || `exit ${String(result.exitCode)}`;
  throw new SyncStatusError("git-command-failed", `git ${command.join(" ")} failed: ${evidence}`);
}

async function git(run, cwd, args, { allowFailure = false } = {}) {
  if (args.some((arg) => FORBIDDEN_GIT_ACTIONS.has(arg))) {
    throw new SyncStatusError("forbidden-git-action", "sync status may not run network or mutating Git actions");
  }
  const result = await run({ executable: "git", args, cwd });
  if (result?.unavailable) return result;
  if (result?.timedOut) throw new SyncStatusError("git-command-timeout", `git ${args.join(" ")} timed out`);
  if (result?.outputTooLarge) throw new SyncStatusError("git-output-too-large", `git ${args.join(" ")} exceeded the bounded output capture`);
  if (!result || typeof result.exitCode !== "number") throw new SyncStatusError("invalid-git-result", "Git runner returned an invalid result");
  if (result.exitCode !== 0 && !allowFailure) gitFailure(args, result);
  return result;
}

function parseChangedPaths(raw) {
  if (typeof raw !== "string") throw new SyncStatusError("invalid-status", "Git status output must be text");
  const records = raw.split("\0");
  if (records.at(-1) === "") records.pop();
  const paths = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4 || record[2] !== " ") throw new SyncStatusError("invalid-status", "Git porcelain status output is malformed");
    const state = record.slice(0, 2);
    const path = record.slice(3);
    if (path === "") throw new SyncStatusError("invalid-status", "Git porcelain status contains an empty path");
    paths.push(path.replaceAll("\\", "/"));
    if (/[RC]/u.test(state)) {
      index += 1;
      if (index >= records.length || records[index] === "") throw new SyncStatusError("invalid-status", "Git rename status is missing its source path");
      paths.push(records[index].replaceAll("\\", "/"));
    }
  }
  return [...new Set(paths)].sort(compareCodePoints);
}

function parseCounts(raw) {
  const match = /^(\d+)[\t ]+(\d+)\s*$/u.exec(raw);
  if (!match) throw new SyncStatusError("invalid-revision-count", "Git ahead/behind output is malformed");
  const ahead = Number(match[1]);
  const behind = Number(match[2]);
  if (!Number.isSafeInteger(ahead) || !Number.isSafeInteger(behind)) throw new SyncStatusError("invalid-revision-count", "Git ahead/behind values are unsafe");
  return { ahead, behind };
}

function relationFor(ahead, behind) {
  if (ahead > 0 && behind > 0) return "diverged";
  if (ahead > 0) return "ahead";
  if (behind > 0) return "behind";
  return "up-to-date";
}

function nextActionFor(status) {
  if (status.dirty) return "Preserve or commit local changes, then make the working tree clean before update or install.";
  if (status.branch === null) return "Run git switch main, then run sync status again.";
  if (status.branch !== "main") return "Run git switch main, then run sync status again.";
  if (status.upstream === null) return "Run git branch --set-upstream-to=origin/main main, then run sync status again.";
  if (status.upstream !== "origin/main") return "Set the main branch upstream to origin/main, then run sync status again.";
  if (status.relation === "diverged") return "Stop and review the diverged history manually. Do not merge or rebase automatically.";
  if (status.relation === "ahead") return "Stop and review local commits before using this checkout as a receiving machine.";
  if (status.relation === "behind") return "Run git pull --ff-only origin main, then run sync status again.";
  return "Run npm run quality:quick before an explicit install.";
}

export async function inspectSyncStatus({ cwd = process.cwd(), run = runProcess } = {}) {
  if (typeof cwd !== "string" || cwd.trim() === "" || cwd.includes("\0")) throw new TypeError("cwd must be a non-empty path");
  if (typeof run !== "function") throw new TypeError("run must be a process runner function");

  const repository = await git(run, cwd, ["rev-parse", "--is-inside-work-tree"], { allowFailure: true });
  if (repository.unavailable) return baseStatus("git-unavailable", "Install Git or add it to PATH, then run sync status again.");
  if (repository.exitCode !== 0 || repository.stdout.trim() !== "true") {
    return baseStatus("not-a-repository", "Open the all-about-agents Git checkout, then run sync status again.");
  }

  const statusResult = await git(run, cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const changedPaths = parseChangedPaths(statusResult.stdout);
  const branchResult = await git(run, cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"], { allowFailure: true });
  const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : null;
  if (branch !== null && branch === "") throw new SyncStatusError("invalid-branch", "Git returned an empty branch name");
  const commitResult = await git(run, cwd, ["rev-parse", "HEAD"]);
  const commit = commitResult.stdout.trim();
  if (!SHA.test(commit)) throw new SyncStatusError("invalid-commit", "Git returned an invalid commit SHA");

  const common = {
    schemaVersion: 1,
    branch,
    commit,
    upstream: null,
    dirty: changedPaths.length > 0,
    changedPaths,
    ahead: null,
    behind: null,
    relation: branch === null ? "detached" : "no-upstream",
    refBasis: "local",
    networkAccess: false,
    readyFor: { pull: false, quality: true, install: false },
    nextAction: ""
  };

  if (branch === null) return { ...common, nextAction: nextActionFor(common) };

  const upstreamResult = await git(run, cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { allowFailure: true });
  if (upstreamResult.exitCode !== 0) return { ...common, nextAction: nextActionFor(common) };
  const upstream = upstreamResult.stdout.trim();
  if (upstream === "") throw new SyncStatusError("invalid-upstream", "Git returned an empty upstream name");

  const countResult = await git(run, cwd, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
  const { ahead, behind } = parseCounts(countResult.stdout);
  const relation = relationFor(ahead, behind);
  const eligible = !common.dirty && branch === "main" && upstream === "origin/main";
  const complete = {
    ...common,
    upstream,
    ahead,
    behind,
    relation,
    readyFor: {
      pull: eligible && relation === "behind",
      quality: true,
      install: eligible && relation === "up-to-date"
    }
  };
  return { ...complete, nextAction: nextActionFor(complete) };
}

export function formatSyncStatus(status, { format = "text" } = {}) {
  if (!FORMATS.has(format)) throw new TypeError("format must be text or json");
  if (!status || status.schemaVersion !== 1) throw new TypeError("status must be a sync status result");
  if (format === "json") return `${JSON.stringify(status, null, 2)}\n`;
  const lines = [
    `Sync status: ${status.relation}`,
    `Branch: ${status.branch ?? "none"}`,
    `Commit: ${status.commit ?? "none"}`,
    `Upstream: ${status.upstream ?? "none"}`,
    `Working tree: ${status.dirty ? "dirty" : "clean"}`,
    `Ahead/behind: ${status.ahead ?? "unknown"}/${status.behind ?? "unknown"}`,
    "Remote comparison uses local refs only. Run git fetch origin first when current remote information is needed.",
    `Next: ${status.nextAction}`
  ];
  if (status.changedPaths.length > 0) lines.push("Changed paths:", ...status.changedPaths.map((path) => `- ${path}`));
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  let format = "text";
  let help = false;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--help" || value === "-h") {
      help = true;
    } else if (value === "--format") {
      format = argv[index + 1];
      index += 1;
      if (!FORMATS.has(format)) throw new TypeError("--format must be text or json");
    } else {
      throw new TypeError(`unknown option: ${value}`);
    }
  }
  return { format, help };
}

const HELP = `Usage: node scripts/sync-status.mjs [--format text|json]\n\nReads local Git state only. It does not fetch or change the repository.\n`;

export async function main(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }, runtime = {}) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    io.stderr.write(`${error.message}\n`);
    return 2;
  }
  if (options.help) {
    io.stdout.write(HELP);
    return 0;
  }
  try {
    const status = await inspectSyncStatus({ cwd: runtime.cwd ?? process.cwd(), run: runtime.run ?? runProcess });
    io.stdout.write(formatSyncStatus(status, { format: options.format }));
    return status.readyFor.pull || status.readyFor.install ? 0 : 1;
  } catch (error) {
    io.stderr.write(`sync status failed: ${error.message}\n`);
    return 1;
  }
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedUrl === import.meta.url) process.exitCode = await main();
