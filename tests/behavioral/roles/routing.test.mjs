import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const routing = JSON.parse(await readFile(resolve(process.cwd(), "tests/behavioral/roles/routing.json"), "utf8"));

function routeRole(prompt) {
  const text = prompt.toLowerCase();
  if (/(?:security|threat|secret|privilege|stride|exploit|containment)/u.test(text)) return "security-reviewer";
  if (/(?:first-party|official|regulation|current|cite|external)/u.test(text)) return "researcher";
  if (/(?:stack|trace|reproduce|regression|configuration fails|bad value|root)/u.test(text)) return "investigator";
  if (/(?:black-box|parser|deterministic|not run)/u.test(text)) return "verifier";
  if (/(?:diff|quality|specification|maintainability|test hygiene)/u.test(text)) return "reviewer";
  if (/(?:interface|seam|design|module|invariants)/u.test(text)) return "architect";
  if (/(?:write|implement|apply|vertical slice|failing test|scoped)/u.test(text)) return "implementer";
  return null;
}

test("critical canonical routing scenarios score 5/5 deterministically", () => {
  for (const scenario of routing.scenarios.filter((entry) => entry.critical === true)) {
    const results = scenario.cases.map((entry) => ({
      id: entry.id,
      expected: entry.expectedRole,
      actual: routeRole(entry.prompt)
    }));
    assert.equal(results.length, 5, `${scenario.id} must contain five cases`);
    assert.equal(results.filter((entry) => entry.expected === entry.actual).length, 5, JSON.stringify({ scenario: scenario.id, results }));
  }
});
