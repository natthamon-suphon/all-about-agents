import { globalInstructionContent } from "../../installers/lib/global-instructions.mjs";
import { renderPresentationCatalog } from "../../installers/lib/presentation-contract.mjs";

function ensureCore(core) {
  if (!core || typeof core !== "object" || Array.isArray(core)) throw new TypeError("core is required");
  return core;
}

function ensureRecords(value, name) {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value;
}

function ensureText(value, fallback) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeBody(value) {
  const body = String(value).replace(/\r\n?/gu, "\n").replace(/\n+$/u, "");
  return `${body}\n`;
}

function renderRules(rules) {
  const lines = ["## Canonical repository rules", ""];
  for (const rule of [...rules].sort((left, right) => String(left?.id ?? "").localeCompare(String(right?.id ?? "")))) {
    const id = ensureText(rule?.id, "unknown-rule");
    lines.push(`### ${ensureText(rule?.title, id)}`, "", ensureText(rule?.description || rule?.purpose, "Canonical repository rule."));
    if (Array.isArray(rule?.requirements)) for (const requirement of rule.requirements) lines.push(`- ${requirement}`);
    if (Array.isArray(rule?.invariants)) for (const invariant of rule.invariants) lines.push(`- ${invariant}`);
    lines.push("");
  }
  return lines;
}

const CLAUDE_HOUSE_RULES = `

## egroup house rules (coding-guidelines)

The rules above stay authoritative for general behavior. The import below is the
more specific second layer: egroup stack facts, security and endpoint exposure,
branching model, and the house rules that the installed skills depend on. Stack
digests arrive separately through the guideline-dispatch hook.

@~/Workspaces/coding-guidelines/Rules/RULES.md`;

/** Render the canonical body every surface shares. */
export function renderSharedGlobalInstructions(core) {
  return normalizeBody(globalInstructionContent(ensureCore(core)));
}

/** Render the shared canonical body plus the Claude-only house rules import. */
export function renderClaudeGlobalInstructions(core) {
  return normalizeBody(renderSharedGlobalInstructions(core).trimEnd() + CLAUDE_HOUSE_RULES);
}

/** Render Codex's shared global body followed by its canonical local sections. */
export function renderCodexGlobalInstructions(core, { canonicalRules } = {}) {
  const loaded = ensureCore(core);
  const rules = canonicalRules === undefined ? loaded.rules : ensureRecords(canonicalRules, "canonicalRules");
  if (!loaded.presentation || typeof loaded.presentation !== "object") throw new TypeError("core.presentation is required for Codex rendering");
  return normalizeBody([
    renderSharedGlobalInstructions(loaded).trimEnd(),
    "",
    "---",
    "# All About Agents for Codex",
    "",
    ...renderRules(rules),
    "",
    "## Presentation",
    "",
    renderPresentationCatalog(loaded.presentation)
  ].join("\n"));
}
