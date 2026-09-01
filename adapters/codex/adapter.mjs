import { homedir } from "node:os";
import { posix, win32 } from "node:path";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import codexBootstrapTemplate from "./templates/hooks/bootstrap.json" with { type: "json" };
import codexEmergencyTemplate from "./templates/hooks/emergency-guard.json" with { type: "json" };
import codexActivityTemplate from "./templates/hooks/activity-audit.json" with { type: "json" };
import codexCheckpointTemplate from "./templates/hooks/checkpoint.json" with { type: "json" };
import { renderJson, renderText, renderToml } from "../shared/render-utils.mjs";
import { AdapterContractError, renderSurface as validateSurface, validateCommandRecords, validateRenderResult } from "../shared/adapter-contract.mjs";
import { createNativeIntegrationRecord } from "../shared/native-state.mjs";
import { assertNativeRoleRecords, assertNativeRoleSemantics, hasNarrowerNativeScope, hasScopedMutation, nativeScopeDiagnostics, isRoleReadOnly } from "../../core/roles/contract.mjs";
import { assertUnifiedSkillPortfolio, skillCompanionsFor } from "../../installers/lib/load-core.mjs";
import { profileTranslation, resolveProfile } from "../../profiles/profile-contract.mjs";

const CODEX_SURFACE = "codex";
const CODEX_TARGET_RUNTIMES = Object.freeze(["cli", "desktop"]);
const BOOTSTRAP_SOURCE = readFileSync(new URL("../../core/hooks/bootstrap.mjs", import.meta.url), "utf8");
const BOOTSTRAP_CONFIG_SOURCE = readFileSync(new URL("../../core/hooks/bootstrap.json", import.meta.url), "utf8");
const EMERGENCY_GUARD_SOURCE = readFileSync(new URL("../../core/hooks/emergency-guard.mjs", import.meta.url), "utf8");
const EMERGENCY_CONFIG_SOURCE = readFileSync(new URL("../../core/hooks/emergency-guard.json", import.meta.url), "utf8");
const EMERGENCY_POLICY_SOURCE = readFileSync(new URL("../../installers/lib/emergency-policy.mjs", import.meta.url), "utf8");
const AUDIT_LOG_SOURCE = readFileSync(new URL("../../installers/lib/audit-log.mjs", import.meta.url), "utf8");
const ACTION_IDS = Object.freeze([
  "aaa:design",
  "aaa:build",
  "aaa:fix",
  "aaa:review",
  "aaa:audit",
  "aaa:improve-skill",
  "aaa:resume",
  "aaa:verify"
]);

const CODEX_ACTION_MAPPINGS = Object.freeze(Object.fromEntries(ACTION_IDS.map((actionId) => [
  actionId,
  Object.freeze({ supported: true, native: "AGENTS.md" })
])));

const CODEX_SEMANTIC_MAPPINGS = Object.freeze({
  "repository-read": Object.freeze(["AGENTS.md"]),
  "repository-write": Object.freeze(["AGENTS.md"]),
  "web-primary-sources": Object.freeze(["web_search"]),
  "isolated-write": Object.freeze(["workspace-write"]),
  "command-execution": Object.freeze(["shell"]),
  "filesystem-read": Object.freeze(["AGENTS.md"]),
  "filesystem-write": Object.freeze(["workspace-write"]),
  "git-read": Object.freeze(["git"]),
  "git-write": Object.freeze(["git"]),
  "test-execution": Object.freeze(["shell"]),
  "external-research": Object.freeze(["web_search"]),
  evaluation: Object.freeze(["shell"]),
  "role-dispatch": Object.freeze(["agents"]),
  "workflow-state": Object.freeze(["AGENTS.md"]),
  "schema-validation": Object.freeze(["shell"]),
  "native-rendering": Object.freeze(["plugin"])
});

const DEFAULT_ROLES = Object.freeze({
  researcher: Object.freeze({ description: "Find and cite primary sources without mutating the repository.", capabilities: ["external-research", "web-primary-sources", "repository-read"] }),
  investigator: Object.freeze({ description: "Reproduce an internal problem and rank evidence-backed hypotheses.", capabilities: ["repository-read", "filesystem-read", "test-execution"] }),
  architect: Object.freeze({ description: "Design modules, interfaces, seams, invariants, and risks.", capabilities: ["repository-read", "schema-validation", "evaluation"] }),
  implementer: Object.freeze({ description: "Make scoped test-first changes and report fresh evidence.", capabilities: ["repository-read", "repository-write", "isolated-write", "test-execution"] }),
  verifier: Object.freeze({ description: "Run fresh black-box checks without changing implementation files.", capabilities: ["repository-read", "test-execution", "evaluation"] }),
  reviewer: Object.freeze({ description: "Review specifications, diffs, tests, and maintainability evidence.", capabilities: ["repository-read", "evaluation", "schema-validation"] }),
  "security-reviewer": Object.freeze({ description: "Check threat paths, secrets, containment, and emergency guardrails.", capabilities: ["repository-read", "evaluation", "schema-validation"] })
});

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export const CODEX_MODEL_POLICY = Object.freeze({
  portable: Object.freeze({
    sandbox_mode: "workspace-write",
    approval_policy: "on-request"
  }),
  template: Object.freeze({
    model: "gpt-5.6-sol",
    model_reasoning_effort: "max",
    sandbox_mode: "danger-full-access",
    approval_policy: "never"
  }),
  alternate: Object.freeze({
    model: "gpt-5.6-terra",
    model_reasoning_effort: "max"
  })
});

