import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

import { validateSchema } from "../../installers/lib/validate-schema.mjs";
import { makeTempRoot } from "../helpers/temp-root.mjs";

let reportModule;
let reportSchema;
try {
  reportModule = await import("../../scripts/lib/quality-report.mjs");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}
try {
  reportSchema = (await import("../../installers/schemas/quality-report.schema.json", {
    with: { type: "json" }
  })).default;
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

const baseInput = () => ({
  mode: "quick",
  skill: null,
  repository: { branch: "main", commit: "a".repeat(40) },
  runtime: { platform: "win32", nodeVersion: "v22.12.0" },
  startedAt: "2026-08-31T06:00:00.000Z",
  finishedAt: "2026-08-31T06:00:01.000Z",
  checks: [
    {
      id: "z-last",
      status: "NOT_RUN_UNAVAILABLE",
      required: false,
      command: ["codex", "--version"],
      evidence: "codex is not installed",
      durationMs: 0
    },
    {
      id: "a-first",
      status: "PASS",
      required: true,
      command: ["node", "--test"],
      evidence: "TOKEN=abc123 Bearer very-secret https://user:pass@example.test/path",
      durationMs: 15
    }
  ]
});

test("quality report exposes its public interface and JSON schema", () => {
  assert.equal(typeof reportModule?.createQualityReport, "function");
  assert.equal(typeof reportModule?.formatQualityReport, "function");
  assert.equal(typeof reportModule?.writeQualityReport, "function");
  assert.equal(typeof reportSchema, "object");
});

test("quality report is schema-valid, ordered, and redacted", () => {
  const report = reportModule.createQualityReport(baseInput());

  assert.deepEqual(report.checks.map((check) => check.id), ["a-first", "z-last"]);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.timestamp, "2026-08-31T06:00:01.000Z");
  assert.equal(report.status, "PASS");
  assert.match(report.nextAction, /next approved step/iu);
  assert.doesNotMatch(JSON.stringify(report), /abc123|very-secret|user:pass/iu);
  assert.match(JSON.stringify(report), /\[REDACTED\]/u);

  const validation = validateSchema({
    schema: reportSchema,
    value: report,
    sourcePath: "quality-report.json"
  });
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.valid, true);
});

test("quality evidence redacts common credential headers, JSON fields, cookies, and cloud keys", () => {
  const hostile = [
    "Authorization: Basic dXNlcjpwYXNz",
    "AWS_ACCESS_KEY_ID: AKIAEXAMPLEVALUE",
    "AWS_SECRET_ACCESS_KEY: private-cloud-secret",
    "Set-Cookie: session=private-cookie; HttpOnly",
    '{"password":"private-value","session":"private-session"}'
  ].join("\n");
  const redacted = reportModule.redactQualityText(hostile);
  for (const secret of ["dXNlcjpwYXNz", "AKIAEXAMPLEVALUE", "private-cloud-secret", "private-cookie", "private-value", "private-session"]) {
    assert.equal(redacted.includes(secret), false);
  }
  assert.match(redacted, /\[REDACTED\]/u);
});

test("quality evidence redacts common opaque tokens and private home paths", () => {
  const hostile = [
    "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890",
    "eyJhbGciOiJIUzI1NiJ9.cHJpdmF0ZS1wYXlsb2Fk.cHJpdmF0ZS1zaWduYXR1cmU",
    `${homedir()}${process.platform === "win32" ? "\\" : "/"}private-file.txt`,
    "C:/Users/private.person/project/error.log",
    "/home/private.person/project/error.log"
  ].join("\n");
  const redacted = reportModule.redactQualityText(hostile);
  for (const secret of ["ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890", "cHJpdmF0ZS1wYXlsb2Fk", "private.person", homedir()]) {
    assert.equal(redacted.includes(secret), false);
  }
  assert.match(redacted, /\[REDACTED/iu);
});

test("required non-pass status fails the report while optional unavailable does not", () => {
  const optionalUnavailable = reportModule.createQualityReport(baseInput());
  assert.equal(optionalUnavailable.status, "PASS");

  const input = baseInput();
  input.checks[1].status = "NOT_RUN";
  const requiredNotRun = reportModule.createQualityReport(input);
  assert.equal(requiredNotRun.status, "FAIL");
  assert.match(requiredNotRun.nextAction, /fix|run/iu);
});

test("quality report formats deterministic text and JSON", () => {
  const report = reportModule.createQualityReport(baseInput());
  const json = reportModule.formatQualityReport(report, { format: "json" });
  const text = reportModule.formatQualityReport(report, { format: "text" });

  assert.deepEqual(JSON.parse(json), report);
  assert.equal(json.endsWith("\n"), true);
  assert.match(text, /Quality: PASS/u);
  assert.match(text, /a-first.*PASS/u);
  assert.match(text, /z-last.*NOT_RUN_UNAVAILABLE/u);
  assert.equal(reportModule.formatQualityReport(report, { format: "json" }), json);
  assert.throws(() => reportModule.formatQualityReport(report, { format: "yaml" }), /format/iu);
});

test("quality report validates malformed input and duplicate checks", () => {
  assert.throws(() => reportModule.createQualityReport({ ...baseInput(), mode: "other" }), /mode/iu);
  assert.throws(() => reportModule.createQualityReport({ ...baseInput(), checks: [] }), /checks/iu);
  const duplicate = baseInput();
  duplicate.checks[1].id = duplicate.checks[0].id;
  assert.throws(() => reportModule.createQualityReport(duplicate), /duplicate/iu);
});

test("quality report writes only to an explicit contained destination", async (t) => {
  const root = await makeTempRoot("aaa-quality-report-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = reportModule.createQualityReport(baseInput());

  await assert.rejects(
    () => reportModule.writeQualityReport(report, { repositoryRoot: root }),
    /outputPath/iu
  );
  await assert.rejects(
    () => reportModule.writeQualityReport(report, {
      repositoryRoot: root,
      outputPath: resolve(root, "..", "outside-quality-report.json")
    }),
    /contained|outside/iu
  );

  const result = await reportModule.writeQualityReport(report, {
    repositoryRoot: root,
    outputPath: "reports/quality.json"
  });
  const expectedPath = join(root, "reports", "quality.json");
  assert.equal(result.path, expectedPath);
  assert.equal(result.bytes > 0, true);
  assert.deepEqual(JSON.parse(await readFile(expectedPath, "utf8")), report);
});

test("quality report rejects an existing symlink destination before write", async () => {
  const report = reportModule.createQualityReport(baseInput());
  const root = resolve(tmpdir(), "aaa-quality-symlink-fixture");
  const outputPath = join(root, "quality.json");
  const fileSystem = {
    async lstat(candidate) {
      if (candidate === outputPath) return { isSymbolicLink: () => true };
      const error = new Error("missing");
      error.code = "ENOENT";
      throw error;
    },
    async mkdir() {
      assert.fail("mkdir must not run for a symlink destination");
    }
  };

  await assert.rejects(
    () => reportModule.writeQualityReport(report, { repositoryRoot: root, outputPath, fileSystem }),
    /symlink|reparse/iu
  );
  assert.equal(dirname(outputPath), root);
});
