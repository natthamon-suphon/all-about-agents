import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const collisionSets = [
  { id: "brainstorm-interview-loop", candidates: ["brainstorming", "interviewing", "loop-me"] },
  { id: "research-investigation", candidates: ["research", "systematic-debugging"] },
  { id: "verification-review", candidates: ["verification-before-completion", "requesting-code-review"] },
  { id: "planning-execution", candidates: ["writing-plans", "executing-plans"] },
  { id: "debugging-tdd", candidates: ["systematic-debugging", "test-driven-development"] },
  { id: "architecture-survey-design", candidates: ["improve-codebase-architecture", "codebase-design"] }
];

test("each collision candidate has trigger and nontrigger evidence with distinct descriptions", async () => {
  const ids = [...new Set(collisionSets.flatMap((entry) => entry.candidates))];
  const descriptions = new Map();
  for (const id of ids) {
    const skill = await readFile(resolve(process.cwd(), `core/skills/${id}/SKILL.md`), "utf8");
    const evaluation = JSON.parse(await readFile(resolve(process.cwd(), `core/evals/skill-routing/${id}.json`), "utf8"));
    const description = /^description:\s*(.+)$/mu.exec(skill)?.[1]?.trim();
    assert.ok(description, id);
    descriptions.set(id, description);
    assert.ok(evaluation.cases.some((entry) => /TRIGGER/u.test(entry.id) && !/NONTRIGGER/u.test(entry.id)), `${id}: trigger`);
    assert.ok(evaluation.cases.some((entry) => /NONTRIGGER/u.test(entry.id)), `${id}: nontrigger`);
  }
  for (const collision of collisionSets) {
    const values = collision.candidates.map((id) => descriptions.get(id));
    assert.equal(new Set(values).size, values.length, `${collision.id}: descriptions must differ`);
  }
});
