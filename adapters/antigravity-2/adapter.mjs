import { createHash } from "node:crypto";

import antigravityBootstrapTemplate from "./templates/hooks/bootstrap.json" with { type: "json" };
import antigravityEmergencyTemplate from "./templates/hooks/emergency-guard.json" with { type: "json" };
import antigravityActivityTemplate from "./templates/hooks/activity-audit.json" with { type: "json" };
import antigravityCheckpointTemplate from "./templates/hooks/checkpoint.json" with { type: "json" };
import { renderJson, renderText } from "../shared/render-utils.mjs";
import { renderSurface as validateSurface, validateRenderResult } from "../shared/adapter-contract.mjs";
import { assertNativeRoleRecords, assertNativeRoleSemantics, hasNarrowerNativeScope, nativeCapabilityDiagnostics, nativeScopeDiagnostics, isRoleReadOnly } from "../../core/roles/contract.mjs";
import { classifyEmergencyAction, REASONS } from "../../installers/lib/emergency-policy.mjs";

const SURFACE = "antigravity-2";
const DESKTOP_SURFACE = "antigravity-2-desktop";
const PLUGIN_ROOT = ".agents/plugins/all-about-agents";

const ACTION_IDS = [
  "aaa:design", "aaa:build", "aaa:fix", "aaa:review",
  "aaa:audit", "aaa:improve-skill", "aaa:resume", "aaa:verify"
];

const DESKTOP_TOOLS = Object.freeze([
  "view_file", "write_to_file", "replace_file_content", "multi_replace_file_content",
  "list_dir", "find_by_name", "grep_search", "search_web", "read_url_content",
  "run_command", "invoke_subagent", "define_subagent", "send_message",
  "manage_subagents", "ask_permission", "list_permissions"
]);

const FORBIDDEN_DESKTOP_CONTENT = Object.freeze([
  Object.freeze({ label: "agy CLI path or settings", pattern: /(?:antigravity-cli|agy)[/\\]/iu }),
  Object.freeze({ label: "agy CLI model slug", pattern: /gemini-3\.7-flash-high/iu }),
  Object.freeze({ label: "agy CLI option", pattern: /--(?:model|effort|agent|sandbox|dangerously-skip-permissions)\b/iu })
]);

/** Semantic-to-native mappings from the documented Desktop tool vocabulary. */
export const ANTIGRAVITY_SEMANTIC_MAPPINGS = Object.freeze({
  "repository-read": Object.freeze(["view_file", "list_dir", "find_by_name", "grep_search"]),
  "repository-write": Object.freeze(["write_to_file", "replace_file_content", "multi_replace_file_content"]),
  "web-primary-sources": Object.freeze(["search_web", "read_url_content"]),
  "isolated-write": Object.freeze(["write_to_file", "replace_file_content", "multi_replace_file_content"]),
  "command-execution": Object.freeze(["run_command"]),
  "filesystem-read": Object.freeze(["view_file", "list_dir", "find_by_name", "grep_search"]),
  "filesystem-write": Object.freeze(["write_to_file", "replace_file_content", "multi_replace_file_content"]),
  "git-read": Object.freeze(["run_command"]),
  "git-write": Object.freeze(["run_command"]),
  "test-execution": Object.freeze(["run_command"]),
  "external-research": Object.freeze(["search_web", "read_url_content"]),
  evaluation: Object.freeze(["run_command", "view_file"]),
  "role-dispatch": Object.freeze(["invoke_subagent", "define_subagent", "manage_subagents"]),
  "workflow-state": Object.freeze(["view_file", "write_to_file"]),
  "schema-validation": Object.freeze(["run_command"]),
  "native-rendering": Object.freeze(["write_to_file"])
});

export const ANTIGRAVITY_ACTION_MAPPINGS = Object.freeze(Object.fromEntries(
  ACTION_IDS.map((actionId) => [actionId, Object.freeze({
    supported: false,
    support: "manual-unknown",
    status: "unknown",
    source: "research-antigravity-2.md",
    reason: "No documented Desktop prompt or workflow mapping is published for this canonical action.",
    manualStep: `Use a manually authored Desktop prompt or workflow for ${actionId} only after verifying the Desktop UI; no native action mapping is claimed.`
  })])
));

