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

// Registration replaces only the lines from a begin-prefixed line to an
// end-prefixed line, so operator text around them survives every update.
// These structural comments are added after the body passes its no-HTML check.
export const MANAGED_BLOCK_BEGIN_PREFIX = "<!-- all-about-agents:begin";
export const MANAGED_BLOCK_END_PREFIX = "<!-- all-about-agents:end";
const MANAGED_BLOCK_BEGIN = `${MANAGED_BLOCK_BEGIN_PREFIX} (managed by setup; keep your own text above or below this block) -->`;
const MANAGED_BLOCK_END = `${MANAGED_BLOCK_END_PREFIX} -->`;

function managedBlock(body) {
  return `${MANAGED_BLOCK_BEGIN}\n${normalizeBody(body).trimEnd()}\n${MANAGED_BLOCK_END}\n`;
}

/** Render the canonical body every surface shares. */
export function renderSharedGlobalInstructions(core) {
  return normalizeBody(globalInstructionContent(ensureCore(core)));
}

/** Render the shared canonical body plus the Claude-only house rules import. */
export function renderClaudeGlobalInstructions(core) {
  return managedBlock(renderSharedGlobalInstructions(core).trimEnd() + CLAUDE_HOUSE_RULES);
}

/**
 * Render Codex's shared global body followed by its canonical local sections.
 * The routing contract is inlined because Codex on Windows fails every plugin
 * command hook, so the SessionStart bootstrap never injects it there.
 */
export function renderCodexGlobalInstructions(core, { canonicalRules } = {}) {
  const loaded = ensureCore(core);
  const rules = canonicalRules === undefined ? loaded.rules : ensureRecords(canonicalRules, "canonicalRules");
  if (!loaded.presentation || typeof loaded.presentation !== "object") throw new TypeError("core.presentation is required for Codex rendering");
  return managedBlock([
    renderSharedGlobalInstructions(loaded).trimEnd(),
    "",
    "---",
    "# All About Agents for Codex",
    "",
    ...routingContract(loaded),
    "",
    ...renderRules(rules),
    "",
    "## Presentation",
    "",
    renderPresentationCatalog(loaded.presentation)
  ].join("\n"));
}

const ROUTING_SKILL = "using-all-about-agents";

function skillBody(core, skillId) {
  const records = Array.isArray(core.skills) ? core.skills : [];
  const record = records.find((entry) => (entry?.id ?? entry?.name) === skillId);
  const content = typeof record?.content === "string" ? record.content : "";
  if (content.trim().length === 0) throw new TypeError(`core.skills must provide content for ${skillId}`);
  if (!content.startsWith("---\n")) return content.trim();
  const end = content.indexOf("\n---", 4);
  return (end < 0 ? content : content.slice(end + 5)).trim();
}

function routingContract(core) {
  return [
    "## Routing contract",
    "",
    "This contract is inlined, so it applies even when no session-start hook runs.",
    "It is the body of the `using-all-about-agents` skill and it applies to every",
    "session.",
    "",
    skillBody(core, ROUTING_SKILL)
  ];
}

/**
 * Render Antigravity's GEMINI.md block: the shared body and the inlined routing
 * contract, because Antigravity has no SessionStart event (decision A7 of
 * docs/plans/2026-09-19-restore-antigravity.md). agy truncates one rule file
 * at 24,000 bytes, so the canonical rules ship in a separate rule file.
 */
export function renderAntigravityGlobalInstructions(core) {
  const loaded = ensureCore(core);
  return managedBlock([
    renderSharedGlobalInstructions(loaded).trimEnd(),
    "",
    "---",
    "# All About Agents for Antigravity",
    "",
    ...routingContract(loaded)
  ].join("\n"));
}

/** Render the always-on global rule file that carries Antigravity's canonical rules and catalog. */
export function renderAntigravityGlobalRules(core, { canonicalRules } = {}) {
  const loaded = ensureCore(core);
  const rules = canonicalRules === undefined ? loaded.rules : ensureRecords(canonicalRules, "canonicalRules");
  if (!loaded.presentation || typeof loaded.presentation !== "object") throw new TypeError("core.presentation is required for Antigravity rendering");
  return normalizeBody([
    "---",
    "trigger: always_on",
    "---",
    "",
    "# All About Agents rules for Antigravity",
    "",
    ...renderRules(rules),
    "",
    "## Presentation",
    "",
    renderPresentationCatalog(loaded.presentation)
  ].join("\n"));
}
