import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const requiredOutputs = [
  "core/hooks/bootstrap.json",
  "adapters/claude/templates/hooks/bootstrap.json",
  "adapters/codex/templates/hooks/bootstrap.json",
  "adapters/antigravity-2/templates/hooks/bootstrap.json",
  "adapters/agy/templates/hooks/bootstrap.json",
  "tests/contracts/bootstrap-hooks.test.mjs"
];

const root = (relativePath) => resolve(process.cwd(), relativePath);
const readJson = async (relativePath) => JSON.parse(await readFile(root(relativePath), "utf8"));
const CONTENT_TOKEN = "{{canonicalContent}}";

function replaceContent(value, canonicalContent) {
  if (typeof value === "string") return value.replaceAll(CONTENT_TOKEN, canonicalContent);
  if (Array.isArray(value)) return value.map((item) => replaceContent(item, canonicalContent));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaceContent(child, canonicalContent)]));
  }
  return value;
}

function structuredOutput(output, canonicalContent) {
  const resolved = replaceContent(output, canonicalContent);
  return JSON.parse(JSON.stringify(resolved));
}

function parseHookInput(rawInput) {
  try {
    const parsed = JSON.parse(rawInput);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("hook input must be an object");
    return { valid: true, value: parsed };
  } catch {
    return { valid: false, value: null };
  }
}

function declaredHookOutput(template, rawInput, canonicalContent) {
  const parsed = parseHookInput(rawInput);
  if (!parsed.valid) return structuredOutput(template.input.malformedOutput, canonicalContent);
  if (template.event === "SessionStart") return structuredOutput(template.firstSessionOutput, canonicalContent);
  const first = template.firstSessionWhen;
  const isFirst = parsed.value.invocationNum === first.invocationNum && parsed.value.initialNumSteps === first.initialNumSteps;
  return structuredOutput(isFirst ? template.firstSessionOutput : template.otherSessionOutput, canonicalContent);
}

function contentOccurrences(value, canonicalContent) {
  if (typeof value === "string") return value.split(canonicalContent).length - 1;
  if (Array.isArray(value)) return value.reduce((count, item) => count + contentOccurrences(item, canonicalContent), 0);
  if (value && typeof value === "object") {
    return Object.values(value).reduce((count, child) => count + contentOccurrences(child, canonicalContent), 0);
  }
  return 0;
}

test("T013 creates every owned artifact", async () => {
  assert.ok(requiredOutputs.length > 0);
  for (const relativePath of requiredOutputs) {
    await access(root(relativePath));
  }
});

test("canonical bootstrap declares a fail-open first-session module", async () => {
  const bootstrap = await readJson("core/hooks/bootstrap.json");
  assert.equal(bootstrap.id, "bootstrap");
  assert.equal(bootstrap.failureMode, "fail-open");
  assert.equal(bootstrap.failureDiagnostic, "Bootstrap skipped: malformed hook input; the session continues without injected context.");
  assert.equal(bootstrap.contentRef, "core/skills/using-all-about-agents/SKILL.md");
  assert.deepEqual(bootstrap.surfaces, ["claude", "codex", "antigravity-2", "agy"]);
  assert.equal(contentOccurrences(bootstrap, bootstrap.contentRef), 1);
});

test("Claude maps all documented session-start matchers to structured context output", async () => {
  const template = await readJson("adapters/claude/templates/hooks/bootstrap.json");
  assert.equal(template.surface, "claude");
  assert.equal(template.event, "SessionStart");
  assert.deepEqual(template.matchers, ["startup", "resume", "clear", "compact", "fork"]);
  assert.equal(template.contentRef, "core/skills/using-all-about-agents/SKILL.md");
  assert.equal(template.failureMode, "fail-open");
  assert.deepEqual(template.runtime, {
    executable: "node",
    minimumVersion: "22.12.0",
    preflight: "required",
    missingRuntime: "unavailable"
  });
  assert.deepEqual(template.input.malformedOutput, {});
  assert.match(template.input.malformedDiagnostic, /fail-open|session continues/iu);
  assert.deepEqual(template.firstSessionOutput, {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: "{{canonicalContent}}"
    }
  });
});

