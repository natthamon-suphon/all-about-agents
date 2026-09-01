import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  AdapterContractError,
  renderSurface,
  validateNativeMappings,
  validateRenderResult
} from "../../adapters/shared/adapter-contract.mjs";
import {
  renderJSON,
  renderTOML,
  renderJson,
  renderText,
  renderToml
} from "../../adapters/shared/render-utils.mjs";
import { renderForSurface, renderPayload } from "../../installers/lib/render.mjs";

const actionIds = [
  "aaa:design",
  "aaa:build",
  "aaa:fix",
  "aaa:review",
  "aaa:audit",
  "aaa:improve-skill",
  "aaa:resume",
  "aaa:verify"
];

const actionWorkflows = {
  "aaa:design": "design-change",
  "aaa:build": "implement-change",
  "aaa:fix": "fix-bug",
  "aaa:review": "review-and-audit",
  "aaa:audit": "review-and-audit",
  "aaa:improve-skill": "improve-skill",
  "aaa:resume": "implement-change",
  "aaa:verify": "release-qualification"
};

function mappings() {
  return Object.fromEntries(actionIds.map((actionId) => [actionId, {
    required: true,
    supported: true,
    native: `native-${actionId.slice(4)}`
  }]));
}

function explicitlyUnsupportedMappings() {
  return Object.fromEntries(actionIds.map((actionId) => [actionId, {
    required: true,
    supported: false,
    support: "manual-unknown",
    source: "research-primary.md",
    reason: `No documented native mapping for ${actionId}.`,
    manualStep: `Use a manual prompt for ${actionId} after native verification.`
  }]));
}

function commands() {
  return actionIds.map((actionId) => ({
    id: actionId.slice(4),
    actionId,
    workflowId: actionWorkflows[actionId],
    arguments: { type: "object", properties: {}, required: [], additionalProperties: false },
    result: { type: "object", properties: {}, required: [], additionalProperties: false },
    presentation: { label: actionId, help: actionId }
  }));
}

function input(overrides = {}) {
  return {
    core: {
      inventory: {},
      presentation: { emojiRegistry: {}, progressContract: {} },
      globalInstructions: {
        sourcePath: "core/instructions/global-operating-rules.md",
        content: "# Fixture global operating rules\n\nUse the validated fixture core.\n"
      },
      rules: [],
      roles: [],
      skills: [],
      workflows: Object.values(actionWorkflows).filter((id, index, values) => values.indexOf(id) === index),
      commands: commands(),
      evals: []
    },
    profile: { id: "portable" },
    surface: "claude",
    statuslineName: "Agent",
    capabilityRecord: { surface: "claude", actionMappings: mappings() },
    ...overrides
  };
}

function bytes(text) {
  return new TextEncoder().encode(text);
}

function ownership(relativePath, content) {
  return {
    relativePath,
    sha256: createHash("sha256").update(content).digest("hex")
  };
}

test("renderSurface returns a validated RenderResult for complete required mappings", () => {
  const result = renderSurface(input());
  assert.deepEqual(result.files, []);
  assert.deepEqual(result.registrations, []);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual(result.ownership, []);
  assert.equal(validateRenderResult(result).valid, true);
});

test("renderSurface requires a complete canonical global instructions object", () => {
  const completeInput = input();
  for (const globalInstructions of [undefined, {}, { sourcePath: "core/instructions/global-operating-rules.md" }, { sourcePath: "other.md", content: "# Fixture global operating rules\n" }, { sourcePath: "core/instructions/global-operating-rules.md", content: 42 }]) {
    const core = { ...completeInput.core };
    if (globalInstructions === undefined) delete core.globalInstructions;
    else core.globalInstructions = globalInstructions;
    assert.throws(
      () => renderSurface({ ...completeInput, core }),
      (error) => error instanceof AdapterContractError && error.errors.some((entry) => entry.code === "invalid-core" && entry.path.startsWith("/core/globalInstructions"))
    );
  }
});

