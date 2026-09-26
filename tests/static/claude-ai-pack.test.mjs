import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { loadPack, validateSkill } from "../../scripts/lib/claude-ai-pack.mjs";

const root = process.cwd();
const packRoot = resolve(root, "claude-ai");
const EXPECTED_SKILLS = ["aaa-interview", "aaa-brief", "aaa-tasks", "aaa-run", "aaa-review", "aaa-research"];
const REQUIRED_PHRASES = {
  "aaa-interview": ["one question", "01-interview-record.md", "stop rule", "R#", "anything else"],
  "aaa-brief": ["02-brief.md", "Not discussed", "source trace", "inferred", "v2"],
  "aaa-tasks": ["03-tasks.md", "done check", "needs approval", "parallel-safe", "Not yet specified"],
  "aaa-run": ["done check", "three times", "needs approval", "check not run", "irreversible"],
  "aaa-review": ["04-review.md", "self-review", "needs your decision", "not checked", "Attempted"],
  "aaa-research": ["primary", "secondary", "never cite a search snippet", "unknown", "research-"]
};
const CONVENTION_HEADINGS = [
  "Language",
  "Evidence labels",
  "No invention",
  "Untrusted content",
  "Irreversible steps",
  "Secrets",
  "Where documents go",
  "Document header"
];
const CASE_KINDS = ["TRIGGER", "NONTRIGGER", "PRESSURE"];
const MIN_CASES_PER_KIND = 2;

async function text(relativePath) {
  return await readFile(resolve(root, relativePath), "utf8");
}

async function packSkills() {
  try {
    return (await loadPack(packRoot)).skills;
  } catch (error) {
    if (/missing a required path: .*skills$/u.test(error.message)) return [];
    throw error;
  }
}

test("shared conventions keep every required section in order", async () => {
  const headings = (await text("claude-ai/shared/conventions.md")).match(/^## .+$/gmu)?.map((line) => line.slice(3)) ?? [];
  assert.deepEqual(headings, CONVENTION_HEADINGS);
});

test("exported archives stay out of Git", async () => {
  assert.match(await text(".gitignore"), /^\.aaa\/claude-ai\/$/mu);
});

test("the eval results log has its fixed columns", async () => {
  assert.match(await text("claude-ai/evals/results.md"), /^\| Date \| Skill \| Case \| Runner \| Result \| Notes \|$/mu);
});

test("the pack holds exactly the expected skills", async () => {
  assert.deepEqual((await packSkills()).map((skill) => skill.name), [...EXPECTED_SKILLS].sort());
});

for (const name of EXPECTED_SKILLS) {
  test(`${name} passes the claude.ai limits and links the shared conventions`, async () => {
    const skill = (await packSkills()).find((entry) => entry.name === name);
    assert.ok(skill, `claude-ai/skills/${name}/SKILL.md is missing`);
    assert.deepEqual(validateSkill(skill), []);
    const body = await text(`claude-ai/skills/${name}/SKILL.md`);
    assert.ok(body.includes("](references/conventions.md)"), `${name} must link references/conventions.md`);
    for (const phrase of REQUIRED_PHRASES[name] ?? []) {
      assert.ok(body.toLowerCase().includes(phrase.toLowerCase()), `${name} SKILL.md must contain: ${phrase}`);
    }
  });

  test(`${name} has trigger, non-trigger, and pressure eval cases`, async () => {
    const evals = await text(`claude-ai/evals/${name}.md`);
    for (const kind of CASE_KINDS) {
      const count = evals.match(new RegExp(`^### ${name}-${kind}-\\d+$`, "gmu"))?.length ?? 0;
      assert.ok(count >= MIN_CASES_PER_KIND, `${name} needs at least ${MIN_CASES_PER_KIND} ${kind} cases, found ${count}`);
    }
  });
}
