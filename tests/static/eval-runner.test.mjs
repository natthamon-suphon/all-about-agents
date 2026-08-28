import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { readContainedUtf8Jsonl, runEvaluationBatch, validateResultEnvelope } from "../../core/evals/runner.mjs";
import { withTempRoot } from "../helpers/temp-root.mjs";
import { main as cliMain } from "../../scripts/aaa.mjs";

const envelope = (sampleId, variant = "candidate") => ({
  schemaVersion: 1,
  sampleId,
  caseId: "baseline-case",
  variant,
  output: `redacted output ${sampleId}`,
  scores: { correctness: 1, clarity: 0.8 },
  metadata: { session: "[REDACTED]", source: "fixture" }
});

async function captureCli(args) {
  let stdout = "";
  let stderr = "";
  const output = { write(value) { stdout += value; } };
  const errorOutput = { write(value) { stderr += value; } };
  const code = await cliMain(args, output, errorOutput);
  return { code, stdout, stderr };
}

test("evaluation batch executes the exact requested sample count in stable input order", async () => {
  await withTempRoot(async (root) => {
    const outputDir = resolve(root, ".aaa", "eval-runs", "ordered");
    const cases = [envelope("sample-02"), envelope("sample-01")];
    const seen = [];
    const batch = await runEvaluationBatch({
      cases,
      variant: "candidate",
      samples: 2,
      executeSample: async (caseRecord, sampleIndex) => {
        seen.push({ sampleId: caseRecord.sampleId, sampleIndex });
        return caseRecord;
      },
      outputDir
    });
    assert.equal(batch.requestedSamples, 2);
    assert.deepEqual(seen, [
      { sampleId: "sample-02", sampleIndex: 0 },
      { sampleId: "sample-01", sampleIndex: 1 }
    ]);
    assert.deepEqual(batch.results.map((result) => result.sampleId), ["sample-02", "sample-01"]);
    const written = JSON.parse(await readFile(resolve(outputDir, "result.json"), "utf8"));
    assert.deepEqual(written.results.map((result) => result.sampleId), ["sample-02", "sample-01"]);
  });
});

test("result envelopes remain anonymized and reject secret-bearing values", () => {
  assert.equal(validateResultEnvelope(envelope("sample-01")).valid, true);
  const secret = envelope("sample-01");
  secret.output = "Authorization: Bearer super-secret-token-value";
  const result = validateResultEnvelope(secret);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.keyword === "redaction"));
});

test("result envelopes reject sensitive metadata keys unless their values are redacted", () => {
  for (const key of ["password", "pass_word", "token", "apiKey", "api-key", "secret", "authorization", "AUTH_TOKEN"]) {
    const sensitive = envelope("sample-sensitive");
    sensitive.metadata[key] = "present-but-not-redacted";
    const rejected = validateResultEnvelope(sensitive);
    assert.equal(rejected.valid, false, `sensitive metadata key accepted: ${key}`);
    assert.ok(rejected.errors.some((error) => error.keyword === "redaction"), `missing redaction error: ${key}`);

    const redacted = envelope("sample-redacted");
    redacted.metadata[key] = "[REDACTED]";
    assert.equal(validateResultEnvelope(redacted).valid, true, `redacted metadata key rejected: ${key}`);
  }
});

test("evaluation batch rejects a malformed result envelope", async () => {
  await withTempRoot(async (root) => {
    await assert.rejects(
      runEvaluationBatch({
        cases: [envelope("sample-01")],
        variant: "candidate",
        samples: 1,
        executeSample: async () => ({ sampleId: "sample-01" }),
        outputDir: resolve(root, ".aaa", "eval-runs", "malformed")
      }),
      /invalid result envelope/
    );
  });
});

test("evaluation batch rejects output traversal", async () => {
  await withTempRoot(async (root) => {
    await assert.rejects(
      runEvaluationBatch({
        cases: [envelope("sample-01")],
        variant: "candidate",
        samples: 1,
        executeSample: async (caseRecord) => caseRecord,
        outputDir: resolve(root, ".aaa", "eval-runs", "..", "escape")
      }),
      /contained evaluation directory/
    );
  });
});