/** Resolve the documented Codex configuration root without reading or writing it. */
export function resolveCodexHome({ env = process.env, homeDir = homedir(), platform = process.platform } = {}) {
  const configured = env && typeof env.CODEX_HOME === "string" ? env.CODEX_HOME.trim() : "";
  return configured || (platform === "win32" ? win32.join(homeDir, ".codex") : posix.join(homeDir, ".codex"));
}

function addFile(files, relativePath, content, mode = null, contentKind = "generated") {
  if (contentKind !== "generated" && contentKind !== "companion") throw new TypeError("unknown rendered content kind");
  if (typeof content !== "string") throw new TypeError("rendered file content must be a string");
  files.push({ relativePath, content: new TextEncoder().encode(content), mode });
}

function makeOwnership(files) {
  return files.map((file) => ({
    relativePath: file.relativePath,
    sha256: createHash("sha256").update(file.content).digest("hex")
  })).sort((left, right) => compareCodePoints(left.relativePath, right.relativePath));
}

function configFor(model, profile, includePermissions = true, roleRecords = []) {
  const policy = includePermissions ? CODEX_MODEL_POLICY[profile] : CODEX_MODEL_POLICY.alternate;
  const config = includePermissions
    ? {
      approval_policy: policy.approval_policy,
      sandbox_mode: policy.sandbox_mode
    }
    : {
      model: model ?? policy.model,
      model_reasoning_effort: policy.model_reasoning_effort
    };
  if (includePermissions && typeof policy.model === "string") {
    config.model = model ?? policy.model;
    config.model_reasoning_effort = policy.model_reasoning_effort;
  }
  const root = renderToml(config);
  const registrations = [...roleRecords]
    .sort((left, right) => compareCodePoints(left.id, right.id))
    .map((role) => [
      "",
      `[agents.${role.id}]`,
      `config_file = ${JSON.stringify(`agents/${role.id}.toml`)}`,
      `description = ${JSON.stringify(role.description || role.purpose || `Canonical ${role.id} role.`)}`
    ].join("\n"));
  return ensureText(`${root.trimEnd()}${registrations.join("\n")}\n`);
}

function ensureText(value) {
  return renderText(value);
}

function quoteFrontmatter(value) {
  return JSON.stringify(typeof value === "string" ? value : String(value ?? ""));
}

function stripFrontmatter(value) {
  const text = ensureText(value);
  if (!text.startsWith("---\n")) return text;
  const end = text.indexOf("\n---", 4);
  return end < 0 ? text : ensureText(text.slice(end + 5));
}

function canonicalSkillIds(core) {
  const fromInventory = Array.isArray(core?.inventory?.skills) ? core.inventory.skills : [];
  const fromRecords = Array.isArray(core?.skills) ? core.skills.map((record) => record?.id ?? record?.name) : [];
  return [...new Set([...fromInventory, ...fromRecords].filter((id) => typeof id === "string" && id.length > 0))].sort(compareCodePoints);
}

function renderSkill(name, record) {
  const hasSource = typeof record?.content === "string" && record.content.trim().length > 0;
  const description = record?.description || `Canonical ${name} skill.`;
  const source = hasSource
    ? stripFrontmatter(record.content)
    : "DEFERRED: canonical source is missing.\nOwner: cycle-05-skill-remediation (T017-T043).\n";
  const guidanceReference = name === "using-all-about-agents"
    ? "\nSee [Codex adapter capability guidance](./references/adapter-capability-guidance.md).\n"
    : "";
  return {
    content: ensureText(`---\nname: ${name}\ndescription: ${quoteFrontmatter(description)}\n---\n\n${source}${guidanceReference}`),
    hasSource
  };
}

