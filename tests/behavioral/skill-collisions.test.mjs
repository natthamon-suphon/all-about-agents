import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const collisionSets = [
  { id: "brainstorm-interview-loop", samples: 5, candidates: ["brainstorming", "interviewing", "loop-me"], boundary: "design, wrapper-owned decisions, or workflow specification" },
  { id: "research-investigation", samples: 5, candidates: ["research", "systematic-debugging"], boundary: "external fact or local failure cause" },
  { id: "verification-review", samples: 5, candidates: ["verification-before-completion", "requesting-code-review"], boundary: "fresh execution evidence or independent critique" },
  { id: "planning-execution", samples: 5, candidates: ["writing-plans", "executing-plans"], boundary: "write an approved plan or execute one" },
  { id: "debugging-tdd", samples: 5, candidates: ["systematic-debugging", "test-driven-development"], boundary: "diagnose existing failure or implement new behavior" },
  { id: "architecture-survey-design", samples: 5, candidates: ["improve-codebase-architecture", "codebase-design"], boundary: "portfolio survey or one module boundary" },
  { id: "image-alternatives", samples: 5, candidates: ["nano-image-generator"], nonSkillAlternative: "code-native SVG, HTML, CSS, canvas, or an existing vector system", boundary: "raster generation or code-native visual" }
];

test("critical collision matrix defines seven bounded sets and five fresh samples", () => {
  assert.equal(collisionSets.length, 7);
  for (const collision of collisionSets) {
    assert.ok(collision.candidates.length > 0);
    assert.ok(collision.boundary.length > 10);
    assert.equal(collision.samples, 5, `${collision.id} release sample count`);
  }
});

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

test("image generation collision keeps code-native visuals outside the raster skill", async () => {
  const evaluation = JSON.parse(await readFile(resolve(process.cwd(), "core/evals/skill-routing/nano-image-generator.json"), "utf8"));
  const nontrigger = evaluation.cases.find((entry) => entry.id === "NI-NONTRIGGER-code-native-SVG");
  assert.ok(nontrigger);
  assert.match(JSON.stringify(nontrigger), /SVG|code-native/iu);
  assert.match(collisionSets.at(-1).nonSkillAlternative, /SVG|HTML|CSS|canvas|vector/iu);
});