test("renderSurface rejects an empty core command list", () => {
  const completeInput = input();
  assert.throws(
    () => renderSurface({ ...completeInput, core: { ...completeInput.core, commands: [] } }),
    (error) => error instanceof AdapterContractError && error.errors.some((entry) => entry.code === "missing-action")
  );
});

test("renderSurface rejects an empty required mapping subset", () => {
  assert.throws(
    () => renderSurface(input({ capabilityRecord: { surface: "claude", actionMappings: mappings(), requiredMappings: [] } })),
    (error) => error instanceof AdapterContractError && error.errors.some((entry) => entry.code === "invalid-required-mappings")
  );
});

test("renderSurface rejects a malformed required mapping declaration", () => {
  assert.throws(
    () => renderSurface(input({ capabilityRecord: { surface: "claude", actionMappings: mappings(), requiredMappings: null } })),
    (error) => error instanceof AdapterContractError && error.errors.some((entry) => entry.code === "invalid-required-mappings")
  );
});

test("renderSurface reports omitted canonical mappings for an approved subset", () => {
  const result = renderSurface(input({
    capabilityRecord: {
      surface: "claude",
      actionMappings: mappings(),
      requiredMappings: ["aaa:design"]
    }
  }));
  assert.equal(result.diagnostics.length, actionIds.length - 1);
  assert.ok(result.diagnostics.every((diagnostic) => diagnostic.code === "native-mapping-not-required"));
  assert.ok(result.diagnostics.every((diagnostic) => diagnostic.sourcePath === null));
});

test("renderSurface rejects a missing required native mapping", () => {
  const nativeMappings = mappings();
  delete nativeMappings["aaa:review"];
  assert.throws(
    () => renderSurface(input({ capabilityRecord: { surface: "claude", actionMappings: nativeMappings } })),
    (error) => error instanceof AdapterContractError && error.errors.some((entry) => entry.code === "missing-native-mapping")
  );
});

test("renderSurface rejects an unsupported required native mapping", () => {
  const nativeMappings = mappings();
  nativeMappings["aaa:audit"] = { required: true, supported: false, reason: "not documented" };
  assert.throws(
    () => renderSurface(input({ capabilityRecord: { surface: "claude", actionMappings: nativeMappings } })),
    (error) => error instanceof AdapterContractError && error.errors.some((entry) => entry.code === "unsupported-native-mapping")
  );
});

test("native mapping validation accepts only complete explicit unsupported evidence when opted in", () => {
  const records = explicitlyUnsupportedMappings();
  const accepted = validateNativeMappings(
    { surface: "agy", actionMappings: records },
    actionIds,
    { allowExplicitUnsupported: true }
  );
  assert.equal(accepted.valid, true);
  assert.equal(accepted.errors.length, 0);
  assert.equal(accepted.diagnostics.length, actionIds.length);
  assert.ok(accepted.diagnostics.every((entry) => entry.code === "native-mapping-explicitly-unsupported"));

  delete records["aaa:audit"].manualStep;
  const incomplete = validateNativeMappings(
    { surface: "agy", actionMappings: records },
    actionIds,
    { allowExplicitUnsupported: true }
  );
  assert.equal(incomplete.valid, false);
  assert.ok(incomplete.errors.some((entry) => entry.code === "incomplete-unsupported-native-mapping"));
});

test("production rendering cannot bypass the public adapter contract", async () => {
  await assert.rejects(
    () => renderForSurface({
      repositoryRoot: process.cwd(),
      surface: "claude",
      profile: "portable",
      platform: "win32",
      capabilityRecord: { actionMappings: {} }
    }),
    (error) => error instanceof AdapterContractError && error.errors.some((entry) => entry.code === "missing-native-mapping")
  );
});

test("renderSurface rejects an empty native target", () => {
  const nativeMappings = mappings();
  nativeMappings["aaa:design"] = { required: true, supported: true, native: "" };
  assert.throws(
    () => renderSurface(input({ capabilityRecord: { surface: "claude", actionMappings: nativeMappings } })),
    (error) => error instanceof AdapterContractError && error.errors.some((entry) => entry.code === "invalid-native-target")
  );
});

