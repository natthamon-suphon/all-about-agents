import assert from "node:assert/strict";
import { cp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
import { makeTempRoot } from "../helpers/temp-root.mjs";

const root = process.cwd();
const inventory = JSON.parse(await readFile(resolve(root, "core/inventory.json"), "utf8"));
const validRecord = () => ({
  schemaVersion: 1,
  checkedAt: "2026-10-20",
  policyNotes: ["Fixture keeps source and native evidence separate."],
  upstreams: [
    { id: "superpowers", url: "https://github.com/obra/superpowers", version: "7.0.0", tag: "v7.0.0", resolvedCommit: "bb92a77741419a4ab5f06e711a283343f1ada0c3" },
    { id: "matt-pocock", url: "https://github.com/mattpocock/skills", version: "1.3.1", tag: "main", resolvedCommit: "5beb35b040e3de97e54fa9e386d7e42d15c295c2" }
  ],
  dispositions: inventory.skills.map((skill) => ({
    skill,
    disposition: "retained",
    sources: [{ upstream: "superpowers", paths: ["skills/brainstorming/SKILL.md"] }],
    notes: "Fixture retains the local authority boundary."
  }))
});

test("loadCore exposes reviewed pins and one disposition for every published skill", async () => {
  const core = await loadCore(root);
  assert.ok(core.upstreams, "published core must expose validated upstream provenance");
  assert.equal(core.upstreams.checkedAt, "2026-10-20");
  assert.deepEqual(core.upstreams.upstreams.map(({ id, resolvedCommit }) => [id, resolvedCommit]), [
    ["superpowers", "bb92a77741419a4ab5f06e711a283343f1ada0c3"],
    ["matt-pocock", "5beb35b040e3de97e54fa9e386d7e42d15c295c2"]
  ]);
  assert.deepEqual(core.upstreams.dispositions.map(({ skill }) => skill).sort(), [...core.inventory.skills].sort());
  assert.deepEqual(core.upstreams, (await loadCore(root)).upstreams);
});

test("loadCore rejects incomplete, ambiguous, and unsafe published provenance", async (t) => {
  const fixtureRoot = await makeTempRoot("aaa-upstreams-contract-");
  try {
    await cp(resolve(root, "core"), resolve(fixtureRoot, "core"), { recursive: true });
    const provenancePath = resolve(fixtureRoot, "core/upstreams.json");
    await writeFile(provenancePath, JSON.stringify(validRecord()));
    assert.ok((await loadCore(fixtureRoot)).upstreams, "valid fixture must be accepted before corruption");
    const cases = [
      ["missing skill", (record) => record.dispositions.pop()],
      ["duplicate skill", (record) => record.dispositions.push(record.dispositions[0])],
      ["unknown skill", (record) => { record.dispositions[0].skill = "unknown-skill"; }],
      ["unknown upstream reference", (record) => { record.dispositions[0].sources[0].upstream = "unknown"; }],
      ["unknown upstream declaration", (record) => { record.upstreams[0].id = "unknown"; }],
      ["duplicate upstream", (record) => { record.upstreams[1] = record.upstreams[0]; }],
      ["null upstream entries", (record) => { record.upstreams = [null, null]; }],
      ["null disposition entries", (record) => { record.dispositions = [null, null]; }],
      ["malformed revision", (record) => { record.upstreams[0].resolvedCommit = "v7.0.0"; }],
      ["empty explanation", (record) => { record.dispositions[0].notes = " \n "; }],
      ["no source for an adaptation", (record) => { record.dispositions[0].disposition = "adapted"; record.dispositions[0].sources = []; }],
      ...["../outside.md", "/absolute.md", "C:/outside.md", "skills\\unsafe.md", "skills/./unsafe.md", "skills//unsafe.md", "skills/a/../../unsafe.md", "skills/unsafe\0.md", "skills/unsafe\n.md", "skills/unsafe?.md", "skills/CON.md", "skills/trailing. "].map((path) => [
        `unsafe source ${JSON.stringify(path)}`,
        (record) => { record.dispositions[0].sources[0].paths = [path]; }
      ])
    ];
    for (const [label, mutate] of cases) {
      await t.test(label, async () => {
        const record = validRecord();
        mutate(record);
        await writeFile(provenancePath, JSON.stringify(record));
        await assert.rejects(loadCore(fixtureRoot), (error) => {
          assert.equal(error.name, "CoreLoadError");
          assert.ok(error.errors?.some((entry) => entry.sourcePath === "core/upstreams.json"), "rejection must identify provenance");
          return true;
        });
      });
    }
    await t.test("null is not published provenance", async () => {
      await writeFile(provenancePath, "null");
      await assert.rejects(loadCore(fixtureRoot), (error) => error.errors?.some((entry) => entry.sourcePath === "core/upstreams.json"));
    });
    await t.test("missing published record", async () => {
      await unlink(provenancePath);
      await assert.rejects(loadCore(fixtureRoot), (error) => error.errors?.some((entry) => entry.sourcePath === "core/upstreams.json"));
    });
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("generic alpha and beta cores do not require AAA provenance", async () => {
  const core = await loadCore(resolve(root, "tests/fixtures/core/valid"));
  assert.deepEqual(core.skills.map(({ id }) => id), ["alpha", "beta"]);
  assert.equal(core.upstreams, undefined);
});
