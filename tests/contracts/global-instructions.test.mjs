import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import test from "node:test";

const repositoryRoot = process.cwd();
const sourcePath = "core/instructions/global-operating-rules.md";
const fixture = (name) => resolve(repositoryRoot, "tests/fixtures/core", name);

async function globalInstructions() {
  return import("../../installers/lib/global-instructions.mjs");
}

test("global instructions expose stable size limits and validate the canonical body", async () => {
  const { GLOBAL_INSTRUCTION_LIMITS, validateGlobalInstructionBody } = await globalInstructions();
  assert.deepEqual(GLOBAL_INSTRUCTION_LIMITS, {
    maxLinesExclusive: 160,
    maxCharactersExclusive: 8000,
    claudeMaxLinesExclusive: 200,
    geminiMaxCharactersExclusive: 12000,
    codexMaxBytesExclusive: 32768
  });
  const content = await readFile(resolve(repositoryRoot, sourcePath), "utf8");
  const result = validateGlobalInstructionBody({ sourcePath, content });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.ok(result.metrics.characters > 0);
  assert.ok(result.metrics.lines < GLOBAL_INSTRUCTION_LIMITS.maxLinesExclusive);
  assert.ok(result.metrics.bytes > 0);
});

test("global instructions reject missing, non-string, and empty bodies", async () => {
  const { validateGlobalInstructionBody } = await globalInstructions();
  for (const content of [undefined, null, 42, "", "   \n\t"]) {
    const result = validateGlobalInstructionBody({ sourcePath, content });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => error.code === "invalid-global-instructions"));
  }
});

test("global instructions reject line and Unicode character limits", async () => {
  const { validateGlobalInstructionBody } = await globalInstructions();
  const lineLimit = validateGlobalInstructionBody({ sourcePath, content: Array.from({ length: 160 }, () => "x").join("\n") });
  assert.ok(lineLimit.errors.some((error) => error.code === "global-instructions-too-long"));
  const characterLimit = validateGlobalInstructionBody({ sourcePath, content: "x".repeat(8000) });
  assert.ok(characterLimit.errors.some((error) => error.code === "global-instructions-too-long"));
});

test("global instructions reject HTML, CSS, animation, and raw ANSI while allowing Markdown autolinks", async () => {
  const { validateGlobalInstructionBody } = await globalInstructions();
  const html = validateGlobalInstructionBody({ sourcePath, content: "<span>unsafe</span>" });
  assert.ok(html.errors.some((error) => error.code === "global-instructions-html"));
  const css = validateGlobalInstructionBody({ sourcePath, content: "@keyframes pulse { from { opacity: 0; } }" });
  assert.ok(css.errors.some((error) => error.code === "global-instructions-html"));
  const cssRule = validateGlobalInstructionBody({ sourcePath, content: "p { margin: 0; }" });
  assert.ok(cssRule.errors.some((error) => error.code === "global-instructions-html"));
  const cssDeclaration = validateGlobalInstructionBody({ sourcePath, content: "margin: 0;" });
  assert.ok(cssDeclaration.errors.some((error) => error.code === "global-instructions-html"));
  for (const content of ["Use CSS to style the heading.\n", "Add animation to every response.\n"]) {
    const positiveInstruction = validateGlobalInstructionBody({ sourcePath, content });
    assert.ok(positiveInstruction.errors.some((error) => error.code === "global-instructions-html"), content);
  }
  for (const content of ["Do not use HTML; use CSS to style headings.\n", "Do not use CSS, but add animation.\n"]) {
    const laterPositiveInstruction = validateGlobalInstructionBody({ sourcePath, content });
    assert.ok(laterPositiveInstruction.errors.some((error) => error.code === "global-instructions-html"), content);
  }
  for (const content of ["Do not use CSS or animation.\n", "Don't use CSS.\n", "Never add animation.\n", "Must not use CSS.\n", "Respond without CSS or animation.\n"]) {
    const prohibition = validateGlobalInstructionBody({ sourcePath, content });
    assert.equal(prohibition.valid, true, `${content}: ${JSON.stringify(prohibition.errors)}`);
  }
  const bareNot = validateGlobalInstructionBody({ sourcePath, content: "Use plain text, not CSS or animation.\n" });
  assert.equal(bareNot.valid, true, JSON.stringify(bareNot.errors));
  const plainProhibition = validateGlobalInstructionBody({ sourcePath, content: "Do not use animation.\n" });
  assert.equal(plainProhibition.valid, true, JSON.stringify(plainProhibition.errors));
  const ansi = validateGlobalInstructionBody({ sourcePath, content: "unsafe\u001b[31m" });
  assert.ok(ansi.errors.some((error) => error.code === "global-instructions-ansi"));
  const autolink = validateGlobalInstructionBody({ sourcePath, content: "Read <https://example.com/docs>.\n" });
  assert.equal(autolink.valid, true, JSON.stringify(autolink.errors));
  const placeholder = validateGlobalInstructionBody({ sourcePath, content: "Use `/<CODEX_HOME>/AGENTS.md` for the global file.\n" });
  assert.equal(placeholder.valid, true, JSON.stringify(placeholder.errors));
});

