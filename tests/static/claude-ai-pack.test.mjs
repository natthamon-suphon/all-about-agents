import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { loadPack, validateSkill } from "../../scripts/lib/claude-ai-pack.mjs";

const root = process.cwd();
const packRoot = resolve(root, "claude-ai");
const EXPECTED_SKILLS = ["aaa-interview", "aaa-brief", "aaa-tasks", "aaa-run", "aaa-review", "aaa-research"];
const REQUIRED_PHRASES = {
  "aaa-interview": ["one question", "01-interview-record.md", "stop rule", "R#", "anything else", "Q0", "Other facts given"],
  "aaa-brief": [
    "02-brief.md",
    "Not discussed",
    "source trace",
    "inferred",
    "v2",
    "one section only",
    "Other facts given",
    "use the later statement only when the user clearly changed it",
    "add an O# that names both",
    "Answers row",
    "header Status to `complete`",
    "research report answers an R#",
    "start from its latest version"
  ],
  "aaa-tasks": ["03-tasks.md", "done check", "needs approval", "parallel-safe", "Not yet specified", "not one of this project's documents or outputs", "Answers row"],
  "aaa-run": [
    "done check",
    "three times",
    "needs approval",
    "check not run",
    "irreversible",
    "Never give a subagent a task flagged needs approval",
    "not one of this project's documents or outputs",
    "create `03-tasks.md`",
    "header Status to `in progress`",
    "header Status to `complete`"
  ],
  "aaa-review": [
    "04-review.md",
    "self-review",
    "needs your decision",
    "not checked",
    "Attempted",
    "can only be measured after",
    "no output answers",
    "no requirement names",
    "a fact only the user has",
    "missing or not attached",
    "the next version",
    "keeps the R# open",
    "that an aaa skill wrote",
    "ask before you change it"
  ],
  "aaa-research": ["primary", "secondary", "never cite a search snippet", "unknown", "research-", "Answers row", "next brief version"]
};
const FORBIDDEN_PHRASES = {
  "aaa-tasks": ["no aaa skill wrote"],
  "aaa-run": ["no aaa skill wrote"],
  "aaa-review": ["An output you cannot see goes under \"not checked\"", "An output you cannot see is not checked"]
};
const CONVENTION_HEADINGS = [
  "Language",
  "Evidence labels",
  "No invention",
  "Untrusted content",
  "Irreversible steps",
  "Secrets",
  "Where documents go",
  "IDs",
  "Document header"
];
const TEMPLATES = [
  "aaa-interview/templates/interview-record.md",
  "aaa-brief/templates/brief.md",
  "aaa-tasks/templates/tasks.md",
  "aaa-review/templates/review.md",
  "aaa-research/templates/research.md"
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

for (const template of TEMPLATES) {
  test(`${template} header matches the shared document header`, async () => {
    const body = await text(`claude-ai/skills/${template}`);
    const documentType = body.match(/^\| Document \| (.+) \|$/mu)?.[1];
    assert.ok(documentType, "the header needs a Document row");
    assert.ok(body.startsWith(`# ${documentType}: `), `the title must start with "# ${documentType}: "`);
    assert.match(body, /^\| Language \| the document language \|$/mu);
  });
}

test("the interview record has a home for the topic, the opening message, other facts, and attachments", async () => {
  const body = await text("claude-ai/skills/aaa-interview/templates/interview-record.md");
  const headings = body.match(/^## .+$/gmu)?.map((line) => line.slice(3)) ?? [];
  for (const heading of ["Topic", "Q&A log", "Other facts given"]) assert.ok(headings.includes(heading), `missing ## ${heading}`);
  assert.match(body, /^\| Q0 \|/mu);
  assert.match(body, /^\| Fact \(user's words\) \| Source \|$/mu);
  assert.match(body, /^\| Sources \| .*attached files.* \|$/mu);
});

test("a research report names the research item it answers, and the conventions say so", async () => {
  assert.match(await text("claude-ai/skills/aaa-research/templates/research.md"), /^\| Answers \| .+ \|$/mu);
  assert.match(await text("claude-ai/shared/conventions.md"), /Answers/u);
});

test("a research report names the earlier document that holds its research item as a source", async () => {
  assert.match(
    await text("claude-ai/skills/aaa-research/templates/research.md"),
    /^\| Sources \| the earlier document that holds the R#.*the web.*attached files.* \|$/mu
  );
});

test("the setup guide names only real eval cases and keeps folder cases in a throwaway folder", async () => {
  const guide = await text("docs/setup/claude-ai.md");
  for (const [id, name] of guide.matchAll(/\b(aaa-[a-z]+)-(?:TRIGGER|NONTRIGGER|PRESSURE)-\d+\b/gu)) {
    assert.match(await text(`claude-ai/evals/${name}.md`), new RegExp(`^### ${id}$`, "mu"), `${id} is not an eval case`);
  }
  assert.ok(guide.includes("aaa-run-PRESSURE-3"), "the guide must name the case that deletes files");
  assert.ok(guide.replace(/\s+/gu, " ").includes("new throwaway folder"), "the guide must say to run folder cases in a new throwaway folder");
});

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

test("every weekday date in the eval fixtures has a year and the right weekday", async () => {
  const datePattern = new RegExp(`\\b(${WEEKDAYS.join("|")}) (\\d{1,2}) (${MONTHS.join("|")})(?:,? (\\d{4}))?`, "gu");
  const evalsDir = resolve(packRoot, "evals");
  for (const file of (await readdir(evalsDir)).filter((entry) => entry.endsWith(".md") && entry !== "results.md")) {
    for (const [match, weekday, day, month, year] of (await readFile(resolve(evalsDir, file), "utf8")).matchAll(datePattern)) {
      assert.ok(year, `${file}: "${match}" needs a year`);
      const date = new Date(Date.UTC(Number(year), MONTHS.indexOf(month), Number(day)));
      assert.equal(WEEKDAYS[date.getUTCDay()], weekday, `${file}: "${match}" is not a ${weekday}`);
    }
  }
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
    const flat = body.replace(/\s+/gu, " ").toLowerCase();
    for (const phrase of REQUIRED_PHRASES[name] ?? []) {
      assert.ok(flat.includes(phrase.toLowerCase()), `${name} SKILL.md must contain: ${phrase}`);
    }
    for (const phrase of FORBIDDEN_PHRASES[name] ?? []) {
      assert.ok(!flat.includes(phrase.toLowerCase()), `${name} SKILL.md must not contain: ${phrase}`);
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
