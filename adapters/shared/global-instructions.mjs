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

const ANTIGRAVITY_ROUTING_SKILL = "using-all-about-agents";

function skillBody(core, skillId) {
  const records = Array.isArray(core.skills) ? core.skills : [];
  const record = records.find((entry) => (entry?.id ?? entry?.name) === skillId);
  const content = typeof record?.content === "string" ? record.content : "";
  if (content.trim().length === 0) throw new TypeError(`core.skills must provide content for ${skillId}`);
  if (!content.startsWith("---\n")) return content.trim();
  const end = content.indexOf("\n---", 4);
  return (end < 0 ? content : content.slice(end + 5)).trim();
}

/**
 * Render Antigravity's global body.
 *
 * Claude and Codex receive the routing contract from the SessionStart bootstrap
 * hook. Antigravity has no SessionStart event, so its always-loaded instruction
 * file is the only carrier and the bootstrap skill is inlined here instead.
 * See docs/plans/2026-09-19-restore-antigravity.md decision A7.
 */
export function renderAntigravityGlobalInstructions(core, { canonicalRules } = {}) {
  const loaded = ensureCore(core);
  const rules = canonicalRules === undefined ? loaded.rules : ensureRecords(canonicalRules, "canonicalRules");
  if (!loaded.presentation || typeof loaded.presentation !== "object") throw new TypeError("core.presentation is required for Antigravity rendering");
  return normalizeBody([
    renderSharedGlobalInstructions(loaded).trimEnd(),
    "",
    "---",
    "# All About Agents for Antigravity",
    "",
    "## Routing contract",
    "",
    "This contract is inlined rather than injected by a session-start hook. It",
    "is the body of the `using-all-about-agents` skill and it applies to every",
    "session.",
    "",
    skillBody(loaded, ANTIGRAVITY_ROUTING_SKILL),
    "",
    ...renderRules(rules),
    "",
    "## Presentation",
    "",
    renderPresentationCatalog(loaded.presentation)
  ].join("\n"));
}