/** Desktop has a display-name selector, not a public model key or settings file. */
export const ANTIGRAVITY_MODEL_POLICY = Object.freeze({
  desktop: Object.freeze({
    displayName: "Gemini 3.7 Flash Medium",
    selection: "manual conversation selector",
    persistence: "conversation-local",
    status: "verified"
  }),
  requestedDesktopFlashHigh: Object.freeze({
    claim: "Gemini 3.7 Flash High",
    status: "unsupported",
    source: "research-antigravity-2.md"
  })
});

const EMERGENCY_DENIES = Object.freeze([
  "command(rm -rf)",
  "command(sudo)",
  "write_file(.git/)",
  "write_file(/home/user/.ssh)"
]);

export const ANTIGRAVITY_PERMISSION_POLICY = Object.freeze({
  portable: Object.freeze({ preset: "Default", manualOnly: true, deny: EMERGENCY_DENIES }),
  template: Object.freeze({ preset: "Unrestricted", manualOnly: true, deny: EMERGENCY_DENIES })
});

const DEFAULT_ROLES = Object.freeze({
  researcher: Object.freeze({
    description: "Find and cite primary sources without mutating the repository.",
    capabilities: ["external-research", "web-primary-sources", "repository-read"]
  }),
  investigator: Object.freeze({
    description: "Reproduce an internal problem and rank evidence-backed hypotheses.",
    capabilities: ["repository-read", "filesystem-read"],
    readOnly: true
  }),
  architect: Object.freeze({
    description: "Design modules, interfaces, seams, invariants, and risks.",
    capabilities: ["repository-read", "schema-validation", "evaluation"],
    readOnly: true
  }),
  implementer: Object.freeze({
    description: "Make scoped test-first changes and report fresh evidence.",
    capabilities: ["repository-read", "repository-write", "isolated-write", "command-execution"]
  }),
  verifier: Object.freeze({
    description: "Run fresh black-box checks without changing implementation files.",
    capabilities: ["repository-read", "test-execution", "evaluation"],
    readOnly: true
  }),
  reviewer: Object.freeze({
    description: "Review specifications, diffs, tests, and maintainability evidence.",
    capabilities: ["repository-read", "evaluation", "schema-validation"],
    readOnly: true
  }),
  "security-reviewer": Object.freeze({
    description: "Check threat paths, secrets, containment, and emergency guardrails.",
    capabilities: ["repository-read", "evaluation", "schema-validation"],
    readOnly: true
  })
});

function profileId(profile) {
  const id = typeof profile === "string" ? profile : profile?.id;
  if (!Object.hasOwn(ANTIGRAVITY_PERMISSION_POLICY, id)) throw new TypeError("profile.id must be portable or template");
  return id;
}

function ensureText(value) {
  return renderText(typeof value === "string" ? value : String(value ?? ""));
}

function stripFrontmatter(value) {
  const text = ensureText(value);
  if (!text.startsWith("---\n")) return text;
  const delimiter = text.indexOf("\n---\n", 4);
  return delimiter < 0 ? text : ensureText(text.slice(delimiter + 6));
}

function skillIds(core) {
  const inventory = Array.isArray(core?.inventory?.skills) ? core.inventory.skills : [];
  const records = Array.isArray(core?.skills) ? core.skills.map((skill) => skill?.id || skill?.name) : [];
  return [...new Set([...inventory, ...records].filter((id) => typeof id === "string" && id.length > 0))].sort();
}

function renderSkill(name, record) {
  const description = typeof record?.description === "string" && record.description.trim()
    ? record.description.trim()
    : `Canonical ${name} skill.`;
  const body = typeof record?.content === "string" && record.content.trim()
    ? stripFrontmatter(record.content)
    : "DEFERRED: canonical source is missing.\nOwner: cycle-05-skill-remediation (T017-T043).\n";
  return ensureText(`---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}`);
}

function renderRule(rule) {
  const lines = [`# ${rule.title || rule.id}`, "", rule.description || rule.purpose || "Canonical portable rule.", ""];
  if (Array.isArray(rule.requirements) && rule.requirements.length > 0) lines.push("## Requirements", "", ...rule.requirements.map((item) => `- ${item}`), "");
  if (Array.isArray(rule.invariants) && rule.invariants.length > 0) lines.push("## Invariants", "", ...rule.invariants.map((item) => `- ${item}`), "");
  return ensureText(lines.join("\n"));
}

