import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

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

export function main(args, output = process.stdout, errorOutput = process.stderr) {
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
  process.exitCode = main(process.argv.slice(2));
}