function renderRole(name, role) {
  const fallback = DEFAULT_ROLES[name] || Object.freeze({ description: "Unknown role; no native capabilities are granted.", capabilities: [] });
  const description = role?.description || role?.purpose || fallback.description;
  const capabilities = role
    ? [
      ...(Array.isArray(role.capabilities) ? role.capabilities : []),
      ...(Array.isArray(role.requiredCapabilities) ? role.requiredCapabilities : []),
      ...(Array.isArray(role.allowedCapabilities) ? role.allowedCapabilities : [])
    ]
    : fallback.capabilities;
  const roleContext = [
    role?.purpose,
    capabilities.length > 0 ? `Semantic capabilities: ${[...new Set(capabilities)].join(", ")}.` : "",
    Array.isArray(role?.invariants) && role.invariants.length > 0 ? `Invariants: ${role.invariants.join("; ")}` : "",
    Array.isArray(role?.dispatchCriteria) && role.dispatchCriteria.length > 0 ? `Dispatch criteria: ${role.dispatchCriteria.join("; ")}` : ""
  ].filter(Boolean).join("\n\n");
  const instructions = `${role?.prompt || roleContext || `Operate as the ${name} role. Preserve scope, verify evidence, and report uncertainty.`}${hasNarrowerNativeScope(role) ? "\n\nNative controls are workspace-wide; the declared task paths remain an outer approval boundary." : ""}`;
  const readOnly = isRoleReadOnly(role);
  const sandboxMode = readOnly || !hasScopedMutation(role) ? "read-only" : "workspace-write";
  return ensureText([
    `name = ${JSON.stringify(name)}`,
    `description = ${JSON.stringify(description)}`,
    `developer_instructions = ${JSON.stringify(instructions)}`,
    `sandbox_mode = ${JSON.stringify(sandboxMode)}`,
    ""
  ].join("\n"));
}

function pluginManifest() {
  return {
    author: {
      name: "All About Agents Maintainers"
    },
    name: "all-about-agents",
    version: "1.0.0",
    description: "Portable all-about-agents skills for Codex CLI and Desktop.",
    skills: "./skills/",
    interface: {
      displayName: "All About Agents",
      shortDescription: "Agent skills and workflow guidance",
      longDescription: "Portable all-about-agents skills and workflow guidance for coding agents.",
      developerName: "All About Agents Maintainers",
      category: "Developer Tools",
      capabilities: ["Read", "Write"],
      defaultPrompt: [
        "Use the all-about-agents workflow.",
        "Guide this change with TDD and verification."
      ]
    }
  };
}

function marketplaceManifest() {
  return {
    name: "all-about-agents-dev",
    interface: {
      displayName: "All About Agents Dev"
    },
    plugins: [{
      name: "all-about-agents",
      source: {
        source: "url",
        url: "./"
      },
      policy: {
        installation: "AVAILABLE",
        authentication: "ON_INSTALL"
      },
      category: "Developer Tools"
    }]
  };
}

function nativeHookRecord(feature, sourcePath, phaseOverrides = {}, manualSteps = null) {
  return createNativeIntegrationRecord({
    surface: CODEX_SURFACE,
    feature,
    sourcePath,
    phases: {
      rendered: {
        status: "pass",
        evidence: `Rendered the Codex ${feature} contract from ${sourcePath}.`
      },
      validated: {
        status: "pass",
        evidence: `Adapter validation accepted the Codex ${feature} contract.`
      },
      registered: {
        status: "not-run",
        evidence: "Native Codex marketplace and plugin registration was not run during rendering."
      },
      trusted: {
        status: "not-run",
        evidence: "Codex hook trust was not checked; review and trust this plugin hook in /hooks."
      },
      active: {
        status: "not-run",
        evidence: "Codex active hook state was not checked during rendering."
      },
      runtimeVerified: {
        status: "not-run",
        evidence: "Codex hook runtime was not verified in a native session."
      },
      ...phaseOverrides
    },
    manualSteps: manualSteps ?? [
      "Register the rendered package through the Codex marketplace and plugin commands.",
      "Open /hooks and review and trust the current plugin hook definition.",
      "Start a fresh Codex session before checking active hook behavior."
    ]
  });
}

function targetRuntimeOf(input) {
  const targetRuntime = input.targetRuntime ?? "cli";
  if (!CODEX_TARGET_RUNTIMES.includes(targetRuntime)) throw new TypeError(`targetRuntime must be one of: ${CODEX_TARGET_RUNTIMES.join(", ")}`);
  return targetRuntime;
}

function bootstrapHooks(targetRuntime) {
  const hooks = {
    description: codexBootstrapTemplate.description,
    hooks: {
      [codexBootstrapTemplate.event]: [
        {
          matcher: codexBootstrapTemplate.nativeMatcher,
          hooks: [{
            type: "command",
            command: codexBootstrapTemplate.command,
            commandWindows: codexBootstrapTemplate.commandWindows
          }]
        }
      ]
    }
  };
  hooks.hooks[codexActivityTemplate.event] = [{
    matcher: codexActivityTemplate.nativeMatcher,
    hooks: [{
      type: "command",
      command: codexActivityTemplate.command,
      commandWindows: codexActivityTemplate.commandWindows
    }]
  }];
  hooks.hooks[codexCheckpointTemplate.event] = [{
    matcher: codexCheckpointTemplate.nativeMatcher,
    hooks: [{
      type: "command",
      command: codexCheckpointTemplate.command,
      commandWindows: codexCheckpointTemplate.commandWindows
    }]
  }];
  if (targetRuntime === "cli") {
    hooks.hooks[codexEmergencyTemplate.event] = [{
      matcher: codexEmergencyTemplate.nativeMatcher,
      hooks: [{
        type: "command",
        command: codexEmergencyTemplate.command,
        commandWindows: codexEmergencyTemplate.commandWindows
      }]
    }];
  }
  return hooks;
}

