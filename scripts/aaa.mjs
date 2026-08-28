import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readContainedUtf8Jsonl, runEvaluationBatch } from "../core/evals/runner.mjs";
import { loadCore } from "../installers/lib/load-core.mjs";

const HELP_TEXT = [
  "Usage: node scripts/aaa.mjs <action>",
  "",
  "Actions:",
  "  install   Install or update the local agent-system configuration",
  "  doctor    Check the local runtime and repository prerequisites",
  "  validate  Validate repository configuration and contracts",
  "  diff      Show the pending configuration diff",
    "  eval      Run an evaluation against a disposable root",
  "",
  "Options:",
  "  -h, --help  Show this help",
  ""
].join("\n");

const ACTIONS = new Set(["install", "doctor", "validate", "diff", "eval"]);

function hasValidFoundation(cwd) {
  try {
    const packagePath = resolve(cwd, "package.json");
    if (!existsSync(packagePath)) {
      return false;
    }
    const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
    return packageJson.type === "module" && packageJson.engines?.node === ">=22.12.0";
  } catch {
    return false;
  }
}

function parseEvalArgs(args) {
  const values = new Map();
  const allowed = new Set(["--skill", "--variant", "--samples", "--input-jsonl", "--output", "--format"]);
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (!option.startsWith("--")) throw new Error(`Unexpected argument for eval: ${option}`);
    if (!allowed.has(option)) throw new Error(`Unknown eval option: ${option}`);
    if (values.has(option)) throw new Error(`Duplicate option: ${option}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
    values.set(option, value);
    index += 1;
  }
  const required = ["--skill", "--variant", "--samples", "--input-jsonl", "--output"];
  for (const option of required) if (!values.has(option)) throw new Error(`Missing required option: ${option}`);
  const skill = values.get("--skill");
  const variant = values.get("--variant");
  const samples = Number(values.get("--samples"));
  const format = values.get("--format") || "text";
  if (variant !== "control" && variant !== "candidate") throw new Error("--variant must be control or candidate");
  if (!Number.isInteger(samples) || samples < 1) throw new Error("--samples must be a positive integer");
  if (format !== "json" && format !== "text") throw new Error("--format must be json or text");
  return { skill, variant, samples, inputPath: values.get("--input-jsonl"), outputDir: values.get("--output"), format };
}

function readCanonicalSkills(cwd) {
  const inventory = JSON.parse(readFileSync(resolve(cwd, "core/inventory.json"), "utf8"));
  return Array.isArray(inventory.skills) ? inventory.skills : [];
}

function parseValidateArgs(args) {
  const values = new Map();
  const allowed = new Set(["--scope", "--skill", "--format"]);
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (!option.startsWith("--")) throw new Error(`Unexpected argument for validate: ${option}`);
    if (!allowed.has(option)) throw new Error(`Unknown validate option: ${option}`);
    if (values.has(option)) throw new Error(`Duplicate option: ${option}`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
    values.set(option, value);
    index += 1;
  }
  const scope = values.get("--scope") || null;
  const skill = values.get("--skill") || null;
  const format = values.get("--format") || "text";
  if (scope !== null && scope !== "core" && scope !== "skill") throw new Error("--scope must be core or skill");
  if (scope === "skill" && skill === null) throw new Error("--scope skill requires --skill SKILL_NAME");
  if (scope !== "skill" && skill !== null) throw new Error("--skill requires --scope skill");
  if (format !== "json" && format !== "text") throw new Error("--format must be json or text");
  return { scope, skill, format };
}

function emitValidationResult(result, output, errorOutput) {
  if (result.valid) {
    if (result.format === "json") output.write(`${JSON.stringify({ valid: true, scope: result.scope, ...(result.skill ? { skill: result.skill } : {}) })}\n`);
    else output.write(`valid scope=${result.scope}${result.skill ? ` skill=${result.skill}` : ""}\n`);
    return 0;
  }
  const details = result.errors || [];
  if (result.format === "json") output.write(`${JSON.stringify({ valid: false, scope: result.scope, ...(result.skill ? { skill: result.skill } : {}), errors: details })}\n`);
  else for (const error of details) errorOutput.write(`${error.sourcePath || "<core>"}#${error.jsonPointer || ""} ${error.keyword || "validation"}: ${error.message}\n`);
  return 1;
}

async function validate(args, output, errorOutput) {
  let options;
  try {
    options = parseValidateArgs(args);
  } catch (error) {
    errorOutput.write(`${error.message}\n`);
    return 2;
  }
  if (!hasValidFoundation(process.cwd())) {
    errorOutput.write("Foundation validation failed: package metadata is missing or invalid\n");
    return 1;
  }
  if (options.scope === null) return 0;
  try {
    const core = await loadCore(process.cwd());
    if (options.scope === "core") return emitValidationResult({ valid: true, scope: "core", format: options.format }, output, errorOutput);
    const skill = core.skills.find((entry) => entry.id === options.skill);
    const errors = [];
    if (!Array.isArray(core.inventory?.skills) || !core.inventory.skills.includes(options.skill)) {
      errors.push({ sourcePath: "core/inventory.json", jsonPointer: "/skills", keyword: "reference", message: `skill ${options.skill} is not listed in inventory.skills` });
    }
    if (!skill) {
      errors.push({ sourcePath: "core/skills", jsonPointer: "", keyword: "reference", message: `canonical skill ${options.skill} was not found` });
    } else if (errors.length === 0) {
      const evaluations = core.evals.filter((entry) => entry.skill === options.skill || entry.skillId === options.skill || entry.skill === skill.id || entry.skillId === skill.id);
      if (evaluations.length === 0) errors.push({ sourcePath: "core/evals", jsonPointer: "", keyword: "reference", message: `evaluation cases for ${options.skill} were not found` });
      else if (!evaluations.some((entry) => Array.isArray(entry.cases) && entry.cases.length > 0)) errors.push({ sourcePath: "core/evals", jsonPointer: "", keyword: "cases", message: `evaluation cases for ${options.skill} are empty` });
    }
    return emitValidationResult({ valid: errors.length === 0, scope: "skill", skill: options.skill, errors, format: options.format }, output, errorOutput);
  } catch (error) {
    const errors = Array.isArray(error.errors) ? error.errors : [{ sourcePath: "core", jsonPointer: "", keyword: "load", message: error.message }];
    return emitValidationResult({ valid: false, scope: options.scope, ...(options.skill ? { skill: options.skill } : {}), errors, format: options.format }, output, errorOutput);
  }
}

async function evaluate(args, output, errorOutput) {
  let options;
  try {
    options = parseEvalArgs(args);
  } catch (error) {
    errorOutput.write(`${error.message}\n`);
    return 2;
  }
  try {
    if (!readCanonicalSkills(process.cwd()).includes(options.skill)) {
      errorOutput.write(`Unknown canonical skill: ${options.skill}\n`);
      return 1;
    }
  } catch (error) {
    errorOutput.write(`Unable to load canonical inventory: ${error.message}\n`);
    return 1;
  }
  if (options.samples !== 5) {
    errorOutput.write("--samples must be exactly 5 for the fresh-session evaluation contract\n");
    return 1;
  }
  try {
    const text = await readContainedUtf8Jsonl(options.inputPath);
    const lines = text.split(/\r?\n/u);
    if (lines.at(-1) === "") lines.pop();
    if (lines.some((line) => line.trim().length === 0)) throw new Error("input JSONL contains a blank record");
    if (lines.length !== options.samples) throw new Error(`input JSONL must contain exactly ${options.samples} records`);
    const cases = lines.map((line, index) => {
      try { return JSON.parse(line); } catch (error) { throw new Error(`malformed JSONL at line ${index + 1}: ${error.message}`); }
    });
    const batch = await runEvaluationBatch({
      cases,
      variant: options.variant,
      samples: options.samples,
      executeSample: async (caseRecord) => caseRecord,
      outputDir: options.outputDir
    });
    if (options.format === "json") output.write(`${JSON.stringify(batch)}\n`);
    else output.write(`variant=${batch.variant} samples=${batch.requestedSamples}\n`);
    return 0;
  } catch (error) {
    errorOutput.write(`${error.message}\n`);
    return 1;
  }
}

export async function main(args, output = process.stdout, errorOutput = process.stderr) {
  const [action, ...rest] = args;
  if (action === undefined || action === "-h" || action === "--help") {
    if (rest.length > 0) {
      errorOutput.write("Help does not accept additional arguments.\n");
      return 2;
    }
    output.write(HELP_TEXT);
    return 0;
  }

  if (!ACTIONS.has(action)) {
    errorOutput.write(`Unknown action: ${action}\n`);
    return 2;
  }

  if (action === "eval") return evaluate(rest, output, errorOutput);

  if (action === "validate") return validate(rest, output, errorOutput);

  if (rest.length > 0) {
    errorOutput.write(`Unexpected arguments for ${action}: ${rest.join(" ")}\n`);
    return 2;
  }

  if (!hasValidFoundation(process.cwd())) {
    errorOutput.write("Foundation validation failed: package metadata is missing or invalid\n");
    return 1;
  }

  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