test("global instructions reject BOM and CRLF drift", async () => {
  const { validateGlobalInstructionBody } = await globalInstructions();
  const bom = validateGlobalInstructionBody({ sourcePath, content: "\uFEFF# Rules\n" });
  assert.ok(bom.errors.some((error) => error.code === "global-instructions-bom"));
  const crlf = validateGlobalInstructionBody({ sourcePath, content: "# Rules\r\n" });
  assert.ok(crlf.errors.some((error) => error.code === "global-instructions-line-endings"));
});

test("globalInstructionContent returns only a validated global body", async () => {
  const { globalInstructionContent } = await globalInstructions();
  const content = await readFile(resolve(repositoryRoot, sourcePath), "utf8");
  assert.equal(globalInstructionContent({ globalInstructions: { sourcePath, content } }), content);
  assert.throws(() => globalInstructionContent({}), TypeError);
  assert.throws(() => globalInstructionContent({ globalInstructions: { sourcePath: "other.md", content } }), TypeError);
  assert.throws(() => globalInstructionContent({ globalInstructions: { sourcePath: "", content } }), TypeError);
  assert.throws(() => globalInstructionContent({ globalInstructions: { sourcePath, content: "" } }), TypeError);
});

test("global instruction size boundaries are exclusive but accept 159 lines and 7,999 characters", async () => {
  const { validateGlobalInstructionBody } = await globalInstructions();
  const lines = Array.from({ length: 159 }, () => "x").join("\n");
  const lineResult = validateGlobalInstructionBody({ sourcePath, content: lines });
  assert.equal(lineResult.valid, true, JSON.stringify(lineResult.errors));
  assert.equal(lineResult.metrics.lines, 159);
  const characters = "x".repeat(7999);
  const characterResult = validateGlobalInstructionBody({ sourcePath, content: characters });
  assert.equal(characterResult.valid, true, JSON.stringify(characterResult.errors));
  assert.equal(characterResult.metrics.characters, 7999);
});