function desktopEmergencyContract() {
  const contract = codexEmergencyTemplate.desktop;
  if (!contract || contract.automatic !== false || contract.probeRequired !== true || contract.status !== "not run" || typeof contract.reason !== "string" || !Array.isArray(contract.manualSequence)) throw new Error("Codex Desktop emergency template is incomplete");
  return contract;
}

function nativeEmergencyRecord(targetRuntime, profile) {
  const desktop = targetRuntime === "desktop";
  const permissionStep = profile.authority === "full"
    ? "Keep danger-full-access and approvals never bounded by the emergency deny policy."
    : "Keep the portable permission profile and do not claim full access.";
  const exactDenyStep = "Retain command(rm -rf), command(sudo), write_file(.git/), and write_file(/home/user/.ssh).";
  return createNativeIntegrationRecord({
    surface: CODEX_SURFACE,
    feature: "emergency-protection",
    phases: {
      rendered: {
        status: "pass",
        evidence: `Rendered the Codex ${desktop ? "Desktop" : "CLI"} emergency policy with ${profile.authority === "full" ? "danger-full-access and approvals never" : "the portable permission profile"}.`
      },
      validated: {
        status: "not-run",
        evidence: "The rendered deny policy is recorded only; native package validation was not run for this emergency protection record."
      },
      registered: {
        status: "not-run",
        evidence: desktop
          ? "Codex Desktop plugin discovery and emergency-control registration were not run; Desktop remains manual/probe-only."
          : "Codex plugin discovery and registration were not run during rendering."
      },
      trusted: {
        status: "not-run",
        evidence: desktop
          ? "Codex Desktop hook trust was not observed; perform the documented disposable deny-output probe first."
          : "Codex CLI hook trust was not checked; review and trust the plugin hook in /hooks before relying on it."
      },
      active: {
        status: "not-run",
        evidence: desktop
          ? "Codex Desktop emergency protection is not active by claim; no Desktop-specific evidence was collected."
          : "Codex active emergency hook state was not checked in a fresh CLI session."
      },
      runtimeVerified: {
        status: "not-run",
        evidence: desktop
          ? "Codex Desktop emergency deny output was not executed; no runtime handler is emitted for Desktop."
          : "Codex CLI emergency hook execution was not run in a native session."
      }
    },
    sourcePath: "adapters/codex/adapter.mjs",
    manualSteps: desktop ? [
      "Record the installed Codex Desktop version and platform.",
      permissionStep,
      exactDenyStep,
      "On a disposable package, perform the explicit deny-output probe before proposing or trusting a Desktop hook; this render emits no Desktop emergency runtime."
    ] : [
      "Register the rendered package through the Codex marketplace and plugin commands.",
      "Open /hooks and review and trust the emergency hook before relying on its deny output.",
      permissionStep,
      exactDenyStep,
      "Start a fresh Codex CLI session before checking active hook behavior."
    ]
  });
}

function desktopInstructions(profile) {
  const modelLines = profile.modelPolicies[CODEX_SURFACE] === "surface-default"
    ? ["The portable profile keeps the current Codex model and reasoning controls unchanged."]
    : [
      "The template profile selects gpt-5.6-sol with max reasoning.",
      "",
      "To use the explicit alternate in Codex Desktop, select gpt-5.6-terra and max reasoning in the Desktop model controls for the current thread.",
      "",
      "Desktop model selection is manual because no documented Desktop profile selector is assumed by this adapter."
    ];
  return ensureText([
    "# Codex Desktop manual setup",
    "",
    ...modelLines,
    "The emergency PreToolUse guard is rendered only for the explicit Codex CLI target; registration, trust, active state, and runtime evidence remain manual, while Desktop output stays probe-required and contains no copied emergency runtime.",
    ""
  ].join("\n"));
}

function parseTomlValue(raw, lineNumber) {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      throw new SyntaxError(`invalid TOML string on line ${lineNumber}`);
    }
  }
  if (value === "true" || value === "false") return value === "true";
  if (/^[+-]?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) throw new Error("not an array");
      return parsed;
    } catch {
      throw new SyntaxError(`invalid TOML array on line ${lineNumber}`);
    }
  }
  throw new SyntaxError(`unsupported TOML value on line ${lineNumber}`);
}

/** Parse the scalar TOML emitted by this adapter using only repository syntax. */
export function parseCodexToml(value) {
  if (typeof value !== "string") throw new TypeError("TOML document must be a string");
  const result = {};
  let target = result;
  const lines = value.replace(/\r\n?/gu, "\n").split("\n");
  if (lines.at(-1) !== "") throw new SyntaxError("TOML document must end with a newline");
  lines.slice(0, -1).forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const section = /^\[([A-Za-z0-9_.-]+)\]$/u.exec(trimmed);
    if (section) {
      target = result;
      for (const segment of section[1].split(".")) {
        if (!Object.hasOwn(target, segment)) target[segment] = {};
        else if (!target[segment] || typeof target[segment] !== "object" || Array.isArray(target[segment])) throw new SyntaxError(`invalid TOML section ${section[1]} on line ${index + 1}`);
        target = target[segment];
      }
      return;
    }
    const match = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/u.exec(trimmed);
    if (!match) throw new SyntaxError(`invalid TOML assignment on line ${index + 1}`);
    const [, key, raw] = match;
    if (Object.hasOwn(target, key)) throw new SyntaxError(`duplicate TOML key ${key} on line ${index + 1}`);
    target[key] = parseTomlValue(raw, index + 1);
  });
  return result;
}

