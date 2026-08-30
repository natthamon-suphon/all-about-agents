import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const id = "nano-image-generator";
const cases = ["NI-TRIGGER-explicit-image-generation", "NI-NONTRIGGER-code-native-SVG", "NI-PRESSURE-missing-key-stale-model"];
const read = (name = "SKILL.md") => readFile(new URL(`../../../core/skills/${id}/${name}`, import.meta.url), "utf8");

test("T042 exposes routing evidence", async () => {
  const skill = await read();
  const evaluation = JSON.parse(await readFile(new URL(`../../../core/evals/skill-routing/${id}.json`, import.meta.url), "utf8"));
  assert.match(skill, /^---\n/u);
  for (const value of cases) assert.match(JSON.stringify(evaluation), new RegExp(value));
});

test("image-generation protocol validates authority, prerequisites, model, and safe output", async () => {
  const skill = await read();
  for (const term of ["Skill Gate Protocol", "explicit", "paid", "model", "prerequisite", "redact", "base64", "magic", "not run"]) assert.match(skill, new RegExp(term, "iu"));
  assert.match(skill, /code-native|SVG/iu);
  assert.doesNotMatch(skill, /gemini-3-pro-image-preview/iu);
});

test("Python runtime keeps credentials in headers and rejects malformed image data", async () => {
  const scriptUrl = new URL(`../../../core/skills/${id}/scripts/generate_image.py`, import.meta.url);
  const script = await read("scripts/generate_image.py");
  assert.match(script, /x-goog-api-key/u);
  assert.doesNotMatch(script, /\?key=|error_body|Response:\s*\{/u);
  assert.match(script, /b64decode\([^\n]+validate=True/u);
  assert.match(script, /authorize-paid-request/u);

  const probe = String.raw`
import importlib.util
spec = importlib.util.spec_from_file_location("nano", r"${decodeURIComponent(scriptUrl.pathname).replace(/^\/(?:([A-Za-z]:))/u, "$1").replaceAll("\\", "\\\\")}")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
assert m.detect_image_format(b"\x89PNG\r\n\x1a\nrest") == ("image/png", ".png")
for value in ("%%%%", "YWJjZA==="):
    try:
        m.decode_image_data(value, "image/png")
    except m.SafeError:
        pass
    else:
        raise AssertionError("malformed or unknown image bytes accepted")
try:
    m.require_paid_authority(False)
except m.SafeError:
    pass
else:
    raise AssertionError("paid request was not gated")
request = m.build_request("GET", "/models/example", "top-secret")
assert request.get_header("X-goog-api-key") == "top-secret"
assert "top-secret" not in request.full_url and "?key=" not in request.full_url
assert "top-secret" not in m.safe_http_message(403, "top-secret sensitive body")
`;
  const result = spawnSync("python", ["-c", probe], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("image routing covers explicit generation, SVG nontrigger, and stale-model pressure", async () => {
  const evaluation = JSON.parse(await readFile(new URL(`../../../core/evals/skill-routing/${id}.json`, import.meta.url), "utf8"));
  assert.deepEqual(evaluation.cases.map((entry) => entry.id), cases);
  for (const entry of evaluation.cases) assert.equal(entry.critical, true);
  assert.equal(evaluation.cases[0].expected.skillCheck, "required");
  assert.equal(evaluation.cases[0].expected.requirePaidAuthority, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.codeNativeAsset, true);
  assert.equal(evaluation.cases[2].expected.validateModelAtRuntime, true);
  assert.equal(evaluation.cases[2].expected.noRequestWithoutKey, true);
});

test("core loader exposes image metadata and runtime script", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  assert.deepEqual(core.skills.find((entry) => entry.id === id)?.evaluationCases, cases);
  assert.deepEqual(core.inventory.skillSources.find((entry) => entry.name === id)?.scripts, ["skills/nano-image-generator/scripts/generate_image.py"]);
});