test("evaluation batch rejects an allowed root whose junction escapes the repository", async (t) => {
  const allowedParent = resolve(process.cwd(), ".aaa", "eval-runs");
  const disposableRoot = resolve(allowedParent, `.t002-junction-${process.pid}-${randomUUID()}`);
  const sentinel = resolve(allowedParent, `.t002-sentinel-${process.pid}-${randomUUID()}`);
  const outside = await mkdtemp(join(tmpdir(), "aaa-outside-"));
  let junctionCreated = false;
  let sentinelCreated = false;
  try {
    await mkdir(allowedParent, { recursive: true });
    await writeFile(sentinel, "preserve-existing-evaluation-data", "utf8");
    sentinelCreated = true;
    try {
      await symlink(outside, disposableRoot, "junction");
      junctionCreated = true;
    } catch (error) {
      if (error?.code === "EPERM" || error?.code === "EACCES") {
        t.skip(`junction creation unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    await assert.rejects(
      runEvaluationBatch({
        cases: [envelope("sample-junction")],
        variant: "candidate",
        samples: 1,
        executeSample: async (caseRecord) => caseRecord,
        outputDir: resolve(disposableRoot, "escaped")
      }),
      /contained evaluation directory/
    );
  } finally {
    if (junctionCreated) await rm(disposableRoot, { force: true, recursive: false });
    if (sentinelCreated) {
      assert.equal(await readFile(sentinel, "utf8"), "preserve-existing-evaluation-data");
      await rm(sentinel, { force: true });
    }
    await rm(outside, { force: true, recursive: true });
  }
});

test("evaluation batch rejects a dangling allowed-root junction before any external mkdir", async (t) => {
  const allowedParent = resolve(process.cwd(), ".aaa", "eval-runs");
  const danglingRoot = resolve(allowedParent, `.t002-dangling-${process.pid}-${randomUUID()}`);
  const outsideParent = await mkdtemp(join(tmpdir(), "aaa-dangling-outside-"));
  const outsideTarget = resolve(outsideParent, "dangling-target");
  let junctionCreated = false;
  try {
    await mkdir(allowedParent, { recursive: true });
    await mkdir(outsideTarget);
    try {
      await symlink(outsideTarget, danglingRoot, "junction");
      junctionCreated = true;
    } catch (error) {
      if (error?.code === "EPERM" || error?.code === "EACCES") {
        t.skip(`junction creation unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    await rm(outsideTarget, { force: true, recursive: true });
    await assert.rejects(
      runEvaluationBatch({
        cases: [envelope("sample-dangling-junction")],
        variant: "candidate",
        samples: 1,
        executeSample: async (caseRecord) => caseRecord,
        outputDir: resolve(danglingRoot, "escaped")
      }),
      /contained evaluation directory/
    );
    await assert.rejects(readFile(outsideTarget), /ENOENT|no such file/i);
  } finally {
    if (junctionCreated) await rm(danglingRoot, { force: true, recursive: false });
    await rm(outsideParent, { force: true, recursive: true });
  }
});

test("contained JSONL input rejects malformed UTF-8 before parsing", async () => {
  await withTempRoot(async (root) => {
    const input = resolve(root, "invalid-utf8.jsonl");
    await writeFile(input, Uint8Array.from([0x7b, 0xff, 0x0a]));
    await assert.rejects(readContainedUtf8Jsonl(input), /UTF-8/);
  });
});

test("CLI rejects missing input, malformed JSONL, duplicate IDs, wrong counts, traversal, and variant mismatch", async () => {
  assert.equal((await captureCli(["eval", "--skill", "brainstorming", "--variant", "control", "--samples", "5", "--output", ".aaa/eval-runs/test", "--format", "json"])).code, 2);
  await withTempRoot(async (root) => {
    const input = resolve(root, "input.jsonl");
    const output = resolve(root, ".aaa", "eval-runs", "cli");
    const five = Array.from({ length: 5 }, (_, index) => JSON.stringify(envelope(`sample-${index + 1}`, "control"))).join("\n") + "\n";
    await writeFile(input, five, "utf8");
    const malformed = resolve(root, "malformed.jsonl");
    await writeFile(malformed, "not-json\n", "utf8");
    const malformedResult = await captureCli(["eval", "--skill", "brainstorming", "--variant", "control", "--samples", "5", "--input-jsonl", malformed, "--output", output, "--format", "json"]);
    assert.equal(malformedResult.code, 1);
    const duplicate = resolve(root, "duplicate.jsonl");
    await writeFile(duplicate, Array.from({ length: 5 }, (_, index) => JSON.stringify(envelope(index === 4 ? "sample-1" : `sample-${index + 1}`, "control"))).join("\n") + "\n", "utf8");
    assert.equal((await captureCli(["eval", "--skill", "brainstorming", "--variant", "control", "--samples", "5", "--input-jsonl", duplicate, "--output", output, "--format", "json"])).code, 1);
    const four = resolve(root, "four.jsonl");
    await writeFile(four, Array.from({ length: 4 }, (_, index) => JSON.stringify(envelope(`sample-${index + 1}`, "control"))).join("\n") + "\n", "utf8");
    assert.equal((await captureCli(["eval", "--skill", "brainstorming", "--variant", "control", "--samples", "4", "--input-jsonl", four, "--output", output, "--format", "json"])).code, 1);
    const traversal = await captureCli(["eval", "--skill", "brainstorming", "--variant", "control", "--samples", "5", "--input-jsonl", input, "--output", resolve(root, ".aaa", "eval-runs", "..", "escape"), "--format", "json"]);
    assert.equal(traversal.code, 1);
    const mismatch = resolve(root, "mismatch.jsonl");
    await writeFile(mismatch, Array.from({ length: 5 }, (_, index) => JSON.stringify(envelope(`sample-${index + 1}`, "candidate"))).join("\n") + "\n", "utf8");
    assert.equal((await captureCli(["eval", "--skill", "brainstorming", "--variant", "control", "--samples", "5", "--input-jsonl", mismatch, "--output", output, "--format", "json"])).code, 1);
    const success = await captureCli(["eval", "--skill", "brainstorming", "--variant", "control", "--samples", "5", "--input-jsonl", input, "--output", output, "--format", "json"]);
    assert.equal(success.code, 0, success.stderr);
    assert.equal(JSON.parse(success.stdout).results.length, 5);
  });
});

test("CLI does not depend on a vendor model transport", async () => {
  const source = await readFile(resolve(process.cwd(), "core/evals/runner.mjs"), "utf8");
  assert.doesNotMatch(source, /fetch\(|axios|openai|anthropic|gemini|codex|claude/iu);
});