function renderAgent(name, role) {
  const fallback = DEFAULT_ROLES[name] || Object.freeze({ description: "Unknown role; no native capabilities are granted.", capabilities: [], readOnly: true });
  const description = typeof role?.description === "string" && role.description.trim() ? role.description.trim() : fallback.description;
  const capabilities = [...new Set([
    ...(Array.isArray(role?.capabilities) ? role.capabilities : []),
    ...(Array.isArray(role?.requiredCapabilities) ? role.requiredCapabilities : []),
    ...(Array.isArray(role?.allowedCapabilities) ? role.allowedCapabilities : []),
    ...(role ? [] : fallback.capabilities)
  ])];
  let tools = [...new Set(capabilities.flatMap((capability) => ANTIGRAVITY_SEMANTIC_MAPPINGS[capability] || []))];
  if (tools.length === 0 && !role) tools = [...ANTIGRAVITY_SEMANTIC_MAPPINGS["repository-read"]];
  const readOnly = isRoleReadOnly(role || fallback);
  if (readOnly) tools = tools.filter((tool) => ![
    "write_to_file", "replace_file_content", "multi_replace_file_content", "run_command",
    "invoke_subagent", "define_subagent", "manage_subagents"
  ].includes(tool));
  tools = tools.filter((tool) => DESKTOP_TOOLS.includes(tool)).sort();
  const commandExecutionPolicy = tools.includes("run_command") ? "sandbox" : "off";
  const roleDiagnostics = nativeCapabilityDiagnostics({ surface: SURFACE, role: role || fallback, mappings: ANTIGRAVITY_SEMANTIC_MAPPINGS, blockedNativeTools: ["write_to_file", "replace_file_content", "multi_replace_file_content", "run_command", "invoke_subagent", "define_subagent", "manage_subagents"] });
  const promptDiagnostics = roleDiagnostics.map((entry) => entry.message.replace(/: [\s\S]*? Manual\/fail-closed guidance:/u, ": native read-only policy does not expose this capability. Manual/fail-closed guidance:"));
  const lines = [
    "---",
    `name: ${JSON.stringify(name)}`,
    `description: ${JSON.stringify(description)}`,
    `tools: [${tools.map((tool) => JSON.stringify(tool)).join(", ")}]`,
    "mainAgent: true",
    "subagent: true",
    "model: inherit",
    `commandExecutionPolicy: ${commandExecutionPolicy}`,
    "mcpServers: []",
    "skills: []",
    "plugins: []",
    "---",
    "",
    `${role?.prompt || `Operate as the ${name} role. Preserve scope, verify evidence, and report uncertainty.`}${promptDiagnostics.length > 0 ? `\n\nNative capability diagnostics:\n${promptDiagnostics.map((message) => `- ${message}`).join("\n")}` : ""}${hasNarrowerNativeScope(role) ? "\n\nNative controls are workspace-wide; the declared task paths remain an outer approval boundary." : ""}`
  ];
  return ensureText(lines.join("\n"));
}

function addFile(files, relativePath, content, mode = null) {
  files.push({ relativePath, content: new TextEncoder().encode(ensureText(content)), mode });
}

function validateDesktopContent(files) {
  const decoder = new TextDecoder();
  for (const file of files) {
    const content = decoder.decode(file.content);
    for (const forbidden of FORBIDDEN_DESKTOP_CONTENT) {
      if (forbidden.pattern.test(content)) {
        throw new TypeError(`Antigravity Desktop render rejected forbidden Desktop content (${forbidden.label}) in ${file.relativePath}`);
      }
    }
  }
}