function renderAgentsDocument(core) {
  const lines = [
    "# All About Agents",
    "",
    "Use the `using-all-about-agents` skill before the first answer or action when its trigger applies. Follow the active user and repository instruction hierarchy, preserve unrelated work, and report evidence or uncertainty.",
    "",
    "## Canonical rules",
    ""
  ];
  for (const rule of [...(core.rules || [])].sort((left, right) => compareCodePoints(String(left.id), String(right.id)))) {
    lines.push(`### ${rule.title || rule.id}`, "", rule.description || rule.purpose || "Canonical portable rule.");
    if (Array.isArray(rule.requirements)) for (const requirement of rule.requirements) lines.push(`- ${requirement}`);
    if (Array.isArray(rule.invariants)) for (const invariant of rule.invariants) lines.push(`- ${invariant}`);
    lines.push("");
  }
  lines.push(
    "## Canonical actions",
    "",
    "Actions dispatch their declared workflow; reusable procedures belong in skills. No repository recurrence definition is emitted; configure recurring operation through a supported product surface.",
    ""
  );
  for (const command of [...core.commands].sort((left, right) => compareCodePoints(String(left.actionId), String(right.actionId)))) {
    lines.push(
      `### ${command.actionId}`,
      "",
      `- action: ${command.actionId}`,
      `- workflowId: ${command.workflowId}`,
      `- description: ${command.presentation.help}`,
      ""
    );
  }
  return ensureText(lines.join("\n"));
}

function validateCommandPresentation(commands) {
  const errors = [];
  commands.forEach((command, index) => {
    const path = `/commands/${index}/presentation`;
    const presentation = command.presentation;
    if (presentation === null || typeof presentation !== "object" || Array.isArray(presentation)) {
      errors.push({
        code: "invalid-command-presentation",
        message: "presentation must be an object",
        path
      });
      return;
    }
    for (const field of ["label", "help"]) {
      if (typeof presentation[field] !== "string" || presentation[field].trim().length === 0) {
        errors.push({
          code: "invalid-command-presentation",
          message: `presentation.${field} must be a non-empty string`,
          path: `${path}/${field}`
        });
      }
    }
  });
  if (errors.length > 0) throw new AdapterContractError(errors);
}

function capabilityGuidance(profile) {
  const modelGuidance = profile.modelPolicies[CODEX_SURFACE] === "surface-default"
    ? "- The portable profile leaves model and reasoning selection unchanged."
    : "- The template primary overlay uses Sol/max; `terra-max.config.toml` provides the explicit Terra/max CLI alternative.";
  return ensureText([
    "# Codex adapter capability guidance",
    "",
    "This package is the Codex adapter's documented surface map.",
    "",
    "- `CODEX_HOME` selects the shared Codex CLI/Desktop configuration root; the fallback is the user's `.codex` directory.",
    "- `AGENTS.md` is rendered as a regular instruction file for the canonical rules and action-to-workflow mappings.",
    "- Skills are packaged under `skills/<skill>/SKILL.md` for plugin discovery and mirrored under `.agents/skills/<skill>/SKILL.md` for direct/global installation; missing canonical sources remain marked `DEFERRED`.",
    "- Custom roles are standalone custom-agent TOML files under `.codex/agents/<role>.toml`.",
    "- Each canonical `[agents.<role>]` registration points `config_file` at the delivered `agents/<role>.toml` role layer. That standalone file contains `developer_instructions` and top-level `sandbox_mode` (`read-only` for read-only roles and `workspace-write` only for the implementer). Relative `config_file` paths resolve from the declaring `config.toml`.",
    "- This role-layer pattern follows the official Codex Configuration Reference (https://developers.openai.com/codex/config-reference/); the published docs do not show one combined registration example, so native client acceptance remains a later manual check.",
    modelGuidance,
    "- To select the explicit CLI recovery profile, run `codex --profile terra-max`; the adapter does not configure an automatic Sol-to-Terra fallback.",
    "- Native `workspace-write` is workspace-wide; the implementer's declared task paths remain an outer approval boundary and are not enforced by this adapter.",
    "- Codex Desktop Terra/max selection is manual in its model controls.",
    "",
    "This adapter does not define repository schedules or a native statusline. If a selected Codex capability, path, syntax, or product surface is unavailable, report that condition and stop or ask for direction rather than inferring support.",
    ""
  ].join("\n"));
}

