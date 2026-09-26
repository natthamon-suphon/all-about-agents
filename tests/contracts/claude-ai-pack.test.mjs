import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { crc32, inflateRawSync } from "node:zlib";

import { buildSkillArchive, createZip, loadPack, PackValidationError, parseSkillFile, validateSkill } from "../../scripts/lib/claude-ai-pack.mjs";
import { exportPack, main } from "../../scripts/export-claude-ai.mjs";

const encoder = new TextEncoder();
const VALID_DESCRIPTION = "Demonstrates one pack behavior for tests. Use when a test needs a valid skill.";
const VALID_BODY = "# Demo\n\nFollow [the shared rules](references/conventions.md).\n";

function skillText({ name = "aaa-demo", description = VALID_DESCRIPTION, extraFront = "", body = VALID_BODY } = {}) {
  return `---\nname: ${name}\ndescription: ${description}\n${extraFront}---\n${body}`;
}

function skill(folderName, text, extraFiles = {}) {
  const files = [{ path: "SKILL.md", text }, ...Object.entries(extraFiles).map(([path, value]) => ({ path, text: value }))]
    .map(({ path, text: value }) => ({ path, bytes: encoder.encode(value) }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  return { name: folderName, files };
}

function codes(errors) {
  return errors.map((entry) => entry.code);
}

test("parseSkillFile unquotes one-line values and returns the body", () => {
  const parsed = parseSkillFile(skillText({ description: `"${VALID_DESCRIPTION}"` }));
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.frontmatter, { name: "aaa-demo", description: VALID_DESCRIPTION });
  assert.equal(parsed.body, VALID_BODY);
});

test("a valid skill has no validation errors", () => {
  assert.deepEqual(validateSkill(skill("aaa-demo", skillText())), []);
});

const defects = [
  ["skill-md-missing", () => ({ name: "aaa-demo", files: [{ path: "notes.md", bytes: encoder.encode("# Notes\n") }] })],
  ["frontmatter-missing", () => skill("aaa-demo", `# No frontmatter\n\n${VALID_BODY}`)],
  ["frontmatter-missing", () => skill("aaa-demo", `---\nname: aaa-demo\ndescription: ${VALID_DESCRIPTION}\n${VALID_BODY}`)],
  ["frontmatter-key", () => skill("aaa-demo", skillText({ extraFront: "license: MIT\n" }))],
  ["frontmatter-line", () => skill("aaa-demo", skillText({ extraFront: "  wrapped description text\n" }))],
  ["name-format", () => skill("demo", skillText({ name: "demo" }))],
  ["name-format", () => skill("aaa-Demo", skillText({ name: "aaa-Demo" }))],
  ["name-format", () => skill(`aaa-${"x".repeat(61)}`, skillText({ name: `aaa-${"x".repeat(61)}` }))],
  ["name-reserved", () => skill("aaa-claude-x", skillText({ name: "aaa-claude-x" }))],
  ["name-reserved", () => skill("aaa-anthropic", skillText({ name: "aaa-anthropic" }))],
  ["name-mismatch", () => skill("aaa-demo", skillText({ name: "aaa-other" }))],
  ["description-length", () => skill("aaa-demo", skillText({ description: "\"\"" }))],
  ["description-length", () => skill("aaa-demo", skillText({ description: "d".repeat(201) }))],
  ["description-angle", () => skill("aaa-demo", skillText({ description: "Writes <b>bold</b> summaries. Use when asked." }))],
  ["yaml-unsafe", () => skill("aaa-demo", skillText({ description: "Does one thing: another. Use when asked." }))],
  ["yaml-unsafe", () => skill("aaa-demo", skillText({ description: "Does one thing #comment. Use when asked." }))],
  ["yaml-unsafe", () => skill("aaa-demo", skillText({ description: "*Starts with a star. Use when asked." }))],
  ["body-lines", () => skill("aaa-demo", skillText({ body: `${VALID_BODY}${"line\n".repeat(500)}` }))],
  ["colon-prefix", () => skill("aaa-demo", skillText({ body: `${VALID_BODY}Run aaa:interview next.\n` }))],
  ["absolute-path", () => skill("aaa-demo", skillText({ body: `${VALID_BODY}Open /Users/someone/file.md\n` }))],
  ["absolute-path", () => skill("aaa-demo", skillText({ body: `${VALID_BODY}Open C:\\temp\\file.md\n` }))],
  ["absolute-path", () => skill("aaa-demo", skillText({ body: `${VALID_BODY}Open ~/notes.md\n` }))],
  ["broken-link", () => skill("aaa-demo", skillText({ body: `${VALID_BODY}See [missing](missing.md).\n` }))],
  ["broken-link", () => skill("aaa-demo", skillText({ body: `${VALID_BODY}See [outside](../other/SKILL.md).\n` }))],
  ["reserved-file", () => skill("aaa-demo", skillText(), { "references/conventions.md": "# Own copy\n" })]
];

for (const [code, build] of defects) {
  test(`validateSkill reports ${code}`, () => {
    assert.ok(codes(validateSkill(build())).includes(code), `expected ${code} in ${JSON.stringify(validateSkill(build()))}`);
  });
}

test("a quoted value may contain a colon and a hash", () => {
  const errors = validateSkill(skill("aaa-demo", skillText({ description: "\"Does one thing: another #1. Use when asked.\"" })));
  assert.deepEqual(errors, []);
});

test("links to present files, fragments, external URLs, and the shared conventions are not broken", () => {
  const body = `${VALID_BODY}See [template](templates/record.md), [top](#demo), [site](https://example.com/a), [mail](mailto:a@example.com).\n`;
  const template = "# Record\n\nBack to [rules](../references/conventions.md) and [skill](../SKILL.md#demo).\n";
  const errors = validateSkill(skill("aaa-demo", skillText({ body }), { "templates/record.md": template }));
  assert.deepEqual(errors, []);
});

test("every error names the file it came from", () => {
  const errors = validateSkill(skill("aaa-demo", skillText(), { "templates/record.md": "Run aaa:run now.\n" }));
  const colon = errors.find((entry) => entry.code === "colon-prefix");
  assert.equal(colon?.path, "templates/record.md");
});

function readZip(bytes) {
  const buffer = Buffer.from(bytes);
  const endOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(endOffset >= 0, "end of central directory record is missing");
  const count = buffer.readUInt16LE(endOffset + 10);
  let cursor = buffer.readUInt32LE(endOffset + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50);
    const method = buffer.readUInt16LE(cursor + 10);
    const checksum = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const path = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50, `${path} local header is missing`);
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    const content = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    assert.equal(crc32(content), checksum, `${path} CRC mismatch`);
    entries.push({ path, bytes: new Uint8Array(content) });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

const textOf = (bytes) => new TextDecoder().decode(bytes);

test("createZip round-trips files and directories", () => {
  const entries = [
    { path: "demo/", bytes: undefined },
    { path: "demo/a.md", bytes: encoder.encode("# A\n") },
    { path: "demo/empty.md", bytes: new Uint8Array(0) }
  ].map(({ path, bytes }) => (bytes === undefined ? { path } : { path, bytes }));
  const read = readZip(createZip(entries));
  assert.deepEqual(read.map((entry) => entry.path), ["demo/", "demo/a.md", "demo/empty.md"]);
  assert.equal(textOf(read[1].bytes), "# A\n");
  assert.equal(read[2].bytes.byteLength, 0);
});

test("createZip is deterministic and ignores input order", () => {
  const entries = [{ path: "x/" }, { path: "x/b.md", bytes: encoder.encode("b") }, { path: "x/a.md", bytes: encoder.encode("a") }];
  const first = createZip(entries);
  assert.deepEqual(createZip(entries), first);
  assert.deepEqual(createZip([...entries].reverse()), first);
});

for (const [label, entries] of [
  ["empty path", [{ path: "", bytes: encoder.encode("x") }]],
  ["absolute path", [{ path: "/abs.md", bytes: encoder.encode("x") }]],
  ["backslash", [{ path: "a\\b.md", bytes: encoder.encode("x") }]],
  ["parent segment", [{ path: "a/../b.md", bytes: encoder.encode("x") }]],
  ["duplicate", [{ path: "a.md", bytes: encoder.encode("x") }, { path: "a.md", bytes: encoder.encode("y") }]],
  ["file without bytes", [{ path: "a.md" }]],
  ["directory with bytes", [{ path: "a/", bytes: encoder.encode("x") }]]
]) {
  test(`createZip rejects ${label}`, () => {
    assert.throws(() => createZip(entries), TypeError);
  });
}

test("buildSkillArchive nests the skill folder and adds the shared conventions", () => {
  const archive = buildSkillArchive(skill("aaa-demo", skillText()), encoder.encode("# Conventions\n"));
  assert.equal(archive.name, "aaa-demo");
  assert.equal(archive.fileName, "aaa-demo.zip");
  const read = readZip(archive.bytes);
  assert.deepEqual(read.map((entry) => entry.path), ["aaa-demo/", "aaa-demo/SKILL.md", "aaa-demo/references/", "aaa-demo/references/conventions.md"]);
  assert.equal(textOf(read[3].bytes), "# Conventions\n");
});

test("buildSkillArchive refuses a skill that ships its own conventions file", () => {
  const own = skill("aaa-demo", skillText(), { "references/conventions.md": "# Own\n" });
  assert.throws(() => buildSkillArchive(own, encoder.encode("# Shared\n")), TypeError);
});

test("system unzip accepts the archive", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "aaa-zip-"));
  try {
    const file = join(directory, "aaa-demo.zip");
    await writeFile(file, buildSkillArchive(skill("aaa-demo", skillText()), encoder.encode("# C\n")).bytes);
    const result = spawnSync("unzip", ["-t", file], { encoding: "utf8", windowsHide: true });
    if (result.error?.code === "ENOENT") {
      t.skip("unzip unavailable");
      return;
    }
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /No errors detected/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

async function fixtureRepository({ description = VALID_DESCRIPTION } = {}) {
  const root = await mkdtemp(join(tmpdir(), "aaa-pack-"));
  await mkdir(join(root, "claude-ai", "shared"), { recursive: true });
  await mkdir(join(root, "claude-ai", "skills", "aaa-demo"), { recursive: true });
  await writeFile(join(root, "claude-ai", "shared", "conventions.md"), "# Conventions\n");
  await writeFile(join(root, "claude-ai", "skills", "aaa-demo", "SKILL.md"), skillText({ description }));
  return root;
}

async function listOrEmpty(path) {
  try {
    return await readdir(path);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

test("loadPack reads conventions and skill files in sorted order", async () => {
  const root = await fixtureRepository();
  try {
    await mkdir(join(root, "claude-ai", "skills", "aaa-demo", "templates"));
    await writeFile(join(root, "claude-ai", "skills", "aaa-demo", "templates", "record.md"), "# Record\n");
    await writeFile(join(root, "claude-ai", "skills", "aaa-demo", ".DS_Store"), "noise");
    const pack = await loadPack(join(root, "claude-ai"));
    assert.equal(textOf(pack.conventions), "# Conventions\n");
    assert.deepEqual(pack.skills.map((entry) => entry.name), ["aaa-demo"]);
    assert.deepEqual(pack.skills[0].files.map((file) => file.path), ["SKILL.md", "templates/record.md"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadPack rejects a symlinked skill file", async (t) => {
  const root = await fixtureRepository();
  try {
    const skillFile = join(root, "claude-ai", "skills", "aaa-demo", "SKILL.md");
    const target = join(root, "outside.md");
    await writeFile(target, skillText());
    await rm(skillFile);
    try {
      await symlink(target, skillFile);
    } catch (error) {
      if (error?.code === "EPERM") {
        t.skip("symlink creation is not permitted");
        return;
      }
      throw error;
    }
    await assert.rejects(loadPack(join(root, "claude-ai")), /symlink/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exportPack writes one deterministic archive per skill", async () => {
  const root = await fixtureRepository();
  try {
    const first = await exportPack({ repositoryRoot: root, outputDir: join(root, "out-1") });
    const second = await exportPack({ repositoryRoot: root, outputDir: join(root, "out-2") });
    assert.deepEqual(first.archives.map((entry) => entry.name), ["aaa-demo"]);
    assert.equal(first.archives[0].sha256, second.archives[0].sha256);
    assert.deepEqual(await readdir(join(root, "out-1")), ["aaa-demo.zip"]);
    const read = readZip(await readFile(join(root, "out-1", "aaa-demo.zip")));
    assert.ok(read.some((entry) => entry.path === "aaa-demo/references/conventions.md"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exportPack defaults to the gitignored .aaa/claude-ai folder", async () => {
  const root = await fixtureRepository();
  try {
    const result = await exportPack({ repositoryRoot: root });
    assert.equal(result.archives[0].path, join(root, ".aaa", "claude-ai", "aaa-demo.zip"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exportPack writes nothing when a skill is invalid", async () => {
  const root = await fixtureRepository({ description: "d".repeat(201) });
  try {
    const outputDir = join(root, "out");
    await assert.rejects(exportPack({ repositoryRoot: root, outputDir }), (error) => {
      assert.ok(error instanceof PackValidationError);
      assert.equal(error.errors[0].code, "description-length");
      assert.equal(error.errors[0].skill, "aaa-demo");
      return true;
    });
    assert.deepEqual(await listOrEmpty(outputDir), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exportPack preserves unrelated files in the output folder", async () => {
  const root = await fixtureRepository();
  try {
    const outputDir = join(root, "out");
    await mkdir(outputDir);
    await writeFile(join(outputDir, "keep.txt"), "keep me");
    await exportPack({ repositoryRoot: root, outputDir });
    assert.equal(await readFile(join(outputDir, "keep.txt"), "utf8"), "keep me");
    assert.deepEqual((await readdir(outputDir)).sort(), ["aaa-demo.zip", "keep.txt"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exportPack refuses an output path that is a file", async () => {
  const root = await fixtureRepository();
  try {
    const outputDir = join(root, "out");
    await writeFile(outputDir, "not a folder");
    await assert.rejects(exportPack({ repositoryRoot: root, outputDir }), /directory/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the export CLI rejects unknown arguments and prints help", async () => {
  const output = { text: "", write(value) { this.text += value; } };
  const errors = { text: "", write(value) { this.text += value; } };
  assert.equal(await main(["--bad"], { stdout: output, stderr: errors }), 2);
  assert.match(errors.text, /Usage/u);
  assert.equal(await main(["--help"], { stdout: output, stderr: errors }), 0);
  assert.match(output.text, /Usage/u);
});

test("the export CLI reports a missing pack in one line", async () => {
  const root = await mkdtemp(join(tmpdir(), "aaa-empty-"));
  try {
    const output = { text: "", write(value) { this.text += value; } };
    const errors = { text: "", write(value) { this.text += value; } };
    assert.equal(await main([], { stdout: output, stderr: errors }, { repositoryRoot: root }), 1);
    assert.match(errors.text, /^export failed: .*conventions\.md\n$/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
