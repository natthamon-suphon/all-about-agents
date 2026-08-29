import { createHash } from "node:crypto";
import agyBootstrapTemplate from "./templates/hooks/bootstrap.json" with { type: "json" };
import agyEmergencyTemplate from "./templates/hooks/emergency-guard.json" with { type: "json" };

import { renderJson, renderText } from "../shared/render-utils.mjs";
import { renderSurface as validateSurface, validateRenderResult } from "../shared/adapter-contract.mjs";
import { assertNativeRoleRecords, assertNativeRoleSemantics, hasNarrowerNativeScope, nativeCapabilityDiagnostics, nativeScopeDiagnostics, roleCapabilities, SEMANTIC_CAPABILITIES, isRoleReadOnly } from "../../core/roles/contract.mjs";
import { classifyEmergencyAction } from "../../installers/lib/emergency-policy.mjs";

const SURFACE = "agy";
const PLUGIN_ROOT = "";
const PLUGIN_NAME = "all-about-agents";
export const AGY_DOCUMENTED_SETTINGS_DESTINATION = "~/.gemini/antigravity-cli/settings.json";

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

/** The only model and effort pair this adapter may render. */
export const AGY_MODEL_POLICY = Object.freeze({
  model: "gemini-3.7-flash-high",
  effort: "high"
});

/**
 * The agent frontmatter field names are documented, but the current research
 * does not publish a stable CLI tool vocabulary. Empty tool lists are safer
 * than guessing names that can hang an agent; operators can inspect `agy
 * agents` before adding a version-specific tool list.
 */
export const AGY_DOCUMENTED_AGENT_FIELDS = Object.freeze([
  "name",
  "description",
  "tools",
  "mainAgent",
  "subagent",
  "model",
  "commandExecutionPolicy",
  "mcpServers",
  "skills",
  "plugins"
]);

export const AGY_DOCUMENTED_AGENT_TOOLS = Object.freeze([]);

/** Semantic capability names remain portable; no undocumented CLI tool is guessed. */
export const AGY_SEMANTIC_MAPPINGS = Object.freeze(Object.fromEntries([
  ...SEMANTIC_CAPABILITIES
].map((capability) => [capability, Object.freeze([])])));

/** No canonical action has a documented native agy action mapping. */
export const AGY_ACTION_MAPPINGS = Object.freeze(Object.fromEntries(ACTION_IDS.map((actionId) => [
  actionId,
  Object.freeze({
    supported: false,
    support: "manual-unknown",
    status: "unknown",
    source: "research-agy-2.md",
    reason: "No documented agy native action mapping is published for this canonical action.",
    manualStep: `Use a manually authored agy prompt or operation for ${actionId} only after verifying the installed CLI; no native action mapping is claimed.`
  })
])));

const EMERGENCY_DENIES = Object.freeze([
  "command(rm -rf)",
  "command(sudo)",
  "write_file(.git/)",
  "write_file(/home/user/.ssh)"
]);