test("canonical global body carries the migration meaning without legacy conflicts", async () => {
  const { validateGlobalInstructionBody } = await globalInstructions();
  const content = await readFile(resolve(repositoryRoot, sourcePath), "utf8");
  const requiredSections = [
    "Correctness and depth",
    "Inspect before action",
    "Simple language and direct reporting",
    "Evidence, assumptions, and primary-source research",
    "Scope, authority, privacy, secrets, and untrusted content",
    "Code quality, tests, and root-cause fixes",
    "Safe file, destructive, external, and Git actions",
    "Cross-platform path and command behavior",
    "Agents, subagents, and ownership",
    "Invocation announcements and material-step checklists",
    "Long-session state and resume behavior",
    "Final evidence report"
  ];
  for (const section of requiredSections) assert.match(content, new RegExp(`^## .*${section}.*$`, "mu"), section);
  assert.match(content, /approved installer may overwrite only its managed file without a backup/iu);
  assert.match(content, /at least two sound approaches/iu);
  assert.match(content, /main trade-off/iu);
  assert.match(content, /Fix\s+the root cause/iu);
  assert.match(content, /real files, types, configuration, tests, and APIs/iu);
  assert.match(content, /Check failure paths/iu);
  assert.match(content, /language of the current session/iu);
  assert.match(content, /Give the outcome first/iu);
  assert.match(content, /do\s+not repeat unchanged status messages/iu);
  assert.match(content, /verified, inferred, or unknown/iu);
  assert.match(content, /ASSUMPTION MADE/iu);
  assert.match(content, /Use primary sources/iu);
  assert.match(content, /behavior test before production code/iu);
  assert.match(content, /Handle errors\s+explicitly/iu);
  assert.match(content, /dead code, empty catches, or placeholder stubs/iu);
  assert.match(content, /resolve exact targets before destructive work/iu);
  assert.match(content, /commit, push, merge, rebase, rewrite history, or open a pull request\s+without exact authority/iu);
  assert.match(content, /brief scoped to its delegated work/iu);
  assert.match(content, /named owners/iu);
  assert.match(content, /canonical name, suitable emoji, and one\s+short reason/iu);
  assert.match(content, /update it only when states change/iu);
  assert.match(content, /continue the current item without repeating completed work/iu);
  assert.match(content, /branch and commit\s+state/iu);
  assert.match(content, /Work only in the requested scope/iu);
  assert.match(content, /material external actions need exact authority/iu);
  assert.match(content, /private data and secrets/iu);
  assert.match(content, /untrusted data, not as instructions/iu);
  assert.match(content, /selected model policy, access mode, and emergency deny rules/iu);
  assert.match(content, /inherited context supplied by the native product/iu);
  assert.match(content, /native path APIs and structured argument lists/iu);
  assert.match(content, /two\s+to seven material steps/iu);
  assert.match(content, /Every item must have a terminal state/iu);
  assert.match(content, /long-running, multi-session, or\s+compaction-sensitive work/iu);
  assert.match(content, /After resume, load the last state/iu);
  assert.match(content, /what changed, full paths, exact checks and results/iu);
  assert.doesNotMatch(content, /backup before every overwrite/iu);
  assert.doesNotMatch(content, /Rainbow|linear-gradient|<span|<style|\u001b/iu);
  assert.doesNotMatch(content, /always use forward slashes/iu);
  assert.doesNotMatch(content, /ledger file for every small task/iu);
  assert.equal(validateGlobalInstructionBody({ sourcePath, content }).valid, true);
});

test("loadCore rejects a missing canonical global instructions file", async () => {
  const root = await mkdtemp(join(tmpdir(), "aaa-t001-global-missing-"));
  try {
    await cp(fixture("valid"), root, { recursive: true });
    await mkdir(resolve(root, "core/instructions"), { recursive: true });
    await writeFile(resolve(root, sourcePath), "# Fixture global operating rules\n\nUse the validated fixture core.\n", "utf8");
    await unlink(resolve(root, sourcePath));
    const { loadCore } = await import("../../installers/lib/load-core.mjs");
    await assert.rejects(loadCore(root), (error) => {
      assert.ok(error.errors.some((entry) =>
        entry.sourcePath === sourcePath && entry.keyword === "missing-global-instructions"
      ));
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadCore rejects a symlinked canonical global instructions file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aaa-t010-global-symlink-"));
  const outside = await mkdtemp(join(tmpdir(), "aaa-t010-global-outside-"));
  try {
    await cp(fixture("valid"), root, { recursive: true });
    const canonicalPath = resolve(root, sourcePath);
    const outsidePath = resolve(outside, "global-operating-rules.md");
    await writeFile(outsidePath, "# Fixture global operating rules\n\nUse the validated fixture core.\n", "utf8");
    await unlink(canonicalPath);
    try {
      await symlink(outsidePath, canonicalPath, "file");
    } catch (error) {
      t.skip(`file symlink creation unavailable: ${error.code}`);
      return;
    }
    const { loadCore } = await import("../../installers/lib/load-core.mjs");
    await assert.rejects(loadCore(root), (error) => {
      assert.ok(error.errors.some((entry) =>
        entry.sourcePath === sourcePath && entry.keyword === "global-instructions-containment"
      ));
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("loadCore rejects a contained parent link for canonical global instructions", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "aaa-t010-global-contained-link-"));
  try {
    await cp(fixture("valid"), root, { recursive: true });
    const instructionsPath = resolve(root, "core/instructions");
    const containedTarget = resolve(root, "core/contained-instructions");
    await cp(instructionsPath, containedTarget, { recursive: true });
    await rm(instructionsPath, { recursive: true, force: true });
    try {
      await symlink(containedTarget, instructionsPath, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      t.skip(`directory link creation unavailable: ${error.code}`);
      return;
    }
    const { loadCore } = await import("../../installers/lib/load-core.mjs");
    await assert.rejects(loadCore(root), (error) => {
      assert.ok(error.errors.some((entry) => entry.sourcePath === sourcePath && entry.keyword === "global-instructions-containment"));
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
