import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { readContainedUtf8Jsonl, runEvaluationBatch } from "../core/evals/runner.mjs";

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
