import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { ArgumentError, parseArgs, validateStatuslineName } from "../../installers/lib/args.mjs";

const requiredOutputs = [
  "installers/lib/args.mjs",
  "installers/lib/roots.mjs",
  "installers/lib/render.mjs",
  "installers/lib/plan.mjs",
  "installers/lib/hash.mjs",
  "installers/schemas/plan.schema.json",
  "tests/contracts/args.test.mjs",
  "tests/contracts/roots.test.mjs",
  "tests/contracts/plan.test.mjs"
];

test("T046 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) {
    await access(resolve(process.cwd(), relativePath));
  }
});

test("parseArgs selects install, all surfaces, portable profile, and dry-run by default", () => {
  assert.deepEqual(parseArgs([]), {
    action: "install",
    surfaces: ["claude", "codex", "antigravity-2", "agy"],
    profile: "portable",
    mode: "dry-run",
    destinationRoot: null,
    statuslineName: "",
    format: "text"
  });
});

test("parseArgs accepts every public action, surface, profile, mode, root, and format", () => {
  for (const action of ["install", "doctor", "validate", "diff", "eval"]) {
    for (const surface of ["claude", "codex", "antigravity-2", "agy"]) {
      const parsed = parseArgs([action, "--surface", surface, "--profile", "template", "--apply", "--destination-root", "fixture", "--format", "json"]);
      assert.equal(parsed.action, action);
      assert.deepEqual(parsed.surfaces, [surface]);
      assert.equal(parsed.profile, "template");
      assert.equal(parsed.mode, "apply");
      assert.equal(parsed.destinationRoot, "fixture");
      assert.equal(parsed.format, "json");
    }
  }
  assert.deepEqual(parseArgs(["--surface", "all"]).surfaces, ["claude", "codex", "antigravity-2", "agy"]);
});

test("parseArgs preserves explicit empty statusline names and trims safe Unicode data", () => {
  assert.equal(parseArgs(["--surface", "claude", "--statusline-name", ""]).statuslineName, "");
  assert.equal(parseArgs(["--surface", "claude", "--statusline-name="]).statuslineName, "");
  assert.equal(parseArgs(["--surface", "claude", "--statusline-name", "  คุณ 🚀  "]).statuslineName, "คุณ 🚀");
  assert.equal(parseArgs(["--surface", "claude", "--statusline-name", `quote\\path "ok"`]).statuslineName, `quote\\path "ok"`);
});

test("validateStatuslineName accepts 64 code points and rejects overlength or terminal input", () => {
  assert.equal(validateStatuslineName("ก".repeat(64)), "ก".repeat(64));
  for (const value of ["ก".repeat(65), "line\nfeed", "tab\tvalue", "\u001b[31mred", "\u009b31mred"]) {
    assert.throws(() => validateStatuslineName(value), ArgumentError);
  }
});

test("validateStatuslineName rejects controls before trimming outer whitespace", () => {
  for (const value of ["name\n", "\nname", "name\r", "\tname"]) {
    assert.throws(() => validateStatuslineName(value), ArgumentError);
  }
  assert.equal(validateStatuslineName("  name  "), "name");
});

test("parseArgs rejects duplicates, missing values, conflicts, invalid values, and inapplicable statusline input", () => {
  const cases = [
    [["--surface", "claude", "--surface", "codex"], /Duplicate option/u],
    [["--profile"], /Missing value/u],
    [["--destination-root", "--apply"], /Missing value/u],
    [["--dry-run", "--apply"], /Duplicate option/u],
    [["--surface", "unknown"], /surface/u],
    [["--profile", "unknown"], /profile/u],
    [["--format", "xml"], /format/u],
    [["--surface", "codex", "--statusline-name", "name"], /inapplicable/u]
  ];
  for (const [argv, expected] of cases) assert.throws(() => parseArgs(argv), expected);
});

test("omitted statusline input is non-blocking by default and can be explicitly injected once", () => {
  assert.equal(parseArgs(["--surface", "claude"]).statuslineName, "");
  let prompts = 0;
  const parsed = parseArgs(["--surface", "claude"], { interactive: true, prompt: (label) => { prompts += 1; assert.equal(label, "Statusline display name"); return "interactive"; } });
  assert.equal(parsed.statuslineName, "interactive");
  assert.equal(prompts, 1);
  assert.throws(() => parseArgs(["--surface", "claude"], { interactive: true }), /prompt callback/u);
});
