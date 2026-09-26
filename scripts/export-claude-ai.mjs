#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildSkillArchive, loadPack, PackValidationError, validateSkill } from "./lib/claude-ai-pack.mjs";

const USAGE = "Usage: node scripts/export-claude-ai.mjs\n  Validates claude-ai/skills and writes one ZIP per skill to .aaa/claude-ai/.\n";

async function prepareOutputDirectory(outputDir) {
  try {
    const details = await lstat(outputDir);
    if (details.isSymbolicLink() || !details.isDirectory()) throw new Error(`output path must be a real directory: ${outputDir}`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(outputDir, { recursive: true });
  }
}

async function writeAtomically(destination, bytes) {
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, bytes, { flag: "wx" });
  try {
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export async function exportPack({ repositoryRoot, outputDir = join(repositoryRoot, ".aaa", "claude-ai") }) {
  const pack = await loadPack(join(repositoryRoot, "claude-ai"));
  const errors = pack.skills.flatMap((skill) => validateSkill(skill).map((error) => ({ skill: skill.name, ...error })));
  if (errors.length > 0) throw new PackValidationError(errors);
  const built = pack.skills.map((skill) => buildSkillArchive(skill, pack.conventions));
  await prepareOutputDirectory(outputDir);
  const archives = [];
  for (const archive of built) {
    const path = join(outputDir, archive.fileName);
    await writeAtomically(path, archive.bytes);
    archives.push({ name: archive.name, path, sha256: createHash("sha256").update(archive.bytes).digest("hex") });
  }
  return { archives };
}

export async function main(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }, runtime = {}) {
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    io.stdout.write(USAGE);
    return 0;
  }
  if (argv.length > 0) {
    io.stderr.write(USAGE);
    return 2;
  }
  const repositoryRoot = runtime.repositoryRoot ?? process.cwd();
  try {
    const { archives } = await exportPack({ repositoryRoot });
    for (const archive of archives) {
      io.stdout.write(`${archive.name} ${relative(repositoryRoot, archive.path).replaceAll("\\", "/")} ${archive.sha256}\n`);
    }
    return 0;
  } catch (error) {
    if (error instanceof PackValidationError) {
      for (const entry of error.errors) io.stderr.write(`${entry.skill}/${entry.path} ${entry.code} ${entry.message}\n`);
    } else {
      io.stderr.write(`export failed: ${error.message}\n`);
    }
    return 1;
  }
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedUrl === import.meta.url) process.exitCode = await main();