test("renderSurface does not allow required canonical mappings to opt out", () => {
  const nativeMappings = mappings();
  nativeMappings["aaa:design"] = { required: false, supported: true, native: "" };
  assert.throws(
    () => renderSurface(input({ capabilityRecord: { surface: "claude", actionMappings: nativeMappings } })),
    (error) => error instanceof AdapterContractError && error.errors.some((entry) => entry.code === "invalid-native-target")
  );
});

test("renderSurface validates the synchronous adapter result", () => {
  const content = bytes("rendered\n");
  const result = renderSurface(input({
    capabilityRecord: {
      surface: "claude",
      actionMappings: mappings(),
      render: () => ({
        files: [{ relativePath: "native/output.txt", content, mode: null }],
        registrations: [],
        diagnostics: [],
        ownership: [ownership("native/output.txt", content)]
      })
    }
  }));
  assert.equal(result.files[0].relativePath, "native/output.txt");
  assert.equal(validateRenderResult(result).valid, true);
});

test("RenderResult rejects unstable file order, absolute paths, and missing ownership hashes", () => {
  const first = bytes("first\n");
  const second = bytes("second\n");
  const badOrder = {
    files: [
      { relativePath: "z.txt", content: second, mode: null },
      { relativePath: "a.txt", content: first, mode: null }
    ],
    registrations: [],
    diagnostics: [],
    ownership: [ownership("z.txt", second), ownership("a.txt", first)]
  };
  const orderResult = validateRenderResult(badOrder);
  assert.equal(orderResult.valid, false);
  assert.ok(orderResult.errors.some((error) => error.code === "unstable-file-order"));

  const absolute = structuredClone(badOrder);
  absolute.files[0].relativePath = "C:\\outside.txt";
  absolute.ownership[0].relativePath = "C:\\outside.txt";
  const absoluteResult = validateRenderResult(absolute);
  assert.equal(absoluteResult.valid, false);
  assert.ok(absoluteResult.errors.some((error) => error.code === "absolute-source-path"));

  const missingHash = structuredClone(badOrder);
  missingHash.files.reverse();
  missingHash.ownership = [{ relativePath: "a.txt" }];
  const missingHashResult = validateRenderResult(missingHash);
  assert.equal(missingHashResult.valid, false);
  assert.ok(missingHashResult.errors.some((error) => error.code === "missing-content-hash"));

  const driveRelative = structuredClone(badOrder);
  driveRelative.files.reverse();
  driveRelative.files[0].relativePath = "C:relative.txt";
  driveRelative.ownership[0].relativePath = "C:relative.txt";
  const driveResult = validateRenderResult(driveRelative);
  assert.equal(driveResult.valid, false);
  assert.ok(driveResult.errors.some((error) => error.code === "absolute-source-path"));

  const undefinedSource = structuredClone(badOrder);
  undefinedSource.files.reverse();
  undefinedSource.diagnostics = [{ code: "warning", severity: "warning", message: "warning", sourcePath: undefined }];
  const undefinedSourceResult = validateRenderResult(undefinedSource);
  assert.equal(undefinedSourceResult.valid, false);
  assert.ok(undefinedSourceResult.errors.some((error) => error.code === "invalid-diagnostic" && /sourcePath/u.test(error.message)));
});

test("text, JSON, and TOML renderers are deterministic LF documents with one trailing newline", () => {
  assert.equal(renderText("one\r\ntwo\n"), "one\ntwo\n");
  assert.equal(renderText("one\n\n"), "one\n");
  const value = { z: "last", a: { z: 2, a: 1 }, list: ["x", "y"] };
  const jsonFirst = renderJson(value);
  const jsonSecond = renderJSON(value);
  assert.equal(jsonFirst, jsonSecond);
  assert.equal(jsonFirst, `${jsonFirst.replace(/\n$/u, "")}\n`);
  assert.equal(jsonFirst.includes("\r"), false);
  const tomlFirst = renderToml({ z: "last", a: 1, table: { z: true, a: "value" } });
  const tomlSecond = renderTOML({ table: { a: "value", z: true }, a: 1, z: "last" });
  assert.equal(tomlFirst, tomlSecond);
  assert.equal(tomlFirst.endsWith("\n"), true);
  assert.equal(tomlFirst.includes("\r"), false);
});