test("Codex maps SessionStart to the structured context output", async () => {
  const template = await readJson("adapters/codex/templates/hooks/bootstrap.json");
  assert.equal(template.surface, "codex");
  assert.equal(template.event, "SessionStart");
  assert.equal(template.contentRef, "core/skills/using-all-about-agents/SKILL.md");
  assert.equal(template.failureMode, "fail-open");
  assert.deepEqual(template.runtime, {
    executable: "node",
    minimumVersion: "22.12.0",
    preflight: "required",
    missingRuntime: "unavailable"
  });
  assert.deepEqual(template.input.malformedOutput, {});
  assert.match(template.input.malformedDiagnostic, /fail-open|session continues/iu);
  assert.deepEqual(template.firstSessionOutput, {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: "{{canonicalContent}}"
    }
  });
});

test("Antigravity uses zero-indexed first PreInvocation and ephemeral context", async () => {
  const template = await readJson("adapters/antigravity-2/templates/hooks/bootstrap.json");
  assert.equal(template.surface, "antigravity-2");
  assert.equal(template.event, "PreInvocation");
  assert.deepEqual(template.firstSessionWhen, { invocationNum: 0, initialNumSteps: 0 });
  assert.equal(template.contentRef, "core/skills/using-all-about-agents/SKILL.md");
  assert.equal(template.failureMode, "fail-open");
  assert.deepEqual(template.runtime, {
    executable: "node",
    minimumVersion: "22.12.0",
    preflight: "required",
    missingRuntime: "unavailable"
  });
  assert.deepEqual(template.input.fields, { invocationNum: "integer", initialNumSteps: "integer" });
  assert.deepEqual(template.input.malformedOutput, {});
  assert.match(template.input.malformedDiagnostic, /fail-open|session continues/iu);
  assert.deepEqual(template.firstSessionOutput, {
    injectSteps: [{ ephemeralMessage: "{{canonicalContent}}" }]
  });
  assert.deepEqual(template.otherSessionOutput, { injectSteps: [] });
});

test("agy uses the same documented zero-indexed PreInvocation contract", async () => {
  const template = await readJson("adapters/agy/templates/hooks/bootstrap.json");
  assert.equal(template.surface, "agy");
  assert.equal(template.event, "PreInvocation");
  assert.deepEqual(template.firstSessionWhen, { invocationNum: 0, initialNumSteps: 0 });
  assert.equal(template.contentRef, "core/skills/using-all-about-agents/SKILL.md");
  assert.equal(template.failureMode, "fail-open");
  assert.deepEqual(template.runtime, {
    executable: "node",
    minimumVersion: "22.12.0",
    preflight: "required",
    missingRuntime: "unavailable"
  });
  assert.deepEqual(template.input.fields, { invocationNum: "integer", initialNumSteps: "integer" });
  assert.deepEqual(template.input.malformedOutput, {});
  assert.match(template.input.malformedDiagnostic, /fail-open|session continues/iu);
  assert.deepEqual(template.firstSessionOutput, {
    injectSteps: [{ ephemeralMessage: "{{canonicalContent}}" }]
  });
  assert.deepEqual(template.otherSessionOutput, { injectSteps: [] });
});

test("Claude startup, clear, and compact each inject canonical content exactly once", async () => {
  const template = await readJson("adapters/claude/templates/hooks/bootstrap.json");
  const canonicalContent = await readFile(root(template.contentRef), "utf8");
  for (const matcher of ["startup", "clear", "compact"]) {
    assert.ok(template.matchers.includes(matcher));
    const output = declaredHookOutput(template, JSON.stringify({ matcher }), canonicalContent);
    const serialized = JSON.stringify(output);
    assert.equal(contentOccurrences(output, canonicalContent), 1, `${matcher} must inject the skill exactly once`);
    assert.deepEqual(JSON.parse(serialized), output, "hook output must remain structured JSON");
  }
});

test("Codex SessionStart injects canonical content exactly once and malformed input fails open", async () => {
  const template = await readJson("adapters/codex/templates/hooks/bootstrap.json");
  const canonicalContent = await readFile(root(template.contentRef), "utf8");
  const output = declaredHookOutput(template, JSON.stringify({}), canonicalContent);
  assert.equal(contentOccurrences(output, canonicalContent), 1);
  assert.deepEqual(declaredHookOutput(template, "{malformed", canonicalContent), {});
});