function ownership(files) {
  return files.map((file) => ({
    relativePath: file.relativePath,
    sha256: createHash("sha256").update(file.content).digest("hex")
  })).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

function coreShape(core) {
  if (!core || typeof core !== "object") throw new TypeError("core is required");
  for (const collection of ["rules", "roles", "skills", "workflows", "commands"]) {
    if (!Array.isArray(core[collection])) throw new TypeError(`core.${collection} must be an array`);
  }
}

function capabilityGuidance() {
  return ensureText([
    "# Desktop capability guidance",
    "",
    "This package targets the Antigravity 2.0 Desktop plugin contract.",
    "Workspace discovery uses `.agents/plugins/<plugin>/`; global discovery uses `~/.gemini/config/plugins/<plugin>/`.",
    "Skills use `skills/<skill>/SKILL.md`; rules use `rules/<rule>.md`.",
    "The Desktop Plugins page omits `agents/`; the Desktop Subagents page separately documents `agents/<role>.md`.",
    "Plugin-agent packaging is ambiguous and not guaranteed by the Plugins layout; verify agent discovery manually before relying on it.",
    "The published Desktop tools are the exact names used in agent frontmatter and semantic mappings.",
    "Read-only capability diagnostics identify suppressed command or mutation semantics; record them as unavailable or not run and do not infer a substitute.",
    "The implementer's Desktop write controls are workspace-wide; its declared task paths remain an outer approval boundary.",
    "No serialized application preferences, cross-conversation model key, or command-line option is part of this package.",
    ""
  ].join("\n"));
}

function modelRule() {
  return ensureText([
    "# Desktop model selection",
    "",
    "Manual step (verified): open the Desktop model selector and choose `Gemini 3.7 Flash Medium`.",
    "The public Desktop contract documents this choice as sticky between user messages in one conversation.",
    "",
    "Unsupported diagnostic:",
    "- surface: antigravity-2-desktop",
    "- claim: Gemini 3.7 Flash High",
    "- status: unsupported",
    "- source: research-antigravity-2.md",
    "- manual_step: use the currently offered Desktop selector value above; do not enter a model key or persist it outside the conversation.",
    ""
  ].join("\n"));
}

function permissionRule() {
  return ensureText([
    "# Desktop permission and emergency controls",
    "",
    "Use the documented Desktop Project security preset in the UI. The portable profile uses `Default`; the template profile requests the manual `Unrestricted` preset.",
    "Full machine and Unrestricted are UI controls, not serialized package settings.",
    "",
    "Keep explicit Deny rules because precedence is Deny > Ask > Allow:",
    "- `command(rm -rf)`",
    "- `command(sudo)`",
    "- `write_file(.git/)`",
    "- `write_file(/home/user/.ssh)`",
    "",
    "A documented PreToolUse hook can return `decision: deny` for an emergency match. This package keeps that emergency hook disabled and keeps bootstrap non-automatic until the target-runtime probe verifies command resolution.",
    "There is no documented Desktop panic file or global kill switch; stop the active agent in the UI and add Deny rules manually.",
    ""
  ].join("\n"));
}

function hooksDocument() {
  return {
    "all-about-agents-safety": {
      enabled: false,
      PreToolUse: [],
      PostToolUse: [],
      PreInvocation: [],
      PostInvocation: [],
      Stop: []
    }
  };
}

/** Normalize only the documented Antigravity Desktop PreToolUse fields. */
export function normalizeAntigravityEmergencyRequest(request) {
  if (!request || typeof request !== "object" || Array.isArray(request) || !request.toolCall || typeof request.toolCall !== "object" || Array.isArray(request.toolCall)) return null;
  if (typeof request.toolCall.name !== "string" || !request.toolCall.args || typeof request.toolCall.args !== "object" || Array.isArray(request.toolCall.args)) return null;
  const name = request.toolCall.name.toLowerCase();
  const args = request.toolCall.args;
  return {
    capability: name.includes("run_command") ? "command-execution" : name.includes("write") || name.includes("edit") ? "filesystem-write" : "filesystem-read",
    command: typeof args.CommandLine === "string" ? args.CommandLine : "",
    paths: typeof args.filePath === "string" ? [args.filePath] : [],
    gitOperation: typeof args.CommandLine === "string" ? args.CommandLine : null,
    secretOperation: name.includes("read") ? { operation: "read" } : null
  };
}

export function mapAntigravityEmergencyDecision(classification) {
  const reason = classification?.decision === "deny" && Object.hasOwn(REASONS, classification.ruleId) ? REASONS[classification.ruleId] : "";
  return reason ? { decision: "deny", reason } : {};
}

export function classifyAntigravityEmergencyRequest(request) {
  const normalized = normalizeAntigravityEmergencyRequest(request);
  return normalized ? classifyEmergencyAction(normalized) : { decision: "allow", ruleId: null, reason: "Allowed: no emergency rule matched." };
}

/** Render the documented Antigravity 2.0 Desktop package without native settings writes. */
export function renderAntigravity(input = {}) {
  coreShape(input.core);
  assertNativeRoleRecords(input.core.roles);
  assertNativeRoleSemantics(input.core.roles);
  const profile = profileId(input.profile ?? "portable");
  if (typeof input.statuslineName !== "string") throw new TypeError("statuslineName must be a string");
  const files = [];
  const skillRecords = new Map(input.core.skills.map((record) => [record.id || record.name, record]));
  const roleRecords = new Map(input.core.roles.map((record) => [record.id || record.name, record]));

  addFile(files, `${PLUGIN_ROOT}/plugin.json`, renderJson({ name: "all-about-agents" }));
  addFile(files, `${PLUGIN_ROOT}/hooks.json`, renderJson(hooksDocument()));
  addFile(files, `${PLUGIN_ROOT}/hooks/activity-audit.json`, renderJson(antigravityActivityTemplate));
  addFile(files, `${PLUGIN_ROOT}/hooks/checkpoint.json`, renderJson(antigravityCheckpointTemplate));
  addFile(files, `${PLUGIN_ROOT}/hooks/emergency-guard.json`, renderJson(antigravityEmergencyTemplate));
  addFile(files, `${PLUGIN_ROOT}/rules/adapter-capability-guidance.md`, capabilityGuidance());
  addFile(files, `${PLUGIN_ROOT}/rules/model-selection.md`, modelRule());
  addFile(files, `${PLUGIN_ROOT}/rules/permission-safety.md`, permissionRule());
  for (const rule of [...input.core.rules].sort((left, right) => String(left.id).localeCompare(String(right.id)))) {
    addFile(files, `${PLUGIN_ROOT}/rules/${rule.id}.md`, renderRule(rule));
  }
  for (const skill of skillIds(input.core)) addFile(files, `${PLUGIN_ROOT}/skills/${skill}/SKILL.md`, renderSkill(skill, skillRecords.get(skill)));

  const roleNames = [...(roleRecords.size > 0 ? roleRecords.keys() : Object.keys(DEFAULT_ROLES))].sort();
  for (const role of roleNames) addFile(files, `${PLUGIN_ROOT}/agents/${role}.md`, renderAgent(role, roleRecords.get(role)));
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  validateDesktopContent(files);

  const diagnostics = [
    ...input.core.roles.flatMap((role) => nativeCapabilityDiagnostics({ surface: SURFACE, role, mappings: ANTIGRAVITY_SEMANTIC_MAPPINGS, blockedNativeTools: ["write_to_file", "replace_file_content", "multi_replace_file_content", "run_command", "invoke_subagent", "define_subagent", "manage_subagents"] })),
    ...nativeScopeDiagnostics(input.core.roles)
  ];
  for (const skill of skillIds(input.core)) {
    if (!skillRecords.has(skill)) diagnostics.push({
      code: "missing-skill-source",
      severity: "error",
      message: `Canonical skill '${skill}' has no source record; owner: cycle-05-skill-remediation (T017-T043). Package is deferred until the source is supplied.`,
      sourcePath: "core/inventory.json"
    });
  }
  diagnostics.push({
    code: "desktop-model-high-unsupported",
    severity: "warning",
    message: "Desktop Gemini 3.7 Flash High is not a documented selector value; use the manual Gemini 3.7 Flash Medium step.",
    sourcePath: "research-antigravity-2.md"
  });
  diagnostics.push({
    code: "desktop-emergency-guard-probe-required",
    severity: "warning",
    message: "Desktop emergency guard output is documented but executable package-root resolution remains unverified; automatic hook execution is disabled.",
    sourcePath: "research-t014-pretool-hooks.md"
  });
  for (const actionId of ACTION_IDS) diagnostics.push({
    code: "desktop-action-unknown",
    severity: "warning",
    message: `${actionId} has no documented Desktop prompt or workflow mapping; use a manual Desktop prompt or workflow only after verification.`,
    sourcePath: "research-antigravity-2.md"
  });

  const result = {
    files,
    registrations: [
      {
        kind: "plugin-registration",
        surface: DESKTOP_SURFACE,
        relativePath: `${PLUGIN_ROOT}/plugin.json`,
        discovery: "Desktop workspace plugin discovery",
        manualOnly: true
      },
      {
        kind: "manual-model-selection",
        surface: DESKTOP_SURFACE,
        model: ANTIGRAVITY_MODEL_POLICY.desktop.displayName,
        status: ANTIGRAVITY_MODEL_POLICY.desktop.status,
        persistence: ANTIGRAVITY_MODEL_POLICY.desktop.persistence,
        applyVia: "Desktop model selector"
      },
      {
        kind: "unsupported-diagnostic",
        surface: DESKTOP_SURFACE,
        claim: ANTIGRAVITY_MODEL_POLICY.requestedDesktopFlashHigh.claim,
        status: ANTIGRAVITY_MODEL_POLICY.requestedDesktopFlashHigh.status,
        source: ANTIGRAVITY_MODEL_POLICY.requestedDesktopFlashHigh.source,
        manual_step: "Open the Desktop model selector and choose the currently offered Gemini 3.7 Flash Medium; do not enter a model key or persist the choice outside the conversation."
      },
      {
        kind: "permission-ui",
        surface: DESKTOP_SURFACE,
        profile,
        preset: ANTIGRAVITY_PERMISSION_POLICY[profile].preset,
        manualOnly: true,
        precedence: "Deny > Ask > Allow",
        deny: [...ANTIGRAVITY_PERMISSION_POLICY[profile].deny]
      },
      {
        kind: "hook-contract",
        surface: DESKTOP_SURFACE,
        relativePath: `${PLUGIN_ROOT}/hooks.json`,
        enabled: false,
        event: antigravityBootstrapTemplate.event,
        manualOnly: true,
        automaticHookExecution: false,
        probeRequired: antigravityBootstrapTemplate.probeRequired,
        probe: {
          status: antigravityBootstrapTemplate.probe.status,
          reason: antigravityBootstrapTemplate.probe.reason,
          manualSequence: [...antigravityBootstrapTemplate.probe.manualSequence]
        }
      },
      {
        kind: "activity-audit",
        surface: DESKTOP_SURFACE,
        relativePath: `${PLUGIN_ROOT}/hooks/activity-audit.json`,
        event: antigravityActivityTemplate.event,
        optional: true,
        automatic: false,
        probeRequired: true,
        status: antigravityActivityTemplate.probe.status,
        failureMode: antigravityActivityTemplate.failureMode,
        recordedFields: [...antigravityActivityTemplate.recordedFields]
      },
      {
        kind: "checkpoint",
        surface: DESKTOP_SURFACE,
        relativePath: `${PLUGIN_ROOT}/hooks/checkpoint.json`,
        automatic: false,
        nativeHookEquivalent: false,
        durableWorkflow: antigravityCheckpointTemplate.durableWorkflow,
        failureMode: antigravityCheckpointTemplate.failureMode,
        recordedFields: [...antigravityCheckpointTemplate.recordedFields]
      },
      {
        kind: "emergency-guard",
        surface: DESKTOP_SURFACE,
        relativePath: `${PLUGIN_ROOT}/hooks/emergency-guard.json`,
        enabled: false,
        automatic: false,
        automaticHookExecution: false,
        probeRequired: antigravityEmergencyTemplate.probeRequired,
        status: antigravityEmergencyTemplate.probe.status
      },
      {
        kind: "runtime-prerequisite",
        executable: antigravityBootstrapTemplate.runtime.executable,
        check: [antigravityBootstrapTemplate.runtime.executable, "--version"],
        minimumVersion: antigravityBootstrapTemplate.runtime.minimumVersion,
        onMissing: antigravityBootstrapTemplate.runtime.missingRuntime,
        requiredBy: ["manual-bootstrap-probe"],
        platforms: ["win32", "darwin", "linux"]
      }
    ],
    diagnostics,
    ownership: ownership(files)
  };
  const validation = validateRenderResult(result);
  if (!validation.valid) throw new Error(`Antigravity adapter produced an invalid RenderResult: ${JSON.stringify(validation.errors)}`);
  return result;
}

/** Apply the shared adapter seam and all required canonical action mappings. */
export function renderSurface(input = {}) {
  const capabilityRecord = {
    surface: SURFACE,
    requiredMappings: ACTION_IDS,
    actionMappings: ANTIGRAVITY_ACTION_MAPPINGS,
    render: () => renderAntigravity(input)
  };
  return validateSurface({
    ...input,
    surface: SURFACE,
    capabilityRecord: { ...capabilityRecord, ...(input.capabilityRecord || {}) }
  });
}

export const render = renderAntigravity;
