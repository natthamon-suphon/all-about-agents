import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";
import envelopeSchema from "./result-envelope.schema.json" with { type: "json" };
import { validateSchema } from "../../installers/lib/validate-schema.mjs";

const SECRET_PATTERNS = [
  /\b(?:sk|pk)-[A-Za-z0-9_-]{16,}/iu,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/iu,
  /\b(?:api[_ -]?key|access[_ -]?token|password|secret)\s*[:=]\s*(?!\[REDACTED\])\S+/iu,
  /(?:[A-Za-z]:\\Users\\|\/(?:Users|home)\/)[^\s"'`]+/iu,
  /\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/u
];

const SENSITIVE_METADATA_KEYS = new Set([
  "password",
  "passwd",
  "pwd",
  "token",
  "apikey",
  "secret",
  "authorization",
  "authtoken",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "privatekey"
]);

function isWithin(child, parent) {
  const childPath = resolve(child);
  const parentPath = resolve(parent);
  const remainder = relative(parentPath, childPath);
  return remainder === "" || (remainder !== ".." && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder));
}

function hasTraversalSegment(value) {
  return String(value).split(/[\\/]/u).some((segment) => segment === "..");
}

async function nearestExistingParent(path) {
  let candidate = resolve(path);
  while (true) {
    try {
      return { logical: candidate, real: await realpath(candidate) };
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = resolve(candidate, "..");
      if (parent === candidate) throw error;
      candidate = parent;
    }
  }
}

export async function assertContainedOutputDir(outputDir) {
  if (typeof outputDir !== "string" || outputDir.trim().length === 0 || hasTraversalSegment(outputDir)) {
    throw new Error("outputDir must be a contained evaluation directory");
  }
  const target = resolve(process.cwd(), outputDir);
  const repositoryRoot = resolve(process.cwd());
  const repositoryRoots = [
    { logical: resolve(repositoryRoot, ".aaa", "eval-runs"), intendedParent: repositoryRoot },
    { logical: resolve(repositoryRoot, "tests", ".tmp"), intendedParent: repositoryRoot }
  ];
  const temporaryRoot = resolve(tmpdir());
  const allowedByRepository = repositoryRoots.some(({ logical }) => isWithin(target, logical));
  const allowedByTemporary = isWithin(target, temporaryRoot) && target.toLowerCase().split(/[\\/]/u).includes("eval-runs");
  if (!allowedByRepository && !allowedByTemporary) throw new Error("outputDir must be a contained evaluation directory");
  const existingParent = await nearestExistingParent(target);
  const realTarget = existingParent.logical === target ? existingParent.real : resolve(existingParent.real, relative(existingParent.logical, target));
  const realRepositoryRoots = await Promise.all(repositoryRoots.map(async ({ logical, intendedParent }) => ({
    root: (await nearestExistingParent(logical)).real,
    intendedParent: (await nearestExistingParent(intendedParent)).real
  })));
  const realTemporaryRoot = (await nearestExistingParent(temporaryRoot)).real;
  const realRepositoryAllowed = realRepositoryRoots.some(({ root, intendedParent }) => isWithin(root, intendedParent) && isWithin(realTarget, root));
  const realTemporaryAllowed = isWithin(realTarget, realTemporaryRoot) && realTarget.toLowerCase().split(/[\\/]/u).includes("eval-runs");
  if (!realRepositoryAllowed && !realTemporaryAllowed) throw new Error("outputDir must be a contained evaluation directory");
  await mkdir(target, { recursive: true });
  return target;
}

function collectSecretErrors(value, path, errors) {
  if (typeof value === "string") {
    if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
      errors.push({ sourcePath: "core/evals/result-envelope.schema.json", jsonPointer: path, keyword: "redaction", message: "evaluation values must be redacted and anonymized" });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSecretErrors(item, `${path}/${index}`, errors));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const pointerKey = String(key).replaceAll("~", "~0").replaceAll("/", "~1");
      collectSecretErrors(child, `${path}/${pointerKey}`, errors);
    }
  }
}

function normalizeMetadataKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/gu, "");
}