test("renderSurface produces byte-identical complete outputs for identical input", () => {
  const content = bytes("rendered\n");
  const completeInput = input({
    capabilityRecord: {
      surface: "claude",
      actionMappings: mappings(),
      renderResult: {
        files: [{ relativePath: "native/output.txt", content, mode: null }],
        registrations: [{ id: "native" }],
        diagnostics: [],
        ownership: [ownership("native/output.txt", content)]
      }
    }
  });
  const first = renderSurface(completeInput);
  const second = renderSurface(completeInput);
  const snapshot = (result) => ({
    files: result.files.map((file) => ({ ...file, content: [...file.content] })),
    registrations: result.registrations,
    diagnostics: result.diagnostics,
    ownership: result.ownership
  });
  assert.deepEqual(snapshot(first), snapshot(second));
});

test("renderPayload dispatches selected surfaces in canonical order", async () => {
  const results = await renderPayload({ surfaces: ["agy", "claude", "codex", "antigravity-2"], profile: "portable", platform: "win32" });
  assert.deepEqual(results.map((result) => result.registrations.find((entry) => entry.kind === "profile-translation")?.surface), ["claude", "codex", "antigravity-2", "agy"]);
});

test("production rendering validates both profiles and all surfaces through the public seam", async () => {
  for (const profile of ["portable", "template"]) {
    const results = await renderPayload({ surfaces: ["agy", "claude", "codex", "antigravity-2"], profile, platform: "win32" });
    assert.equal(results.length, 4);
    for (const result of results) assert.equal(validateRenderResult(result).valid, true);
    for (const surface of ["antigravity-2", "agy"]) {
      const result = results.find((entry) => entry.registrations.some((registration) => registration.surface === surface || registration.surface === `${surface}-desktop`));
      assert.ok(result);
      assert.equal(result.diagnostics.filter((entry) => entry.code === "native-mapping-explicitly-unsupported").length, actionIds.length);
    }
  }
});

test("all surface ownership arrays are complete, sorted, unique, and hash-correct for both profiles", async () => {
  for (const profile of ["portable", "template"]) {
    const results = await renderPayload({ surfaces: ["agy", "claude", "codex", "antigravity-2"], profile, platform: "win32" });
    for (const result of results) {
      assert.deepEqual(result.ownership.map((entry) => entry.relativePath), result.files.map((file) => file.relativePath), `${result.registrations[0]?.surface}/${profile} ownership order drift`);
      assert.equal(new Set(result.ownership.map((entry) => entry.relativePath)).size, result.ownership.length, `${result.registrations[0]?.surface}/${profile} ownership paths are not unique`);
      for (const [index, entry] of result.ownership.entries()) {
        assert.match(entry.sha256, /^[0-9a-f]{64}$/u);
        assert.equal(entry.sha256, createHash("sha256").update(result.files[index].content).digest("hex"), `${result.registrations[0]?.surface}/${profile}/${entry.relativePath} hash drift`);
      }
    }
  }
});

test("validateRenderResult validates native integration registrations with stable nested paths", () => {
  const content = bytes("rendered\n");
  const result = {
    files: [{ relativePath: "native/output.txt", content, mode: null }],
    registrations: [
      { kind: "native-integration", surface: "claude", feature: "statusline", phases: {}, sourcePath: "adapters/claude/adapter.mjs", manualSteps: [] }
    ],
    diagnostics: [],
    ownership: [ownership("native/output.txt", content)]
  };
  const validation = validateRenderResult(result);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.path === "/registrations/0/phases/rendered"));
});
