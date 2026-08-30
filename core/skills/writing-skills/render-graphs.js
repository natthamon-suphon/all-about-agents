#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_RENDER_BYTES = 10 * 1024 * 1024;

class RenderError extends Error {}

function parseArgs(argv) {
  const result = { check: false, overwrite: false, outputDir: null, inputs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--check") result.check = true;
    else if (value === "--overwrite") result.overwrite = true;
    else if (value === "--output-dir") {
      result.outputDir = argv[index + 1] ?? null;
      index += 1;
    } else if (value.startsWith("--")) throw new RenderError(`unknown option: ${value}`);
    else result.inputs.push(value);
  }
  return result;
}

function dotExecutable() {
  const candidate = process.env.GRAPHVIZ_DOT || "dot";
  if (candidate.includes("\0") || candidate.trim() === "") throw new RenderError("GRAPHVIZ_DOT must be one executable path without arguments");
  return candidate;
}

function runDot(executable, args, input) {
  const result = spawnSync(executable, args, {
    input,
    shell: false,
    windowsHide: true,
    maxBuffer: MAX_RENDER_BYTES,
    encoding: null
  });
  if (result.error?.code === "ENOENT") throw new RenderError("Graphviz dot is unavailable; install it or set GRAPHVIZ_DOT to its executable path");
  if (result.error) throw new RenderError("Graphviz could not start");
  if (result.status !== 0) throw new RenderError("Graphviz rejected the input; stderr redacted");
  if (!Buffer.isBuffer(result.stdout) || result.stdout.length === 0 || result.stdout.length > MAX_RENDER_BYTES) {
    throw new RenderError("Graphviz output is empty or exceeds the safe size limit");
  }
  return result.stdout;
}

function checkDot(executable) {
  const result = spawnSync(executable, ["-V"], { shell: false, windowsHide: true, encoding: "utf8" });
  if (result.error?.code === "ENOENT") throw new RenderError("Graphviz dot is unavailable; install it or set GRAPHVIZ_DOT to its executable path");
  if (result.error || result.status !== 0) throw new RenderError("Graphviz dot preflight failed");
}

function inputRecord(value) {
  const path = resolve(value);
  if (extname(path).toLowerCase() !== ".dot") throw new RenderError(`input must be a .dot file: ${value}`);
  const metadata = statSync(path);
  if (!metadata.isFile() || metadata.size === 0 || metadata.size > MAX_SOURCE_BYTES) throw new RenderError(`input is empty, not a file, or too large: ${value}`);
  const stem = basename(path, extname(path));
  if (!/^[A-Za-z0-9._-]+$/u.test(stem)) throw new RenderError(`input basename is unsafe: ${value}`);
  return { path, stem, source: readFileSync(path) };
}

function writeOutput(target, content, overwrite) {
  if (!overwrite) {
    try {
      writeFileSync(target, content, { flag: "wx" });
      return;
    } catch (error) {
      if (error?.code === "EEXIST") throw new RenderError(`output exists: ${target}; use --overwrite only with explicit authority`);
      throw error;
    }
  }
  writeFileSync(target, content, { flag: "w" });
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const executable = dotExecutable();
  checkDot(executable);
  if (options.check) {
    if (options.outputDir || options.inputs.length > 0 || options.overwrite) throw new RenderError("--check cannot be combined with rendering arguments");
    process.stdout.write(`Graphviz available on ${process.platform}\n`);
    return;
  }
  if (!options.outputDir || options.inputs.length === 0) throw new RenderError("--output-dir and at least one .dot input are required");
  const outputDir = resolve(options.outputDir);
  const records = options.inputs.map(inputRecord);
  const rendered = records.map((record) => ({ ...record, svg: runDot(executable, ["-Tsvg"], record.source) }));
  mkdirSync(outputDir, { recursive: true });
  for (const record of rendered) {
    const target = join(outputDir, `${record.stem}.svg`);
    writeOutput(target, record.svg, options.overwrite);
    process.stdout.write(`${target}\n`);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof RenderError ? error.message : "graph rendering failed with a redacted filesystem error";
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
}