const AGY_PROFILE_SETTINGS = Object.freeze({
  portable: Object.freeze({
    toolPermission: "request-review",
    artifactReviewPolicy: "asks-for-review",
    allowNonWorkspaceAccess: false,
    enableTerminalSandbox: true
  }),
  template: Object.freeze({
    toolPermission: "always-proceed",
    artifactReviewPolicy: "always-proceed",
    allowNonWorkspaceAccess: true,
    enableTerminalSandbox: false
  })
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
    capabilities: ["repository-read", "repository-write", "isolated-write", "command-execution", "test-execution"]
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

const FORBIDDEN_AGY_CONTENT = Object.freeze([
  Object.freeze({
    code: "desktop-path",
    label: "Desktop-only Antigravity path",
    pattern: /(?:^|[\\/~])\.gemini[\\/]antigravity(?:[\\/]|$)/iu
  }),
  Object.freeze({
    code: "unsupported-flag",
    label: "undocumented reasoning or dry-run flag",
    pattern: /--(?:thinking|reasoning-effort|dry-run)\b/iu
  }),
  Object.freeze({
    code: "permission-mode-bypass",
    label: "execution mode used as a permission bypass",
    pattern: /--mode\s*=\s*accept-edits/iu
  }),
  Object.freeze({
    code: "guessed-model-key",
    label: "guessed persistent model key",
    pattern: /\b(?:modelKey|model_key|reasoningEffort|modelReasoningEffort|persistentModel)\b/iu
  })
]);

function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function profileId(profile) {
  const id = typeof profile === "string" ? profile : profile?.id;
  if (!Object.hasOwn(AGY_PROFILE_SETTINGS, id)) throw new TypeError("profile.id must be portable or template");
  return id;
}

function ensureText(value) {
  return renderText(typeof value === "string" ? value : String(value ?? ""));
}

function stripFrontmatter(value) {
  const text = ensureText(value);
  if (!text.startsWith("---\n")) return text;
  const delimiter = text.indexOf("\n---\n", 4);
  return delimiter < 0 ? text : ensureText(text.slice(delimiter + 5));
}

function canonicalSkillIds(core) {
  const fromInventory = Array.isArray(core?.inventory?.skills) ? core.inventory.skills : [];
  const fromRecords = Array.isArray(core?.skills) ? core.skills.map((record) => record?.id ?? record?.name) : [];
  return [...new Set([...fromInventory, ...fromRecords].filter((id) => typeof id === "string" && id.length > 0))].sort(compareCodePoints);
}

function coreShape(core) {
  if (!core || typeof core !== "object" || Array.isArray(core)) throw new TypeError("core is required");
  for (const collection of ["rules", "roles", "skills", "workflows", "commands", "evals"]) {
    if (!Array.isArray(core[collection])) throw new TypeError(`core.${collection} must be an array`);
  }
  if (!core.inventory || typeof core.inventory !== "object" || !Array.isArray(core.inventory.skills)) {
    throw new TypeError("core.inventory.skills must be an array");
  }
}

function addFile(files, relativePath, content, mode = null) {
  files.push({
    relativePath: PLUGIN_ROOT ? `${PLUGIN_ROOT}/${relativePath}` : relativePath,
    content: new TextEncoder().encode(ensureText(content)),
    mode
  });
}

function ownership(files) {
  return files.map((file) => ({
    relativePath: file.relativePath,
    sha256: createHash("sha256").update(file.content).digest("hex")
  })).sort((left, right) => compareCodePoints(left.relativePath, right.relativePath));
}

function renderPluginManifest() {
  return renderJson({
    $schema: "https://antigravity.google/schemas/v1/plugin.json",
    name: PLUGIN_NAME,
    description: "Portable all-about-agents skills, rules, agents, and inert hooks for the agy CLI."
  });
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
  const description = typeof role?.description === "string" && role.description.trim()
    ? role.description.trim()
    : role?.purpose || fallback.description;
  const capabilities = [...new Set([
    ...(Array.isArray(role?.capabilities) ? role.capabilities : []),
    ...(Array.isArray(role?.requiredCapabilities) ? role.requiredCapabilities : []),
    ...(Array.isArray(role?.allowedCapabilities) ? role.allowedCapabilities : []),
    ...(!role ? fallback.capabilities : [])
  ])].sort(compareCodePoints);
  const readOnly = isRoleReadOnly(role || fallback);
  const commandExecutionPolicy = readOnly ? "off" : "sandbox";
  const roleDiagnostics = nativeCapabilityDiagnostics({ surface: SURFACE, role: role || fallback, unavailableCapabilities: roleCapabilities(role || fallback) });
  const prompt = `${role?.prompt || [
    `Operate as the ${name} role. Preserve scope, verify evidence, and report uncertainty.`,
    capabilities.length > 0 ? `Semantic capabilities: ${capabilities.join(", ")}.` : "",
    "The current public agy documentation does not publish a stable tool-name vocabulary; inspect the installed CLI before adding any tool names.",
    readOnly ? "This role is read-only: do not mutate files or execute commands." : "Apply only scoped changes and use the documented per-run approval controls."
  ].filter(Boolean).join("\n\n")}${roleDiagnostics.length > 0 ? `\n\nNative capability diagnostics:\n${roleDiagnostics.map((entry) => `- ${entry.message}`).join("\n")}` : ""}${hasNarrowerNativeScope(role) ? "\n\nNative controls are workspace-wide; the declared task paths remain an outer approval boundary." : ""}`;
  return ensureText([
    "---",
    `name: ${JSON.stringify(name)}`,
    `description: ${JSON.stringify(description)}`,
    "tools: []",
    "mainAgent: true",
    "subagent: true",
    "model: inherit",
    `commandExecutionPolicy: ${commandExecutionPolicy}`,
    "mcpServers: []",
    "skills: []",
    "plugins: []",
    "---",
    "",
    prompt
  ].join("\n"));
}

function renderSettingsOverlay(profile) {
  return renderJson({
    ...AGY_PROFILE_SETTINGS[profile],
    permissions: { deny: [...EMERGENCY_DENIES] }
  });
}

function renderCapabilityGuidance() {
  return ensureText([
    "# agy CLI capability guidance",
    "",
    "This package is a portable agy CLI plugin. Its package root contains plugin.json, hooks.json, skills/, agents/, and rules/.",
    "The documented plugin install operation receives the package directory; this adapter never writes an installed profile.",
    "The current research records conflicting CLI and shared customization roots. Treat the active root for the installed version as unknown until manual discovery.",
    "The agent frontmatter field names are documented, but the published research does not provide a complete stable tool-name list. Empty tool arrays avoid guessing a name that could hang an agent.",
    "Read-only capability diagnostics identify every semantic capability with no documented native mapping; record it as unavailable or not run and do not guess a tool.",
    "Native controls are workspace-wide where available; the implementer's declared task paths remain an outer approval boundary.",
    "Run agy agents after discovery and add only tool names accepted by that installed version through an explicit operator change.",
    "",
    "PostToolUse contract: a documented tool event identifies the tool as toolCall.name; do not substitute a Desktop or legacy event field.",
    `Bootstrap hooks remain disabled: ${agyBootstrapTemplate.probeRequired ? "the installed agy version requires the explicit probe below before any lifecycle schema can be considered." : "no automatic handler is rendered."}`,
    ""
  ].join("\n"));
}

function renderModelRule() {
  return ensureText([
    "# agy model selection",
    "",
    "The requested CLI selection is exact: `gemini-3.7-flash-high` with `high` effort.",
    "Discover entitlement first with `agy models`; an unavailable model must fail and report the available choices.",
    "Retry only with an exact slug listed by that command, or omit the model option to use the configured default. No silent model substitution is allowed.",
    "The documented per-run operation is represented by this shell-neutral argument vector; `PROMPT_TEXT` is one string argument supplied by the caller:",
    "",
    "    [",
    "      \"agy\",",
    "      \"-p\",",
    "      \"PROMPT_TEXT\",",
    "      \"--model\",",
    "      \"gemini-3.7-flash-high\",",
    "      \"--effort\",",
    "      \"high\"",
    "    ]",
    "Callers must pass each item as process argv (for example, spawn), never parse a shell command string. These values mirror the model-selection registration and manifest model policy.",
    "",
    ""
  ].join("\n"));
}

function renderPermissionRule() {
  return ensureText([
    "# agy permission and emergency controls",
    "",
    "The portable overlay uses documented `toolPermission: request-review`; the template overlay uses documented `toolPermission: always-proceed` and `artifactReviewPolicy: always-proceed`.",
    "The template's broad approval is still a manual overlay and does not remove emergency denies.",
    "The documented all-tools per-run operation is `--dangerously-skip-permissions`; it must be added manually for one explicitly reviewed run.",
    "Execution mode is separate from permission policy; do not treat a mode selection as an approval bypass.",
    "Deny has precedence over Ask and Allow. Keep these explicit emergency denies:",
    "",
    ...EMERGENCY_DENIES.map((entry) => `- \`${entry}\``),
    "",
    "No command handler is installed or executed by this package."
  ].join("\n"));
}

function renderHooksRule() {
  return ensureText([
    "# agy hook contract",
    "",
    "The generated hooks.json is disabled and contains no executable hook command. It is an inert contract artifact, not an installed handler.",
    "The lifecycle payload parity required for automatic bootstrap is unverified for this CLI. Complete the explicit version/runtime probe before proposing a handler.",
    ...agyBootstrapTemplate.probe.manualSequence.map((step, index) => `${index + 1}. ${step}`),
    "Any later handler must be reviewed and enabled by the operator in a disposable target. No hook command is auto-installed or executed here.",
    ""
  ].join("\n"));
}

function renderSettingsRule() {
  return ensureText([
    "# agy settings overlay",
    "",
    "settings.overlay.json contains only the sparse keys documented by the current CLI settings and permission references.",
    `The only documented CLI destination candidate is \`${AGY_DOCUMENTED_SETTINGS_DESTINATION}\`. Shared configuration roots and the active merge behavior remain version-sensitive because the public sources conflict.`,
    "Review the overlay manually after discovery; this adapter does not stage, merge, replace, or write a persistent settings file.",
    ""
  ].join("\n"));
}

function renderPackageReadme() {
  return ensureText([
    "# all-about-agents agy plugin",
    "",
    "This is a portable package artifact. Rendering does not install a plugin, write a profile, enable hooks, or execute a command.",
    "",
    "## Manual discovery and registration",
    "",
    "Review this directory in a disposable explicit target, then run these documented operations manually:",
    "",
    "1. `agy --help`",
    "2. `agy models`",
    "3. `agy agents`",
    "4. `agy plugin list`",
    "5. On a disposable explicit package directory only: `agy plugin install PACKAGE_DIRECTORY`",
    "",
    "After model discovery, use the exact requested selection only if the installed CLI lists it:",
    "",
    "The authoritative headless operation is the argument vector in the model registration and manifest model policy. Its shell-neutral form is:",
    "",
    "    [",
    "      \"agy\",",
    "      \"-p\",",
    "      \"PROMPT_TEXT\",",
    "      \"--model\",",
    "      \"gemini-3.7-flash-high\",",
    "      \"--effort\",",
    "      \"high\"",
    "    ]",
    "Pass `PROMPT_TEXT` as one process argument. Callers must use process argv (for example, spawn), never shell parsing; no generic cross-platform shell command string is emitted.",
    "",
    "If the requested slug is unavailable, stop, inspect `agy models`, and retry only with an exact operator-selected slug or with the model option omitted. Never substitute a model automatically.",
    "",
    "For one explicitly approved full-access run, append `--dangerously-skip-permissions` manually. Emergency denies remain higher priority, and no execution mode is a permission bypass.",
    "",
    `The settings overlay is intentionally sparse and manual. The only documented CLI destination candidate is \`${AGY_DOCUMENTED_SETTINGS_DESTINATION}\`; shared configuration paths, runtime version, active layout, entitlement, agent tool vocabulary, and native acceptance remain unknown until the operator performs discovery.`,
    ""
  ].join("\n"));
}

function hookDocument() {
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

/** Normalize only the documented agy PreToolUse fields. */
export function normalizeAgyEmergencyRequest(request) {
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

export function mapAgyEmergencyDecision(classification) {
  return classification?.decision === "deny" ? { decision: "deny", reason: classification.reason } : {};
}

export function classifyAgyEmergencyRequest(request) {
  const normalized = normalizeAgyEmergencyRequest(request);
  return normalized ? classifyEmergencyAction(normalized) : { decision: "allow", ruleId: null, reason: "Allowed: no emergency rule matched." };
}

function validateAgyContent(files) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const file of files) {
    let body;
    try {
      body = decoder.decode(file.content);
    } catch {
      throw new TypeError(`agy render rejected non-UTF-8 body in ${file.relativePath}`);
    }
    for (const forbidden of FORBIDDEN_AGY_CONTENT) {
      if (forbidden.pattern.test(body)) {
        throw new TypeError(`agy render rejected ${forbidden.label} in ${file.relativePath}`);
      }
    }
  }
}

/** Return a hard diagnostic when an operator's model list does not contain the requested slug. */
export function diagnoseModelSelection({ requested = AGY_MODEL_POLICY.model, availableModels = null } = {}) {
  if (!Array.isArray(availableModels)) {
    return {
      status: "not run",
      command: "agy models",
      message: "Run agy models before selecting a model; no silent model substitution is permitted."
    };
  }
  if (!availableModels.includes(requested)) {
    return {
      status: "error",
      command: "agy models",
      message: `Model "${requested}" was not accepted by this agy binary/account. Run agy models and retry with an exact listed slug (or omit --model to use the configured default). No silent model substitution.`
    };
  }
  return { status: "ready", model: requested, effort: AGY_MODEL_POLICY.effort };
}

/**
 * Build the authoritative cross-platform agy argv vector.
 *
 * Each item is one process argument; no shell quoting or shell-specific
 * command string is emitted. Operators invoking a shell must pass these items
 * through that shell's native argv mechanism.
 */
export function buildHeadlessArgs({ prompt = "<prompt>", model = AGY_MODEL_POLICY.model, effort = AGY_MODEL_POLICY.effort, dangerouslySkipPermissions = false } = {}) {
  if (typeof prompt !== "string" || prompt.length === 0) throw new TypeError("prompt must be a non-empty string");
  if (model !== AGY_MODEL_POLICY.model || effort !== AGY_MODEL_POLICY.effort) {
    const diagnostic = diagnoseModelSelection({ requested: model });
    throw new TypeError(diagnostic.message);
  }
  return Object.freeze([
    "agy",
    "-p",
    prompt,
    "--model",
    AGY_MODEL_POLICY.model,
    "--effort",
    AGY_MODEL_POLICY.effort,
    ...(dangerouslySkipPermissions ? ["--dangerously-skip-permissions"] : [])
  ]);
}

function nativeAcceptance(platform) {
  return {
    status: "not run",
    product: "agy CLI",
    productVersion: "unknown",
    executablePath: "unknown",
    platform,
    reason: "Native acceptance was not run for this repository render; no native executable was invoked.",
    manualSequence: ["agy --help", "agy models", "agy agents", "agy plugin list"],
    disposablePackageInstall: "agy plugin install PACKAGE_DIRECTORY",
    manualOnly: true
  };
}

function actionDiagnostics() {
  return ACTION_IDS.map((actionId) => ({
    code: "agy-action-unknown",
    severity: "warning",
    message: `${actionId} has no documented agy native mapping; use a manual operation only after verifying the installed CLI.`,
    sourcePath: "research-agy-2.md"
  }));
}

/** Render the complete portable agy CLI plugin package and manual overlays. */
export function renderAgy(input = {}) {
  coreShape(input.core);
  assertNativeRoleRecords(input.core.roles);
  assertNativeRoleSemantics(input.core.roles);
  const profile = profileId(input.profile ?? "portable");
  if (typeof input.statuslineName !== "string") throw new TypeError("statuslineName must be a string");
  const skillRecords = new Map(input.core.skills.map((record) => [record.id || record.name, record]));
  const roleRecords = new Map(input.core.roles.map((record) => [record.id || record.name, record]));
  const files = [];

  addFile(files, "plugin.json", renderPluginManifest());
  addFile(files, "README.md", renderPackageReadme());
  addFile(files, "hooks.json", renderJson(hookDocument()));
  addFile(files, "emergency-guard.json", renderJson(agyEmergencyTemplate));
  addFile(files, "settings.overlay.json", renderSettingsOverlay(profile));
  addFile(files, "rules/adapter-capability-guidance.md", renderCapabilityGuidance());
  addFile(files, "rules/model-selection.md", renderModelRule());
  addFile(files, "rules/permission-safety.md", renderPermissionRule());
  addFile(files, "rules/hook-contract.md", renderHooksRule());
  addFile(files, "rules/settings-overlay.md", renderSettingsRule());

  for (const rule of [...input.core.rules].sort((left, right) => String(left.id).localeCompare(String(right.id)))) {
    addFile(files, `rules/${rule.id}.md`, renderRule(rule));
  }
  for (const skill of canonicalSkillIds(input.core)) {
    addFile(files, `skills/${skill}/SKILL.md`, renderSkill(skill, skillRecords.get(skill)));
  }
  const roleNames = [...(roleRecords.size > 0 ? roleRecords.keys() : Object.keys(DEFAULT_ROLES))].sort(compareCodePoints);
  for (const roleName of roleNames) addFile(files, `agents/${roleName}/agent.md`, renderAgent(roleName, roleRecords.get(roleName)));

  files.sort((left, right) => compareCodePoints(left.relativePath, right.relativePath));
  validateAgyContent(files);

  const diagnostics = [
    {
      code: "agy-native-not-run",
      severity: "warning",
      message: "Native acceptance was not run for this repository render and must be performed manually; no native executable was invoked.",
      sourcePath: "research-agy-2.md"
    },
    {
      code: "agy-runtime-unknown",
      severity: "warning",
      message: "The agy runtime version, executable path, entitlement, and active package/settings roots are unknown; discover them manually before applying artifacts.",
      sourcePath: "research-agy-2.md"
    },
    {
      code: "agy-bootstrap-probe-required",
      severity: "warning",
      message: `${agyBootstrapTemplate.probe.reason} Status: ${agyBootstrapTemplate.probe.status}. Manual sequence: ${agyBootstrapTemplate.probe.manualSequence.join(" ")}`,
      sourcePath: "research-t013-antigravity-agy-hooks.md"
    },
    {
      code: "agy-emergency-guard-probe-required",
      severity: "warning",
      message: "agy emergency guard output is documented but executable package-root resolution remains unverified; automatic hook execution is disabled.",
      sourcePath: "research-t014-pretool-hooks.md"
    },
    {
      code: "agy-layout-conflict",
      severity: "warning",
      message: "Official sources conflict on CLI versus shared plugin, skill, hook, and settings roots; this result emits diagnostics and no persistent destination write.",
      sourcePath: "research-agy-2.md"
    },
    {
      code: "agy-agent-tools-unknown",
      severity: "warning",
      message: "The documented agent field list does not publish a complete stable agy tool vocabulary; generated agent tools remain empty pending agy agents discovery.",
      sourcePath: "research-agy-2.md"
    },
    ...input.core.roles.flatMap((role) => nativeCapabilityDiagnostics({ surface: SURFACE, role, unavailableCapabilities: roleCapabilities(role) })),
    ...nativeScopeDiagnostics(input.core.roles),
    ...actionDiagnostics(),
    ...canonicalSkillIds(input.core).filter((skill) => !skillRecords.has(skill)).map((skill) => ({
      code: "missing-skill-source",
      severity: "error",
      message: `Canonical skill '${skill}' has no source record; owner: cycle-05-skill-remediation (T017-T043). Package is deferred until the source is supplied.`,
      sourcePath: "core/inventory.json"
    }))
  ];

  const platform = typeof input.platform === "string" && input.platform.trim() ? input.platform : process.platform;
  const result = {
    files,
    registrations: [
      {
        kind: "plugin-registration",
        surface: SURFACE,
        relativePath: "plugin.json",
        command: "agy plugin install PACKAGE_DIRECTORY",
        manualOnly: true,
        disposableOnly: true,
        automaticInstall: false
      },
      {
        kind: "plugin-discovery",
        surface: SURFACE,
        command: "agy plugin list",
        manualOnly: true
      },
      {
        kind: "agent-discovery",
        surface: SURFACE,
        command: "agy agents",
        manualOnly: true
      },
      {
        kind: "model-discovery",
        surface: SURFACE,
        command: "agy models",
        manualOnly: true
      },
      {
        kind: "model-selection",
        surface: SURFACE,
        model: AGY_MODEL_POLICY.model,
        effort: AGY_MODEL_POLICY.effort,
        args: buildHeadlessArgs(),
        manualOnly: true,
        fallback: "Run agy models and retry with an exact listed slug or omit --model; no silent model substitution."
      },
      {
        kind: "full-access-per-run",
        surface: SURFACE,
        args: buildHeadlessArgs({ dangerouslySkipPermissions: true }),
        permission: "toolPermission: always-proceed",
        manualOnly: true,
        emergencyDeny: [...EMERGENCY_DENIES]
      },
      {
        kind: "settings-overlay",
        surface: SURFACE,
        relativePath: "settings.overlay.json",
        profile,
        manualOnly: true,
        automaticWrite: false,
        status: "manual-discovery-required",
        reason: "Shared settings roots, complete schema, and active merge behavior remain unknown or version-sensitive; only the documented CLI candidate is emitted.",
        destinationCandidates: [AGY_DOCUMENTED_SETTINGS_DESTINATION]
      },
      {
        kind: "hook-contract",
        surface: SURFACE,
        relativePath: "hooks.json",
        enabled: false,
        manualOnly: true,
        automaticHookExecution: false,
        probeRequired: agyBootstrapTemplate.probeRequired,
        probe: {
          status: "not run",
          manualSequence: [...agyBootstrapTemplate.probe.manualSequence]
        }
      },
      {
        kind: "emergency-guard",
        surface: SURFACE,
        relativePath: "emergency-guard.json",
        enabled: false,
        automatic: false,
        automaticHookExecution: false,
        probeRequired: agyEmergencyTemplate.probeRequired,
        status: agyEmergencyTemplate.probe.status
      },
      {
        kind: "runtime-prerequisite",
        executable: agyBootstrapTemplate.runtime.executable,
        check: [agyBootstrapTemplate.runtime.executable, "--version"],
        minimumVersion: agyBootstrapTemplate.runtime.minimumVersion,
        onMissing: agyBootstrapTemplate.runtime.missingRuntime,
        requiredBy: ["manual-bootstrap-probe"],
        platforms: ["win32", "darwin", "linux"]
      },
      {
        kind: "native-acceptance",
        surface: SURFACE,
        ...nativeAcceptance(platform)
      }
    ],
    diagnostics,
    ownership: ownership(files)
  };
  const validation = validateRenderResult(result);
  if (!validation.valid) throw new Error(`agy adapter produced an invalid RenderResult: ${JSON.stringify(validation.errors)}`);
  return result;
}

/** Apply the shared adapter seam; unknown native action mappings fail explicitly. */
export function renderSurface(input = {}) {
  const capabilityRecord = {
    surface: SURFACE,
    requiredMappings: ACTION_IDS,
    actionMappings: AGY_ACTION_MAPPINGS,
    render: () => renderAgy(input)
  };
  return validateSurface({
    ...input,
    surface: SURFACE,
    capabilityRecord: { ...capabilityRecord, ...(input.capabilityRecord || {}) }
  });
}

export const render = renderAgy;
export const AGY_CAPABILITY_RECORD = Object.freeze({
  surface: SURFACE,
  requiredMappings: ACTION_IDS,
  actionMappings: AGY_ACTION_MAPPINGS,
  semanticMappings: AGY_SEMANTIC_MAPPINGS
});

export { AGY_PROFILE_SETTINGS };
