import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, link, mkdir, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { skipIfLinkUnavailable } from "../../helpers/symlink.mjs";
import { withTempRoot } from "../../helpers/temp-root.mjs";

const id = "writing-skills";
const cases = ["WS-TRIGGER-create-or-edit-skill", "WS-NONTRIGGER-use-existing-skill", "WS-PRESSURE-prose-only-confidence"];
const assets = ["graphviz-conventions.dot", "persuasion-principles.md", "testing-skills-with-subagents.md"];
const scripts = ["render-graphs.mjs"];
const companions = [...assets, ...scripts];
const read = (name = "SKILL.md") => readFile(new URL(`../../../core/skills/${id}/${name}`, import.meta.url), "utf8");

test("skill authoring enforces behavioral RED GREEN REFACTOR and progressive disclosure", async () => {
  const skill = await read();
  for (const term of ["Skill Gate Protocol", "RED", "GREEN", "REFACTOR", "behavior", "routing", "pressure", "progressive disclosure", "not run"]) assert.match(skill, new RegExp(term, "iu"));
  assert.match(skill, /prose.{0,80}(not|isn't|is not).{0,50}(evidence|proof)|confidence.{0,80}behavior/isu);
  for (const companion of companions) assert.match(skill, new RegExp(companion.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
});

test("all inventory companions are concise, routed, and cross-platform", async () => {
  for (const companion of companions) assert.ok((await read(companion)).trim().length > 80, companion);
  const renderer = await read("render-graphs.mjs");
  assert.match(renderer, /spawnSync|execFileSync/u);
  assert.match(renderer, /process\.platform|GRAPHVIZ_DOT|ENOENT/u);
  assert.doesNotMatch(renderer, /\bwhich\b|\bwhere(?:\.exe)?\b|shell\s*:\s*true|execSync\s*\(/iu);
  assert.match(renderer, /--check|--output-dir|--overwrite/u);
  const testing = await read("testing-skills-with-subagents.md");
  assert.match(testing, /## Worked example/u);
  for (const kind of ["Trigger", "Nontrigger", "Pressure"]) assert.match(testing, new RegExp(`### ${kind}\\n\\nPrompt:`, "u"));
  const persuasion = await read("persuasion-principles.md");
  assert.match(persuasion, /transparent|user autonomy|non-manipulative/iu);
});

test("writing-skills routing distinguishes authoring from ordinary use and prose pressure", async () => {
  const evaluation = JSON.parse(await readFile(new URL(`../../../core/evals/skill-routing/${id}.json`, import.meta.url), "utf8"));
  assert.deepEqual(evaluation.cases.map((entry) => entry.id), cases);
  for (const entry of evaluation.cases) assert.equal(entry.critical, true);
  assert.equal(evaluation.cases[0].expected.skillCheck, "required");
  assert.equal(evaluation.cases[0].expected.behavioralRedGreenRefactor, true);
  assert.equal(evaluation.cases[1].expected.skillCheck, "not-required");
  assert.equal(evaluation.cases[1].expected.existingSkillUseOnly, true);
  assert.equal(evaluation.cases[2].expected.rejectProseOnlyConfidence, true);
  assert.equal(evaluation.cases[2].expected.requireObservedBehavior, true);
});

test("core loader exposes all writing-skill metadata and companions", async () => {
  const { loadCore } = await import("../../../installers/lib/load-core.mjs");
  const core = await loadCore(process.cwd());
  assert.deepEqual(core.skills.find((entry) => entry.id === id)?.evaluationCases, cases);
  const source = core.inventory.skillSources.find((entry) => entry.name === id);
  assert.deepEqual(source?.assets, assets.map((name) => `skills/writing-skills/${name}`));
  assert.deepEqual(source?.scripts, scripts.map((name) => `skills/writing-skills/${name}`));
});

test("writing-skills states its budgets, renderer usage, and authority-aware evidence", async () => {
  const skill = await read();
  assert.match(skill, /under 1,500 words/u);
  assert.match(skill, /\(the router\)[^.]{0,20}under 500/u);
  assert.match(skill, /commit IDs when commits were authorized/u);
  assert.match(skill, /node render-graphs\.mjs --output-dir <dir> <file\.dot>/u);
  assert.match(skill, /node render-graphs\.mjs --check/u);
  assert.match(skill, /Node(?:\.js)?\s+22\.12/u);
  assert.match(skill, /time-sensitive[\s\S]{0,200}(?:adapter|source)[\s\S]{0,120}fail closed/iu);
  assert.doesNotMatch(skill, /anthropic-best-practices|CLAUDE_MD_TESTING/u);
  assert.doesNotMatch(skill, /[A-Za-z][-/]\n/u);
});

const renderer = fileURLToPath(new URL(`../../../core/skills/${id}/render-graphs.mjs`, import.meta.url));
const render = (cwd, args, dot = join(cwd, "no-such-dot")) => spawnSync(process.execPath, [renderer, ...args], {
  cwd,
  encoding: "utf8",
  shell: false,
  env: { ...process.env, GRAPHVIZ_DOT: dot }
});

test("render-graphs rejects a flag given as the --output-dir value", async () => {
  await withTempRoot(async (root) => {
    const result = render(root, ["--output-dir", "--overwrite", "graph.dot"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--output-dir needs a directory value/u);
    assert.equal(existsSync(join(root, "--overwrite")), false);
  });
});

test("render-graphs reports a missing input before it looks for Graphviz", async () => {
  await withTempRoot(async (root) => {
    const output = join(root, "out");
    const result = render(root, ["--output-dir", output, "missing.dot"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^Error: input not found: missing\.dot\n$/u);
    assert.equal(existsSync(output), false);
  });
});

test("render-graphs refuses two inputs that would write the same SVG before it renders", async () => {
  await withTempRoot(async (root) => {
    for (const directory of ["a", "b"]) await mkdir(join(root, directory));
    for (const name of ["a/graph.dot", "b/graph.dot", "a/Other.dot", "b/other.dot"]) await writeFile(join(root, name), "digraph { a -> b }\n", "utf8");
    const output = join(root, "out");
    for (const inputs of [["a/graph.dot", "b/graph.dot"], ["a/graph.dot", "a/graph.dot"], ["a/Other.dot", "b/other.dot"]]) {
      const result = render(root, ["--output-dir", output, ...inputs]);
      assert.equal(result.status, 1, inputs.join(" "));
      assert.match(result.stderr, /^Error: two inputs would write the same output (?:graph|other)\.svg: /u, inputs.join(" "));
      assert.equal(existsSync(output), false);
    }
  });
});

test("render-graphs reports Graphviz output over the size limit as a size error", async (t) => {
  if (process.platform === "win32") {
    t.skip("win32: the fake dot is a POSIX shell script");
    return;
  }
  await withTempRoot(async (root) => {
    const dot = join(root, "fake-dot");
    await writeFile(dot, "#!/bin/sh\n[ \"$1\" = -V ] && exit 0\ncat >/dev/null\nexec head -c 11000000 /dev/zero\n", "utf8");
    await chmod(dot, 0o755);
    await writeFile(join(root, "graph.dot"), "digraph { a -> b }\n", "utf8");
    const output = join(root, "out");
    const result = render(root, ["--output-dir", output, "graph.dot"], dot);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /^Error: Graphviz output is empty or exceeds the safe size limit\n$/u);
    assert.equal(existsSync(output), false);
  });
});

test("render-graphs --overwrite replaces a regular file and never writes through a link", async (t) => {
  if (process.platform === "win32") {
    t.skip("win32: the fake dot is a POSIX shell script");
    return;
  }
  await withTempRoot(async (root) => {
    const dot = join(root, "fake-dot");
    await writeFile(dot, "#!/bin/sh\n[ \"$1\" = -V ] && exit 0\ncat >/dev/null\nprintf '<svg/>'\n", "utf8");
    await chmod(dot, 0o755);
    await writeFile(join(root, "graph.dot"), "digraph { a -> b }\n", "utf8");
    const output = join(root, "out");
    await mkdir(output);
    const outside = join(root, "outside.txt");
    await writeFile(outside, "keep\n", "utf8");
    const target = join(output, "graph.svg");
    const overwrite = () => render(root, ["--overwrite", "--output-dir", output, "graph.dot"], dot);
    try {
      await symlink(outside, target);
    } catch (error) {
      skipIfLinkUnavailable(t, error);
      return;
    }
    for (const kind of ["symlink", "hard link"]) {
      const result = overwrite();
      assert.equal(result.status, 1, `${kind}: ${result.stderr}`);
      assert.match(result.stderr, /^Error: refusing .*graph\.svg: not a regular file with one link\n$/u, kind);
      assert.equal(await readFile(outside, "utf8"), "keep\n", kind);
      await unlink(target);
      if (kind === "symlink") await link(outside, target);
    }
    await writeFile(target, "old\n", "utf8");
    const replaced = overwrite();
    assert.equal(replaced.status, 0, replaced.stderr);
    assert.equal(await readFile(target, "utf8"), "<svg/>");
  });
});
