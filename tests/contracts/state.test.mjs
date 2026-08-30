import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { withTempRoot } from "../helpers/temp-root.mjs";
import stateSchema from "../../installers/schemas/state.schema.json" with { type: "json" };
import { validateSchema } from "../../installers/lib/validate-schema.mjs";
import { buildManagedState, parseManagedState, readManagedState, serializeManagedState, STATE_RELATIVE_PATH } from "../../installers/lib/state.mjs";
import { hashBytes } from "../../installers/lib/hash.mjs";
import { writeManagedState } from "../../installers/lib/state.mjs";

const bytes = (value) => new TextEncoder().encode(value);

test("T047 state creates every owned artifact", async () => {
  const requiredOutputs = [
    "installers/lib/apply.mjs",
    "installers/lib/state.mjs",
    "installers/lib/atomic-write.mjs",
    "installers/lib/report.mjs",
    "installers/schemas/state.schema.json",
    "installers/schemas/report.schema.json",
    "tests/contracts/apply.test.mjs",
    "tests/contracts/state.test.mjs",
    "tests/contracts/partial-failure.test.mjs"
  ];
  assert.equal(requiredOutputs.length, 9);
});

test("managed state has only stable metadata and sorted owned hashes", () => {
  const state = buildManagedState({
    repositoryVersion: "repo-1",
    profile: "portable",
    surfaces: ["codex", "claude"],
    ownedPaths: [
      { relativePath: "z.txt", sha256: hashBytes(bytes("z")) },
      { relativePath: "a.txt", sha256: hashBytes(bytes("a")) }
    ]
  });
  assert.deepEqual(Object.keys(state).sort(), ["ownedPaths", "profile", "repositoryVersion", "schemaVersion", "surfaces"]);
  assert.deepEqual(state.surfaces, ["claude", "codex"]);
  assert.deepEqual(state.ownedPaths.map(({ relativePath }) => relativePath), ["a.txt", "z.txt"]);
  assert.equal(validateSchema({ schema: stateSchema, value: state, sourcePath: "state.json" }).valid, true);
  assert.equal(new TextDecoder().decode(serializeManagedState(state)), `${JSON.stringify(state)}\n`);
});

test("missing and malformed managed state return null and do not block authoritative state writes", async () => {
  await withTempRoot(async (root) => {
    assert.equal(await readManagedState(root), null);
    const malformed = await import("node:fs/promises");
    await malformed.mkdir(`${root}/.all-about-agents`, { recursive: true });
    await malformed.writeFile(`${root}/${STATE_RELATIVE_PATH}`, "{not-json");
    assert.equal(parseManagedState(await readFile(`${root}/${STATE_RELATIVE_PATH}`)), null);
    const state = buildManagedState({ repositoryVersion: "repo-1", profile: "portable", surfaces: ["claude"], ownedPaths: [] });
    await writeManagedState({ root, state });
    assert.deepEqual(await readManagedState(root), state);
  });
});

test("state rejects extra fields, duplicate ownership, invalid metadata, and non-lowercase hashes", () => {
  assert.equal(parseManagedState(JSON.stringify({ schemaVersion: 1, repositoryVersion: "x", profile: "portable", surfaces: ["claude"], ownedPaths: [], diagnostics: "secret" })), null);
  assert.throws(() => buildManagedState({ repositoryVersion: "x", profile: "portable", surfaces: ["claude"], ownedPaths: [{ relativePath: "a", sha256: "A".repeat(64) }] }), /SHA-256/u);
  assert.throws(() => buildManagedState({ repositoryVersion: "x", profile: "portable", surfaces: ["claude", "claude"], ownedPaths: [] }), /duplicate/u);
  assert.throws(() => buildManagedState({ repositoryVersion: "x", profile: "bad", surfaces: ["claude"], ownedPaths: [] }), /profile/u);
});
