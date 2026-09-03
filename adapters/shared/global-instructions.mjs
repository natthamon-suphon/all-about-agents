import { globalInstructionContent } from "../../installers/lib/global-instructions.mjs";
import { displayLabel, renderInvocationGuidance, renderPresentationCatalog } from "../../installers/lib/presentation-contract.mjs";

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

function renderCommands(commands, presentation) {
  const lines = [
    "## Canonical actions",
    "",
    "Actions dispatch their declared workflow; reusable procedures belong in skills.",
    ""
  ];
  for (const command of [...commands].sort((left, right) => String(left?.actionId ?? "").localeCompare(String(right?.actionId ?? "")))) {
    const actionId = ensureText(command?.actionId, "unknown-action");
    const workflowId = ensureText(command?.workflowId, "unknown-workflow");
    const commandLabel = displayLabel(presentation, "command", actionId);
    const workflowLabel = displayLabel(presentation, "workflow", workflowId);
    const guidance = renderInvocationGuidance(presentation, {
      kind: "command",
      id: actionId,
      workflowId,
      task: `Run ${commandLabel} for the requested workflow`,
      reason: `Run ${commandLabel} for the requested workflow.`
    });
    lines.push(`### ${commandLabel}`, "", `- action: ${actionId}`, `- workflowId: ${workflowId}`, `- description: ${ensureText(command?.presentation?.help, "Canonical action.")}`, `- workflow: ${workflowLabel}`, "", guidance, "");
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

/** Render the shared canonical body for Antigravity Desktop and agy. */
export function renderGeminiGlobalInstructions(core) {
  return renderSharedGlobalInstructions(core);
}

/** Render Codex's shared global body followed by its canonical local sections. */
export function renderCodexGlobalInstructions(core, { canonicalRules, commands } = {}) {
  const loaded = ensureCore(core);
  const rules = canonicalRules === undefined ? loaded.rules : ensureRecords(canonicalRules, "canonicalRules");
  const actions = commands === undefined ? loaded.commands : ensureRecords(commands, "commands");
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
    renderPresentationCatalog(loaded.presentation),
    "",
    ...renderCommands(actions, loaded.presentation)
  ].join("\n"));
}