for (const surface of ["antigravity-2", "agy"]) {
  test(`${surface} injects only on invocation 0 with zero initial steps`, async () => {
    const template = await readJson(`adapters/${surface}/templates/hooks/bootstrap.json`);
    const canonicalContent = await readFile(root(template.contentRef), "utf8");
    const first = declaredHookOutput(template, JSON.stringify({ invocationNum: 0, initialNumSteps: 0 }), canonicalContent);
    assert.equal(contentOccurrences(first, canonicalContent), 1);
    assert.deepEqual(first, { injectSteps: [{ ephemeralMessage: canonicalContent }] });

    for (const nonFirst of [
      JSON.stringify({ invocationNum: 1, initialNumSteps: 0 }),
      JSON.stringify({ initialNumSteps: 0 }),
      JSON.stringify({ invocationNum: 0 }),
      JSON.stringify({ invocationNum: 0, initialNumSteps: 2 })
    ]) {
      const output = declaredHookOutput(template, nonFirst, canonicalContent);
      assert.deepEqual(output, { injectSteps: [] });
      assert.equal(contentOccurrences(output, canonicalContent), 0);
    }

    const malformed = declaredHookOutput(template, "{malformed", canonicalContent);
    assert.deepEqual(malformed, {}, "malformed input must fail open without assuming first invocation");
    assert.equal(contentOccurrences(malformed, canonicalContent), 0);
  });
}

test("every native template uses one content slot and fails open for malformed JSON", async () => {
  const templates = [
    "adapters/claude/templates/hooks/bootstrap.json",
    "adapters/codex/templates/hooks/bootstrap.json",
    "adapters/antigravity-2/templates/hooks/bootstrap.json",
    "adapters/agy/templates/hooks/bootstrap.json"
  ];
  for (const templatePath of templates) {
    const template = await readJson(templatePath);
    const canonicalContent = await readFile(root(template.contentRef), "utf8");
    assert.equal(contentOccurrences(template.firstSessionOutput, CONTENT_TOKEN), 1, `${template.surface} must have one content slot`);
    assert.equal(contentOccurrences(template.input.malformedOutput, CONTENT_TOKEN), 0);
    const malformedOutputs = ["{malformed", "[]"];
    for (const malformedInput of malformedOutputs) {
      const output = declaredHookOutput(template, malformedInput, canonicalContent);
      assert.deepEqual(output, template.input.malformedOutput, `${template.surface} malformed input must fail open`);
      assert.equal(contentOccurrences(output, canonicalContent), 0, `${template.surface} must not treat malformed input as first invocation`);
      assert.deepEqual(JSON.parse(JSON.stringify(output)), output, "malformed output must be structured JSON");
    }
  }
});

test("native templates agree with the canonical surface event map", async () => {
  const bootstrap = await readJson("core/hooks/bootstrap.json");
  const templatePaths = Object.fromEntries([
    ["claude", "adapters/claude/templates/hooks/bootstrap.json"],
    ["codex", "adapters/codex/templates/hooks/bootstrap.json"],
    ["antigravity-2", "adapters/antigravity-2/templates/hooks/bootstrap.json"],
    ["agy", "adapters/agy/templates/hooks/bootstrap.json"]
  ]);
  for (const [surface, templatePath] of Object.entries(templatePaths)) {
    const template = await readJson(templatePath);
    const canonical = bootstrap.firstSession[surface];
    assert.equal(template.event, canonical.event, `${surface} event must remain canonical`);
    assert.equal(template.contentRef, bootstrap.contentRef);
    if (canonical.matchers) assert.deepEqual(template.matchers, canonical.matchers);
    if (canonical.when) assert.deepEqual(template.firstSessionWhen, canonical.when);
  }
});

test("native templates require a runtime preflight and report missing Node as unavailable", async () => {
  const templates = [
    "adapters/claude/templates/hooks/bootstrap.json",
    "adapters/codex/templates/hooks/bootstrap.json",
    "adapters/antigravity-2/templates/hooks/bootstrap.json",
    "adapters/agy/templates/hooks/bootstrap.json"
  ];
  for (const templatePath of templates) {
    const template = await readJson(templatePath);
    assert.equal(template.runtime.executable, "node");
    assert.equal(template.runtime.minimumVersion, "22.12.0");
    assert.equal(template.runtime.preflight, "required");
    assert.equal(template.runtime.missingRuntime, "unavailable");
  }
});