function collectSensitiveMetadataKeyErrors(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectSensitiveMetadataKeyErrors(item, `${path}/${index}`, errors));
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    const pointerKey = String(key).replaceAll("~", "~0").replaceAll("/", "~1");
    const childPath = `${path}/${pointerKey}`;
    if (SENSITIVE_METADATA_KEYS.has(normalizeMetadataKey(key)) && child !== "[REDACTED]") {
      errors.push({ sourcePath: "core/evals/result-envelope.schema.json", jsonPointer: childPath, keyword: "redaction", message: "sensitive metadata keys must use [REDACTED] values" });
    }
    collectSensitiveMetadataKeyErrors(child, childPath, errors);
  }
}

export function validateResultEnvelope(value) {
  const result = validateSchema({ schema: envelopeSchema, value, sourcePath: "core/evals/result-envelope.schema.json" });
  const errors = [...result.errors];
  collectSecretErrors(value, "", errors);
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    collectSensitiveMetadataKeyErrors(value.metadata, "/metadata", errors);
  }
  return { valid: errors.length === 0, errors };
}

function averageScores(results) {
  const dimensions = new Set();
  for (const result of results) for (const key of Object.keys(result.scores)) dimensions.add(key);
  const summary = {};
  for (const key of [...dimensions].sort()) {
    const values = results.map((result) => result.scores[key]).filter((value) => typeof value === "number");
    summary[key] = values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
  }
  return summary;
}

async function writeResult(outputDir, batch) {
  const outputPath = resolve(outputDir, "result.json");
  const temporaryPath = resolve(outputDir, `.result-${process.pid}-${Date.now()}.tmp`);
  await writeFile(temporaryPath, `${JSON.stringify(batch, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporaryPath, outputPath);
}

export async function runEvaluationBatch({ cases, variant, samples, executeSample, outputDir }) {
  if (!Array.isArray(cases)) throw new TypeError("cases must be an array");
  if (variant !== "control" && variant !== "candidate") throw new TypeError("variant must be control or candidate");
  if (!Number.isInteger(samples) || samples < 1) throw new TypeError("samples must be a positive integer");
  if (typeof executeSample !== "function") throw new TypeError("executeSample must be a function");
  const containedOutputDir = await assertContainedOutputDir(outputDir);
  if (cases.length !== samples && cases.length !== 1) throw new Error("cases must contain exactly the requested sample count");
  const inputCases = cases.length === samples ? cases : Array.from({ length: samples }, () => cases[0]);
  const results = [];
  const sampleIds = new Set();
  for (let index = 0; index < inputCases.length; index += 1) {
    const rawResult = await executeSample(inputCases[index], index);
    const validation = validateResultEnvelope(rawResult);
    if (!validation.valid) throw new Error(`invalid result envelope: ${JSON.stringify(validation.errors)}`);
    if (rawResult.variant !== variant) throw new Error(`result variant ${rawResult.variant} does not match requested ${variant}`);
    if (sampleIds.has(rawResult.sampleId)) throw new Error(`duplicate sample ID: ${rawResult.sampleId}`);
    sampleIds.add(rawResult.sampleId);
    results.push(rawResult);
  }
  const batch = { schemaVersion: 1, variant, requestedSamples: samples, results, summary: averageScores(results) };
  await writeResult(containedOutputDir, batch);
  return batch;
}

export async function readContainedUtf8Jsonl(inputPath) {
  if (typeof inputPath !== "string" || inputPath.trim().length === 0 || hasTraversalSegment(inputPath)) throw new Error("input JSONL path must be contained");
  const target = resolve(process.cwd(), inputPath);
  const repositoryRoot = resolve(process.cwd());
  const temporaryRoot = resolve(tmpdir());
  const existingParent = await nearestExistingParent(target);
  const realTarget = existingParent.logical === target ? existingParent.real : resolve(existingParent.real, relative(existingParent.logical, target));
  const realRepositoryRoot = (await nearestExistingParent(repositoryRoot)).real;
  const realTemporaryRoot = (await nearestExistingParent(temporaryRoot)).real;
  if (!isWithin(realTarget, realRepositoryRoot) && !isWithin(realTarget, realTemporaryRoot)) throw new Error("input JSONL path must be contained");
  const bytes = await readFile(target);
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error("input JSONL must be valid UTF-8", { cause: error });
  }
  if (text.length > 2_000_000) throw new Error("input JSONL is too large");
  return text;
}
