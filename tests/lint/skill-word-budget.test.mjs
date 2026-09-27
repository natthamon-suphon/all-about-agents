import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

const skillsRoot = resolve(process.cwd(), "core/skills");
const SKILL_LIMIT = 1500;
const ROUTER_LIMIT = 500;
const ROUTER = "using-all-about-agents";

function bodyWords(content) {
  const closing = content.indexOf("\n---\n", 4);
  assert.ok(content.startsWith("---\n") && closing > 0, "frontmatter must open and close");
  return content.slice(closing + "\n---\n".length).trim().split(/\s+/u).length;
}

test("every SKILL.md body stays under the word budget from writing-skills", async () => {
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const skills = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  assert.ok(skills.length > 0);
  for (const skill of skills) {
    const words = bodyWords(await readFile(join(skillsRoot, skill, "SKILL.md"), "utf8"));
    const limit = skill === ROUTER ? ROUTER_LIMIT : SKILL_LIMIT;
    assert.ok(words < limit, `${skill} body has ${words} words; the limit is under ${limit}`);
  }
});