/** Render the initial deterministic Codex policy overlays. */
export function renderCodex(input = {}) {
  assertUnifiedSkillPortfolio(input);
  const targetRuntime = targetRuntimeOf(input);
  const core = input.core;
  if (!core || typeof core !== "object") throw new TypeError("core is required");
  for (const collection of ["rules", "skills", "workflows", "commands"]) {
    if (!Array.isArray(core[collection])) throw new TypeError(`core.${collection} must be an array`);
  }
  assertNativeRoleRecords(core.roles);
  assertNativeRoleSemantics(core.roles);
  const commandValidation = validateCommandRecords(core.commands, core.workflows);
  if (!commandValidation.valid) throw new AdapterContractError(commandValidation.errors);
  validateCommandPresentation(core.commands);
  const semanticProfile = resolveProfile(input.profile ?? "portable", {
    surface: CODEX_SURFACE,
    modelPolicyRefs: ["surface-default", "approved-sol-terra"]
  });
  const profile = semanticProfile.id;
  const files = [];
  addFile(files, ".codex-plugin/plugin.json", renderJson(pluginManifest()));
  addFile(files, ".agents/plugins/marketplace.json", renderJson(marketplaceManifest()));
  addFile(files, "hooks/hooks.json", renderJson(bootstrapHooks(targetRuntime)));
  addFile(files, "hooks/bootstrap.json", BOOTSTRAP_CONFIG_SOURCE);
  addFile(files, `hooks/${codexBootstrapTemplate.module}.mjs`, BOOTSTRAP_SOURCE, 0o755);
  addFile(files, "hooks/activity-audit.json", renderJson(codexActivityTemplate));
  addFile(files, "hooks/checkpoint.json", renderJson(codexCheckpointTemplate));
  addFile(files, "hooks/audit-log.mjs", AUDIT_LOG_SOURCE, 0o755);
  addFile(files, "hooks/activity-audit.mjs", `#!/usr/bin/env node
import { appendAuditEvent } from "./audit-log.mjs";
import { readBoundedStdin } from "./bootstrap.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const rawInput = await readBoundedStdin();
if (rawInput === null) process.exit(0);
try {
  const payload = JSON.parse(rawInput || "{}");
  await appendAuditEvent(join(dirname(fileURLToPath(import.meta.url)), "audit"), {
    surface: "codex",
    actionId: payload.actionId ?? payload.tool_name,
    outcome: payload.outcome ?? "success",
    sessionKey: payload.sessionKey ?? payload.session_id ?? payload.tool_use_id
  });
} catch { /* optional audit is fail-open */ }
`, 0o755);
  addFile(files, "hooks/pre-compact.mjs", `#!/usr/bin/env node
import { appendFile, mkdir } from "node:fs/promises";
import { readBoundedStdin } from "./bootstrap.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const safe = (value, fallback) => typeof value === "string" && value.trim() ? value.trim().replace(/[^A-Za-z0-9._-]/gu, "-").slice(0, 64) || fallback : fallback;
const rawInput = await readBoundedStdin();
if (rawInput === null) process.exit(0);
try {
  const payload = JSON.parse(rawInput || "{}");
  const checkpoint = {
    timestamp: new Date().toISOString(),
    workflowId: safe(payload.workflowId, "codex-hook"),
    taskId: safe(payload.taskId, "pre-compact"),
    state: safe(payload.state, "compacting"),
    status: safe(payload.status, "checkpointed")
  };
  const root = join(dirname(fileURLToPath(import.meta.url)), "checkpoints");
  await mkdir(root, { recursive: true });
  await appendFile(join(root, "checkpoint.jsonl"), JSON.stringify(checkpoint) + "\\n", { encoding: "utf8", flag: "a" });
} catch { /* durable checkpoint is fail-open */ }
`, 0o755);
  if (targetRuntime === "cli") {
    addFile(files, "hooks/emergency-guard.json", EMERGENCY_CONFIG_SOURCE);
    addFile(files, "hooks/emergency-guard.mjs", EMERGENCY_GUARD_SOURCE, 0o755);
    addFile(files, "hooks/emergency-policy.mjs", EMERGENCY_POLICY_SOURCE, 0o755);
  }
  addFile(files, "AGENTS.md", renderAgentsDocument(core));
  addFile(files, "docs/manual-desktop.md", desktopInstructions(semanticProfile));
  const skillRecords = new Map(core.skills.map((record) => [record.id || record.name, record]));
  const missingSkills = [];
  const skillRoots = [".agents/skills", "skills"];
  for (const skillRoot of skillRoots) {
    addFile(files, `${skillRoot}/using-all-about-agents/references/adapter-capability-guidance.md`, capabilityGuidance(semanticProfile));
    for (const skill of canonicalSkillIds(core)) {
      const rendered = renderSkill(skill, skillRecords.get(skill));
      if (skillRoot === ".agents/skills" && !rendered.hasSource) missingSkills.push({ skill, hasRecord: skillRecords.has(skill) });
      addFile(files, `${skillRoot}/${skill}/SKILL.md`, rendered.content);
      for (const companion of skillCompanionsFor(skillRecords.get(skill))) addFile(files, `${skillRoot}/${skill}/${companion.relativePath}`, companion.content, companion.mode, "companion");
    }
  }
  const roleRecords = new Map((Array.isArray(core.roles) ? core.roles : []).map((record) => [record.id || record.name, record]));
  const roleNames = [...(roleRecords.size > 0 ? roleRecords.keys() : Object.keys(DEFAULT_ROLES))].sort(compareCodePoints);
  const renderedRoles = roleNames.map((roleName) => roleRecords.get(roleName) || { id: roleName, ...DEFAULT_ROLES[roleName] });
  addFile(files, "config.toml", configFor(null, profile, true, renderedRoles));
  if (semanticProfile.modelPolicies[CODEX_SURFACE] !== "surface-default") addFile(files, "terra-max.config.toml", configFor(null, profile, false, renderedRoles));
  for (const roleName of roleNames) {
    const role = roleRecords.get(roleName) || { id: roleName, ...DEFAULT_ROLES[roleName] };
    addFile(files, `.codex/agents/${roleName}.toml`, renderRole(roleName, roleRecords.get(roleName)));
  }
  files.sort((left, right) => compareCodePoints(left.relativePath, right.relativePath));
  for (const file of files) {
    if (file.relativePath.endsWith(".toml")) parseCodexToml(new TextDecoder().decode(file.content));
  }
  const configRoot = resolveCodexHome(input);
  const emergencyRegistration = targetRuntime === "cli"
    ? {
        kind: "emergency-guard",
        surface: "codex-cli",
        targetRuntime,
        relativePath: "hooks/hooks.json",
        event: codexEmergencyTemplate.event,
        matcher: codexEmergencyTemplate.nativeMatcher,
        enabled: false,
        automatic: false,
        trustRequired: true,
        probeRequired: true,
        status: "not run"
      }
    : {
        ...desktopEmergencyContract(),
        kind: "emergency-guard",
        surface: "codex-desktop",
        targetRuntime,
        relativePath: "hooks/hooks.json",
        enabled: false
      };
  const result = {
    files,
    registrations: [
      profileTranslation(semanticProfile, CODEX_SURFACE),
      nativeEmergencyRecord(targetRuntime, semanticProfile),
      {
        kind: "plugin-package",
        relativePath: ".codex-plugin/plugin.json",
        packageRoot: ".",
        marketplaceArgs: ["plugin", "marketplace", "add", "PACKAGE_ROOT", "--json"],
        installArgs: ["plugin", "add", "all-about-agents@all-about-agents-dev", "--json"],
        discoveryArgs: ["plugin", "list", "--available", "--json"]
      },
      nativeHookRecord("bootstrap-hook", "adapters/codex/templates/hooks/bootstrap.json"),
      nativeHookRecord("activity-audit-hook", "adapters/codex/templates/hooks/activity-audit.json"),
      nativeHookRecord("checkpoint-hook", "adapters/codex/templates/hooks/checkpoint.json"),
      nativeHookRecord("emergency-guard-hook", "adapters/codex/templates/hooks/emergency-guard.json", targetRuntime === "desktop" ? {
        rendered: {
          status: "not-run-unavailable",
          evidence: "Codex Desktop emergency guard runtime is not emitted; a manual probe is required."
        },
        validated: {
          status: "not-run-unavailable",
          evidence: "Codex Desktop emergency guard runtime is not emitted, so its native contract cannot be validated."
        },
        registered: {
          status: "not-run-unavailable",
          evidence: "Codex Desktop has no emitted emergency guard runtime to register in this render."
        },
        trusted: {
          status: "not-run",
          evidence: "Codex Desktop hook trust remains a manual step; use /hooks after the manual emergency-guard probe."
        },
        active: {
          status: "not-run-unavailable",
          evidence: "Codex Desktop emergency guard runtime is not emitted; active state is unavailable until a manual probe establishes support."
        },
        runtimeVerified: {
          status: "not-run-unavailable",
          evidence: "Codex Desktop emergency guard runtime is not emitted; perform the manual deny-output probe before runtime verification."
        }
      } : {}, targetRuntime === "desktop" ? desktopEmergencyContract().manualSequence : undefined),
      {
        kind: "plugin-marketplace",
        relativePath: ".agents/plugins/marketplace.json",
        marketplace: "all-about-agents-dev",
        source: { source: "url", url: "./" }
      },
      {
        kind: "runtime-prerequisite",
        executable: codexBootstrapTemplate.runtime.executable,
        check: [codexBootstrapTemplate.runtime.executable, "--version"],
        minimumVersion: codexBootstrapTemplate.runtime.minimumVersion,
        onMissing: codexBootstrapTemplate.runtime.missingRuntime,
        requiredBy: [`hooks/${codexBootstrapTemplate.module}.mjs`],
        platforms: ["win32", "darwin", "linux"]
      },
      {
        kind: "hook-contract",
        surface: CODEX_SURFACE,
        relativePath: "hooks/hooks.json",
        event: codexBootstrapTemplate.event,
        matcher: codexBootstrapTemplate.nativeMatcher,
        trustRequired: true,
        desktopManualOnly: true
      },
      {
        kind: "activity-audit",
        surface: CODEX_SURFACE,
        relativePath: "hooks/hooks.json",
        event: codexActivityTemplate.event,
        matcher: codexActivityTemplate.nativeMatcher,
        optional: true,
        enabled: false,
        automatic: false,
        trustRequired: true,
        status: "not run",
        failureMode: codexActivityTemplate.failureMode,
        recordedFields: [...codexActivityTemplate.recordedFields]
      },
      {
        kind: "checkpoint",
        surface: CODEX_SURFACE,
        relativePath: "hooks/hooks.json",
        event: codexCheckpointTemplate.event,
        matcher: codexCheckpointTemplate.nativeMatcher,
        enabled: false,
        automatic: false,
        trustRequired: true,
        status: "not run",
        durableWorkflow: "explicit",
        failureMode: codexCheckpointTemplate.failureMode,
        recordedFields: [...codexCheckpointTemplate.recordedFields]
      },
      emergencyRegistration,
      {
        kind: "instructions",
        relativePath: "AGENTS.md",
        rootEnv: "CODEX_HOME",
        destination: "AGENTS.md",
        consumers: ["codex-cli", "codex-desktop"]
      },
      {
        kind: "skills",
        relativeDirectory: ".agents/skills",
        destination: ".agents/skills",
        consumers: ["codex-cli", "codex-desktop"]
      },
      {
        kind: "plugin-skills",
        relativeDirectory: "skills",
        destination: "skills",
        consumers: ["codex-cli", "codex-desktop"]
      },
      {
        kind: "agents",
        relativeDirectory: ".codex/agents",
        destination: ".codex/agents",
        consumers: ["codex-cli", "codex-desktop"],
        format: "toml"
      },
      {
        kind: "agents",
        relativeDirectory: ".codex/agents",
        rootEnv: "CODEX_HOME",
        destination: "agents",
        format: "toml"
      },
      {
        kind: "config",
        relativePath: "config.toml",
        rootEnv: "CODEX_HOME",
        destination: "config.toml",
        consumers: ["codex-cli", "codex-desktop"]
      },
      ...(semanticProfile.modelPolicies[CODEX_SURFACE] === "surface-default" ? [] : [{
        kind: "profile",
        name: "terra-max",
        relativePath: "terra-max.config.toml",
        rootEnv: "CODEX_HOME",
        destination: "terra-max.config.toml",
        consumers: ["codex-cli"]
      }, {
        kind: "manual-step",
        surface: "codex-desktop",
        id: "terra-max-model",
        instruction: "Select gpt-5.6-terra and max reasoning in the Desktop model controls."
      }]),
      {
        kind: "resolved-config-root",
        rootEnv: "CODEX_HOME",
        path: configRoot
      }
    ],
    diagnostics: [
      ...(targetRuntime === "desktop" ? [{
        code: "codex-desktop-emergency-guard-probe-required",
        severity: "warning",
        message: "Codex Desktop emergency guard output is manual/probe-only because executable package-root resolution is not verified separately from Codex CLI.",
        sourcePath: "adapters/codex/templates/hooks/emergency-guard.json"
      }] : []),
      ...nativeScopeDiagnostics(core.roles),
      ...missingSkills.map(({ skill, hasRecord }) => ({
      code: "missing-skill-source",
      severity: "error",
      message: `Canonical skill '${skill}' ${hasRecord ? "has no usable source content" : "has no source record"}; owner: cycle-05-skill-remediation (T017-T043). Package is deferred until the source is supplied.`,
      sourcePath: "core/inventory.json"
      }))
    ],
    ownership: makeOwnership(files)
  };
  const validation = validateRenderResult(result);
  if (!validation.valid) throw new Error(`Codex adapter produced an invalid RenderResult: ${JSON.stringify(validation.errors)}`);
  return result;
}

/** Apply the shared adapter seam and its required canonical action mappings. */
export function renderSurface(input = {}) {
  const capabilityRecord = {
    surface: CODEX_SURFACE,
    requiredMappings: Object.keys(CODEX_ACTION_MAPPINGS),
    actionMappings: CODEX_ACTION_MAPPINGS,
    render: () => renderCodex(input)
  };
  return validateSurface({
    ...input,
    surface: CODEX_SURFACE,
    capabilityRecord: { ...capabilityRecord, ...input.capabilityRecord }
  });
}

export const render = renderCodex;
export const CODEX_CAPABILITY_RECORD = Object.freeze({
  surface: CODEX_SURFACE,
  requiredMappings: Object.freeze(Object.keys(CODEX_ACTION_MAPPINGS)),
  actionMappings: CODEX_ACTION_MAPPINGS,
  semanticMappings: CODEX_SEMANTIC_MAPPINGS
});
export { CODEX_ACTION_MAPPINGS, CODEX_SEMANTIC_MAPPINGS };
