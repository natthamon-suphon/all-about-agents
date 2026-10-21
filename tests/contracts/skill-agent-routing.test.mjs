import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { posix, resolve } from "node:path";
import test from "node:test";

import { loadCore } from "../../installers/lib/load-core.mjs";
import { renderForSurface } from "../../installers/lib/render.mjs";

const core = await loadCore(process.cwd());
const guidePath = "all-about-agents/skills-and-agents.md";
const carriers = {
  claude: "config/CLAUDE.md",
  codex: "all-about-agents/skill-agent-routing.md",
  antigravity: "config/rules/all-about-agents.md"
};
const nativeCarriers = {
  claude: "CLAUDE.md",
  codex: "all-about-agents/skill-agent-routing.md",
  antigravity: "config/rules/all-about-agents.md"
};

async function render(surface, overrides = {}) {
  const homeDir = overrides.platform === "darwin" ? "/Users/tester" : "C:/Users/tester";
  return renderForSurface({ core, surface, profile: "portable", env: {}, homeDir, platform: "win32", ...overrides });
}

function filesOf(result) {
  return new Map(result.files.map((file) => [file.relativePath, new TextDecoder().decode(file.content)]));
}

test("global routing gives every installed skill and agent a working guide anchor", async () => {
  for (const surface of Object.keys(carriers)) {
    const files = filesOf(await render(surface));
    const rules = files.get(carriers[surface]);
    assert.match(rules, /^## Skill and agent routing rules$/mu, `${surface} needs the routing rules`);
    const guide = files.get(guidePath);
    assert.equal(guide, await readFile(resolve("docs/reference/skills-and-agents.md"), "utf8"));
    const entries = [...guide.matchAll(/^### ((?:skill|agent)-[a-z0-9-]+)$/gmu)].map((match) => match[1]);
    assert.deepEqual(entries.sort(), [
      ...core.skills.map(({ id }) => `skill-${id}`),
      ...core.roles.map(({ id }) => `agent-${id}`)
    ].sort(), "guide sections must match the complete portfolio exactly once");
    const headings = new Set([...guide.matchAll(/^#{1,6} (.+)$/gmu)].map((match) => match[1].toLowerCase().replaceAll(",", "").replace(/\s+/gu, "-")));
    for (const [, anchor] of guide.matchAll(/\]\(#([^)]+)\)/gu)) assert.ok(headings.has(anchor), `broken guide anchor: ${anchor}`);
    for (const [kind, records] of [["skill", core.skills], ["agent", core.roles]]) {
      for (const { id } of records) {
        const anchor = `${kind}-${id}`;
        const links = [...rules.matchAll(/\[([^\]]+)\]\(([^)]+)\)/gu)].filter((match) => match[1] === id);
        assert.equal(links.length, 1, `${surface} must route ${kind} ${id} once`);
        const [relativePath, targetAnchor] = links[0][2].split("#");
        assert.equal(posix.normalize(posix.join(posix.dirname(nativeCarriers[surface]), relativePath)), guidePath);
        assert.equal(targetAnchor, anchor);
        assert.ok(guide.includes(`### ${anchor}\n`), `${id} has no guide section`);
      }
    }
  }
});

test("routing follows canonical descriptions and role criteria without a second trigger catalog", async () => {
  const changed = structuredClone(core);
  changed.skills.find(({ id }) => id === "research").description = "Use when a current API | version needs proof.\nRead primary sources.";
  changed.roles.find(({ id }) => id === "architect").dispatchCriteria = ["A caller | interface needs a clear owner."];
  for (const surface of Object.keys(carriers)) {
    const rules = filesOf(await render(surface, { core: changed })).get(carriers[surface]);
    assert.ok(rules.includes("Use when a current API \\| version needs proof. Read primary sources."));
    assert.ok(rules.includes("A caller \\| interface needs a clear owner."));
  }
});

test("both profiles and platform targets keep deterministic routing and product size limits", async () => {
  for (const surface of Object.keys(carriers)) {
    for (const profile of ["portable", "template"]) {
      for (const platform of ["win32", "darwin"]) {
        const options = { profile, platform };
        const first = await render(surface, options);
        const second = await render(surface, options);
        const files = filesOf(first);
        assert.deepEqual(first.files, second.files);
        assert.match(files.get(carriers[surface]), /#skill-systematic-debugging/u);
        assert.ok(Buffer.byteLength(files.get(carriers[surface])) < (surface === "codex" ? 32768 : 24000));
        if (surface === "antigravity") {
          const gemini = files.get("config/GEMINI.md");
          assert.match(gemini, /config\/rules\/all-about-agents\.md#skill-and-agent-routing-rules/u);
          assert.ok(Buffer.byteLength(gemini) <= 12000);
          assert.equal(first.files.some(({ relativePath }) => relativePath.startsWith("hooks/")), false);
        }
      }
    }
  }
});

test("routing rejects missing canonical trigger data rather than silently skipping a skill or agent", async () => {
  for (const mutation of [
    (copy) => { copy.skills[0].description = ""; },
    (copy) => { copy.roles[0].dispatchCriteria = []; }
  ]) {
    const invalid = structuredClone(core);
    mutation(invalid);
    for (const surface of Object.keys(carriers)) await assert.rejects(render(surface, { core: invalid }), /routing|role contract/iu);
  }
});

test("Desktop packages keep the same complete routing and guide as CLI packages", async () => {
  for (const surface of ["codex", "antigravity"]) {
    const cli = filesOf(await render(surface));
    const desktop = filesOf(await render(surface, { targetRuntime: "desktop" }));
    assert.equal(desktop.get(carriers[surface]), cli.get(carriers[surface]));
    assert.equal(desktop.get(guidePath), cli.get(guidePath));
  }
});

test("Codex preserves room for operator text and the project entrypoint within the default instruction budget", async () => {
  const files = filesOf(await render("codex"));
  const global = files.get("AGENTS.md");
  const project = await readFile(resolve("AGENTS.md"));
  const operatorBytes = 10 * 1024;
  assert.ok(Buffer.byteLength(global) + operatorBytes + project.byteLength < 32768,
    "managed instructions, preserved 10 KiB operator text, and project instructions must fit together");
  assert.match(global, /all-about-agents\/skill-agent-routing\.md/u);
  assert.match(files.get("all-about-agents/skill-agent-routing.md"), /#skill-systematic-debugging/u);
});
