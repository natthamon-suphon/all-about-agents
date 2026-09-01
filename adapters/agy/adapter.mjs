import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import agyBootstrapTemplate from "./templates/hooks/bootstrap.json" with { type: "json" };
import agyEmergencyTemplate from "./templates/hooks/emergency-guard.json" with { type: "json" };
import agyActivityTemplate from "./templates/hooks/activity-audit.json" with { type: "json" };
import agyCheckpointTemplate from "./templates/hooks/checkpoint.json" with { type: "json" };

import { renderJson, renderText } from "../shared/render-utils.mjs";
import { renderSurface as validateSurface, validateRenderResult } from "../shared/adapter-contract.mjs";
import { assertNativeRoleRecords, assertNativeRoleSemantics, hasNarrowerNativeScope, nativeCapabilityDiagnostics, nativeScopeDiagnostics, isRoleReadOnly } from "../../core/roles/contract.mjs";
import { classifyEmergencyAction, REASONS } from "../../installers/lib/emergency-policy.mjs";
import { assertUnifiedSkillPortfolio, skillCompanionsFor } from "../../installers/lib/load-core.mjs";
import { profileTranslation, resolveProfile } from "../../profiles/profile-contract.mjs";
import { createNativeIntegrationRecord } from "../shared/native-state.mjs";
import { renderGeminiGlobalInstructions } from "../shared/global-instructions.mjs";
import { displayLabel, renderInvocationGuidance, renderPresentationCatalog } from "../../installers/lib/presentation-contract.mjs";

const SURFACE = "agy";
const PLUGIN_ROOT = "";
const PLUGIN_NAME = "all-about-agents";
export const AGY_DOCUMENTED_SETTINGS_DESTINATION = "~/.gemini/antigravity-cli/settings.json";
export const AGY_INSTALLED_PLUGIN_RELATIVE_ROOT = "plugins/all-about-agents";
const MAX_STATUSLINE_NAME_CODE_POINTS = 64;
const STATUSLINE_WINDOWS_SOURCE_TEXT = readFileSync(new URL("./templates/statusline/statusline.ps1", import.meta.url), "utf8");
const STATUSLINE_POSIX_SOURCE_TEXT = readFileSync(new URL("./templates/statusline/statusline.sh", import.meta.url), "utf8");
const STATUSLINE_SOURCE_TEXT = readFileSync(new URL("./templates/statusline/statusline.mjs", import.meta.url), "utf8");

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

/** Shared Antigravity subagent and hook docs publish these exact tool names. */
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

export const AGY_DOCUMENTED_AGENT_TOOLS = Object.freeze([
  "view_file", "write_to_file", "replace_file_content", "multi_replace_file_content",
  "list_dir", "find_by_name", "grep_search", "search_web", "read_url_content",
  "run_command", "invoke_subagent", "define_subagent", "send_message",
  "manage_subagents", "ask_permission", "list_permissions"
]);

/** Semantic-to-native mappings use only the documented Antigravity tools. */
export const AGY_SEMANTIC_MAPPINGS = Object.freeze({
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

/** No canonical action has a documented native agy action mapping. */
export const AGY_ACTION_MAPPINGS = Object.freeze(Object.fromEntries(ACTION_IDS.map((actionId) => [
  actionId,
  Object.freeze({
    supported: false,
    support: "manual-unknown",
    status: "unknown",
    source: "docs/evaluations/antigravity-contracts-2026-08-31.md",
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
  controlled: Object.freeze({
    toolPermission: "request-review",
    artifactReviewPolicy: "asks-for-review",
    allowNonWorkspaceAccess: false,
    enableTerminalSandbox: true
  }),
  full: Object.freeze({
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

function ensureText(value) {
  return renderText(typeof value === "string" ? value : String(value ?? ""));
}

function normalizeWindowsPath(value) {
  const slashed = value.replaceAll("\\", "/");
  if (slashed.startsWith("//")) return `//${slashed.slice(2).replace(/\/{2,}/gu, "/")}`;
  return slashed.replace(/\/{2,}/gu, "/");
}

function validateAgyConfigRoot(value, platform) {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError("agy statusline config root must be a non-empty path");
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(value)) throw new TypeError("agy statusline config root contains control characters");
  const root = value.trim();
  if (platform !== "win32") {
    if (!root.startsWith("/")) throw new TypeError("agy statusline command requires an absolute config root");
    return root.replace(/\/$/u, "") || "/";
  }
  if (/[\x22<>|?*]/u.test(root)) throw new TypeError("agy statusline config root contains forbidden Windows path characters");
  const rawWindows = value.replaceAll("\\", "/");
  if (/[. ](?:\/|$)/u.test(rawWindows)) throw new TypeError("agy statusline config root contains an unrepresentable trailing dot or space");
  const slashedInput = root.replaceAll("\\", "/");
  const unc = slashedInput.startsWith("//");
  const drive = /^[A-Za-z]:\//u.test(slashedInput);
  if (!drive && !unc) throw new TypeError("agy statusline command requires an absolute Windows config root");
  const body = unc ? slashedInput.slice(2) : slashedInput.slice(3);
  if (/\/{2,}/u.test(body)) throw new TypeError("agy statusline config root contains an empty path segment");
  const withoutTrailingSlash = body.replace(/\/$/u, "");
  const segments = withoutTrailingSlash.length > 0 ? withoutTrailingSlash.split("/") : [];
  if (unc && segments.length < 2) throw new TypeError("agy statusline config root requires a UNC server and share");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === ".." || segment.includes(":") || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu.test(segment))) {
    throw new TypeError("agy statusline config root contains an invalid path segment");
  }
  if (drive && segments.length === 0) return `${slashedInput.slice(0, 2)}/`;
  const normalized = normalizeWindowsPath(slashedInput).replace(/\/$/u, "");
  return normalized || `${slashedInput[0]}:/`;
}

function quotePosix(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function quotePowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function isAbsoluteWindowsPath(value) {
  return /^(?:[A-Za-z]:\/|\/\/)/u.test(value);
}

/** Resolve the documented agy CLI settings directory without touching it. */
export function resolveAgyConfigDir({ homeDir = homedir(), platform = process.platform } = {}) {
  if (!["win32", "darwin", "linux"].includes(platform)) throw new TypeError(`agy statusline does not support platform ${String(platform)}`);
  if (typeof homeDir !== "string" || homeDir.trim().length === 0) throw new TypeError("agy statusline home directory is unsafe");
  const root = validateAgyConfigRoot(homeDir, platform);
  const prefix = root === "/" ? "" : root.endsWith("/") ? root : `${root}/`;
  return `${prefix}.gemini/antigravity-cli`;
}

/** Render a shell-safe command for the launcher under the selected agy root. */
export function renderAgyStatuslineCommand({ configRoot, homeDir = homedir(), platform = process.platform } = {}) {
  if (!["win32", "darwin", "linux"].includes(platform)) throw new TypeError(`agy statusline does not support platform ${String(platform)}`);
  const root = validateAgyConfigRoot(configRoot ?? resolveAgyConfigDir({ homeDir, platform }), platform);
  const rootPrefix = root === "/" ? "" : root.replace(/\/$/u, "");
  const scriptPath = `${rootPrefix}/${AGY_INSTALLED_PLUGIN_RELATIVE_ROOT}/statusline/${platform === "win32" ? "statusline.ps1" : "statusline.sh"}`;
  if (platform === "win32") {
    if (!isAbsoluteWindowsPath(scriptPath)) throw new TypeError("agy statusline command requires an absolute Windows config root");
    const encoded = Buffer.from(`$ProgressPreference = 'SilentlyContinue'\n& ${quotePowerShell(scriptPath)}\nexit $LASTEXITCODE\n`, "utf16le").toString("base64");
    return `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ${encoded}`;
  }
  return quotePosix(scriptPath);
}

function validateStatuslineName(value) {
  if (typeof value !== "string") throw new TypeError("statuslineName must be a string");
  if (/[\u0000-\u001f\u007f]/u.test(value) || value.includes("\u001b") || value.includes("\u009b")) {
    throw new TypeError("statuslineName contains a control or ANSI escape sequence");
  }
  const normalized = value.trim();
  if ([...normalized].length > MAX_STATUSLINE_NAME_CODE_POINTS) throw new RangeError("statuslineName exceeds 64 Unicode code points");
  return normalized;
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

function addFile(files, relativePath, content, mode = null, contentKind = "generated") {
  const body = contentKind === "companion" ? content : ensureText(content);
  if (typeof body !== "string") throw new TypeError("rendered file content must be a string");
  files.push({
    relativePath: PLUGIN_ROOT ? `${PLUGIN_ROOT}/${relativePath}` : relativePath,
    content: new TextEncoder().encode(body),
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

function renderSkill(name, record, presentation) {
  const description = typeof record?.description === "string" && record.description.trim()
    ? record.description.trim()
    : `Canonical ${name} skill.`;
  const body = typeof record?.content === "string" && record.content.trim()
    ? stripFrontmatter(record.content)
    : "DEFERRED: canonical source is missing.\nOwner: cycle-05-skill-remediation (T017-T043).\n";
  const guidance = renderInvocationGuidance(presentation, {
    kind: "skill",
    id: name,
    task: `Apply ${displayLabel(presentation, "skill", name)} to the current task`,
    reason: `Use ${displayLabel(presentation, "skill", name)} when its scope matches the current task.`
  });
  return ensureText(`---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n${guidance}\n\n${body}`);
}

function renderRule(rule) {
  const lines = [`# ${rule.title || rule.id}`, "", rule.description || rule.purpose || "Canonical portable rule.", ""];
  if (Array.isArray(rule.requirements) && rule.requirements.length > 0) lines.push("## Requirements", "", ...rule.requirements.map((item) => `- ${item}`), "");
  if (Array.isArray(rule.invariants) && rule.invariants.length > 0) lines.push("## Invariants", "", ...rule.invariants.map((item) => `- ${item}`), "");
  return ensureText(lines.join("\n"));
}

function renderAgent(name, role, presentation) {
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
  let tools = [...new Set(capabilities.flatMap((capability) => AGY_SEMANTIC_MAPPINGS[capability] || []))];
  if (tools.length === 0 && !role) tools = [...AGY_SEMANTIC_MAPPINGS["repository-read"]];
  const blockedNativeTools = [
    "write_to_file", "replace_file_content", "multi_replace_file_content", "run_command",
    "invoke_subagent", "define_subagent", "manage_subagents"
  ];
  if (readOnly) tools = tools.filter((tool) => !blockedNativeTools.includes(tool));
  tools = tools.filter((tool) => AGY_DOCUMENTED_AGENT_TOOLS.includes(tool)).sort(compareCodePoints);
  const commandExecutionPolicy = tools.includes("run_command") ? "sandbox" : "off";
  const roleDiagnostics = nativeCapabilityDiagnostics({ surface: SURFACE, role: role || fallback, mappings: AGY_SEMANTIC_MAPPINGS, blockedNativeTools });
  const guidance = renderInvocationGuidance(presentation, {
    kind: "role",
    id: name,
    task: `Delegate the current task to ${displayLabel(presentation, "role", name)}`,
    reason: `Use ${displayLabel(presentation, "role", name)} when its role matches the task and scope.`
  });
  const prompt = `${guidance}\n\n${role?.prompt || [
    `Operate as the ${name} role. Preserve scope, verify evidence, and report uncertainty.`,
    capabilities.length > 0 ? `Semantic capabilities: ${capabilities.join(", ")}.` : "",
    "Use only the documented Antigravity tool names declared in this agent frontmatter.",
    readOnly ? "This role is read-only: do not mutate files or execute commands." : "Apply only scoped changes and use the documented per-run approval controls."
  ].filter(Boolean).join("\n\n")}${roleDiagnostics.length > 0 ? `\n\nNative capability diagnostics:\n${roleDiagnostics.map((entry) => `- ${entry.message}`).join("\n")}` : ""}${hasNarrowerNativeScope(role) ? "\n\nNative controls are workspace-wide; the declared task paths remain an outer approval boundary." : ""}`;
  return ensureText([
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
    prompt
  ].join("\n"));
}

/** Render only the documented sparse agy settings overlay. */
export function renderSettingsOverlay(authority, { statuslineCommand } = {}) {
  if (!Object.hasOwn(AGY_PROFILE_SETTINGS, authority)) throw new TypeError(`unknown agy authority: ${String(authority)}`);
  if (typeof statuslineCommand !== "string" || statuslineCommand.trim().length === 0) throw new TypeError("agy statusline command must be a non-empty string");
  return {
    ...AGY_PROFILE_SETTINGS[authority],
    statusLine: {
      type: "command",
      command: statuslineCommand,
      enabled: true,
      padding: 0,
      stack_with_default: false
    },
    permissions: { deny: [...EMERGENCY_DENIES] }
  };
}

function renderCapabilityGuidance() {
  return ensureText([
    "# agy CLI capability guidance",
    "",
    "This package is a portable agy CLI plugin. Its package root contains plugin.json, hooks.json, skills/, agents/, and rules/.",
    "The documented plugin install operation receives the package directory; this adapter never writes an installed profile.",
    "The documented installed plugin root is `~/.gemini/antigravity-cli/plugins/<plugin_name>/`; this renderer creates only a portable package.",
    "The shared Antigravity subagent and hook documentation publishes the agent fields and tool names used by this adapter.",
    "Read-only roles remove command, mutation, and agent-management tools while keeping useful read and research tools.",
    "Native controls are workspace-wide where available; the implementer's declared task paths remain an outer approval boundary.",
    "Dynamic subagent names stay unchanged; use `default 🤖` only as the display fallback.",
    "Run `agy agents` after discovery and record any version-specific difference without inventing a replacement tool.",
    "",
    "PostToolUse contract: a documented tool event identifies the tool as toolCall.name; do not substitute a Desktop or legacy event field.",
    `Bootstrap hooks remain disabled: ${agyBootstrapTemplate.probeRequired ? "events and JSON input/output are documented, but handler path resolution and hook-process failure behavior still require the explicit probe below." : "no automatic handler is rendered."}`,
    ""
  ].join("\n"));
}

function renderModelRule(profile) {
  if (profile.modelPolicies[SURFACE] === "surface-default") {
    return ensureText([
      "# agy model selection",
      "",
      "The portable profile keeps the current agy model and effort selection unchanged.",
      "Use `agy models` for manual discovery; no preferred slug or effort is emitted.",
      ""
    ].join("\n"));
  }
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
    "The lifecycle events and JSON input/output are documented for this CLI. Hook process failure behavior and handler path resolution are not documented.",
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
    `The documented CLI settings destination is \`${AGY_DOCUMENTED_SETTINGS_DESTINATION}\`.`,
    "Rendering does not write the persistent settings file. Review the dry-run; an authorized register --apply merges the sparse overlay without deleting unknown keys.",
    ""
  ].join("\n"));
}

function renderPackageReadme(profile) {
  if (profile.modelPolicies[SURFACE] === "surface-default") {
    return ensureText([
      "# all-about-agents agy plugin",
      "",
      "This is a portable package artifact. Rendering does not install a plugin, write a profile, enable hooks, or execute a command.",
      "The package root contains GEMINI.md, the shared global instruction file. An authorized register --apply may copy it to ~/.gemini/GEMINI.md; rendering alone remains read-only.",
      "rules/presentation.md contains the compact name-and-emoji catalog. Every visible skill and agent prompt includes a reason and small checklist while native identifiers stay unchanged.",
      "The portable profile keeps the installed agy model and effort unchanged.",
      "Review this directory in a disposable explicit target, then run `agy --help`, `agy models`, and `agy agents` manually.",
      "After a reviewed dry-run and exact authority, repository `register --apply` runs `agy plugin install PACKAGE_DIRECTORY`, checks `agy plugin list`, and merges the sparse settings overlay. Rendering alone remains read-only.",
      `The settings overlay names only the documented CLI candidate ${AGY_DOCUMENTED_SETTINGS_DESTINATION}. Reload and runtime observation remain manual.`,
      ""
    ].join("\n"));
  }
  return ensureText([
    "# all-about-agents agy plugin",
    "",
    "This is a portable package artifact. Rendering does not install a plugin, write a profile, enable hooks, or execute a command.",
    "The package root contains GEMINI.md, the shared global instruction file. An authorized register --apply may copy it to ~/.gemini/GEMINI.md; rendering alone remains read-only.",
    "rules/presentation.md contains the compact name-and-emoji catalog. Every visible skill and agent prompt includes a reason and small checklist while native identifiers stay unchanged.",
    "",
    "## Registration and manual verification",
    "",
    "Review this directory in a disposable explicit target. Run discovery manually; after a reviewed dry-run and exact authority, repository `register --apply` performs plugin installation, plugin-list discovery, and the sparse settings merge:",
    "",
    "1. `agy --help`",
    "2. `agy models`",
    "3. `agy agents`",
    "4. `agy plugin list` runs during `register --apply` and may be repeated manually after reload",
    "5. `agy plugin install PACKAGE_DIRECTORY` runs during `register --apply`; use it directly only for a selected disposable package",
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
    `The settings overlay is intentionally sparse. The documented CLI destination is \`${AGY_DOCUMENTED_SETTINGS_DESTINATION}\`; authorized \`register --apply\` merges it, while runtime version, entitlement, reload, and native acceptance still need operator verification on each machine.`,
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
  const reason = classification?.decision === "deny" && Object.hasOwn(REASONS, classification.ruleId) ? REASONS[classification.ruleId] : "";
  return reason ? { decision: "deny", reason } : {};
}

export function classifyAgyEmergencyRequest(request) {
  const normalized = normalizeAgyEmergencyRequest(request);
  return normalized ? classifyEmergencyAction(normalized) : { decision: "allow", ruleId: null, reason: "Allowed: no emergency rule matched." };
}

function validateAgyContent(files, opaqueCompanionPaths = new Set()) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const file of files) {
    let body;
    try {
      body = decoder.decode(file.content);
    } catch {
      throw new TypeError(`agy render rejected non-UTF-8 body in ${file.relativePath}`);
    }
    if (opaqueCompanionPaths.has(file.relativePath)) continue;
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

function nativeAcceptance() {
  return {
    status: "partial",
    product: "agy CLI",
    productVersion: "1.1.22",
    executablePath: "%LOCALAPPDATA%/agy/bin/agy.exe",
    platform: "win32",
    checkedAt: "2026-08-31",
    reason: "Native Windows evidence is recorded per check; installation, runtime skill discovery, hooks, settings merge, and persistence remain not run.",
    checks: [
      { id: "version", status: "pass", evidence: "agy --version returned 1.1.22." },
      { id: "model-discovery", status: "pass", evidence: "agy models listed gemini-3.7-flash-high." },
      { id: "effort-help", status: "pass", evidence: "agy --help documented --effort high." },
      { id: "headless-model", status: "pass", evidence: "Headless Flash High with high effort and dangerously-skip-permissions completed successfully." },
      { id: "plugin-validation", status: "pass", evidence: "agy plugin validate accepted both rendered packages and reported 28 skills, 7 agents, and 1 hook." },
      { id: "statusline-renderer", status: "pass", evidence: "Disposable Windows agy statusline command accepted official sample-shaped JSON and emitted one sanitized line from an unrelated cwd." },
      { id: "agent-selection", status: "pass", evidence: "agy accepted --agent architect in the disposable workspace." },
      { id: "agent-list", status: "inconclusive", evidence: "agy agents exited successfully but printed no agent rows." },
      { id: "plugin-install", status: "not run", evidence: "No live plugin installation was performed." },
      { id: "skill-runtime-discovery", status: "not run", evidence: "Validator enumeration does not prove runtime skill invocation." },
      { id: "hook-execution", status: "not run", evidence: "The package hook contract remains disabled and inert." },
      { id: "settings-merge", status: "not run", evidence: "No live settings file was written or merged." },
      { id: "model-persistence", status: "not run", evidence: "Cross-session persistence was not exercised." }
    ],
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
    sourcePath: "docs/evaluations/antigravity-contracts-2026-08-31.md"
  }));
}

/** Render the complete portable agy CLI plugin package and manual overlays. */
export function renderAgy(input = {}) {
  assertUnifiedSkillPortfolio(input);
  coreShape(input.core);
  assertNativeRoleRecords(input.core.roles);
  assertNativeRoleSemantics(input.core.roles);
  const semanticProfile = resolveProfile(input.profile ?? "portable", {
    surface: SURFACE,
    modelPolicyRefs: ["surface-default", "approved-cli-flash"]
  });
  const profile = semanticProfile.id;
  const modelSelected = semanticProfile.modelPolicies[SURFACE] !== "surface-default";
  const statuslineName = validateStatuslineName(input.statuslineName ?? "");
  const platform = typeof input.platform === "string" && input.platform.trim() ? input.platform : process.platform;
  const configRoot = validateAgyConfigRoot(input.configRoot ?? resolveAgyConfigDir({ homeDir: input.homeDir, platform }), platform);
  const statuslineCommand = renderAgyStatuslineCommand({ configRoot, platform });
  const skillRecords = new Map(input.core.skills.map((record) => [record.id || record.name, record]));
  const roleRecords = new Map(input.core.roles.map((record) => [record.id || record.name, record]));
  const files = [];

  addFile(files, "GEMINI.md", renderGeminiGlobalInstructions(input.core));
  addFile(files, "plugin.json", renderPluginManifest());
  addFile(files, "README.md", renderPackageReadme(semanticProfile));
  addFile(files, "hooks.json", renderJson(hookDocument()));
  addFile(files, "activity-audit.json", renderJson(agyActivityTemplate));
  addFile(files, "checkpoint.json", renderJson(agyCheckpointTemplate));
  addFile(files, "emergency-guard.json", renderJson(agyEmergencyTemplate));
  addFile(files, "settings.overlay.json", renderJson(renderSettingsOverlay(semanticProfile.authority, { statuslineCommand })));
  addFile(files, "statusline/statusline.json", renderJson({ schemaVersion: 1, displayName: statuslineName }));
  addFile(files, "statusline/statusline.mjs", STATUSLINE_SOURCE_TEXT, 0o755);
  addFile(files, "statusline/statusline.ps1", STATUSLINE_WINDOWS_SOURCE_TEXT);
  addFile(files, "statusline/statusline.sh", STATUSLINE_POSIX_SOURCE_TEXT, 0o755);
  addFile(files, "rules/adapter-capability-guidance.md", renderCapabilityGuidance());
  addFile(files, "rules/model-selection.md", renderModelRule(semanticProfile));
  addFile(files, "rules/permission-safety.md", renderPermissionRule());
  addFile(files, "rules/hook-contract.md", renderHooksRule());
  addFile(files, "rules/settings-overlay.md", renderSettingsRule());
  addFile(files, "rules/presentation.md", renderPresentationCatalog(input.core.presentation));

  for (const rule of [...input.core.rules].sort((left, right) => String(left.id).localeCompare(String(right.id)))) {
    addFile(files, `rules/${rule.id}.md`, renderRule(rule));
  }
  const opaqueCompanionPaths = new Set();
  for (const skill of canonicalSkillIds(input.core)) {
    addFile(files, `skills/${skill}/SKILL.md`, renderSkill(skill, skillRecords.get(skill), input.core.presentation));
    for (const companion of skillCompanionsFor(skillRecords.get(skill))) {
      const path = `skills/${skill}/${companion.relativePath}`;
      addFile(files, path, companion.content, companion.mode, "companion");
      opaqueCompanionPaths.add(path);
    }
  }
  const roleNames = [...(roleRecords.size > 0 ? roleRecords.keys() : Object.keys(DEFAULT_ROLES))].sort(compareCodePoints);
  for (const roleName of roleNames) addFile(files, `agents/${roleName}/agent.md`, renderAgent(roleName, roleRecords.get(roleName), input.core.presentation));

  files.sort((left, right) => compareCodePoints(left.relativePath, right.relativePath));
  validateAgyContent(files, opaqueCompanionPaths);

  const diagnostics = [
    {
      code: "agy-native-partial",
      severity: "warning",
      message: "Native agy 1.1.22 model, headless, agent-selection, and package-validation checks passed on Windows; untested native behavior remains not run.",
      sourcePath: "tests/integration/manual-desktop-checklist.json"
    },
    {
      code: "agy-runtime-partial",
      severity: "warning",
      message: "The agy runtime version and executable path are known, but entitlement and live merge behavior remain unverified; inspect the active machine before applying artifacts.",
      sourcePath: "tests/integration/manual-desktop-checklist.json"
    },
    {
      code: "agy-bootstrap-probe-required",
      severity: "warning",
      message: `${agyBootstrapTemplate.probe.reason} Status: ${agyBootstrapTemplate.probe.status}. Manual sequence: ${agyBootstrapTemplate.probe.manualSequence.join(" ")}`,
      sourcePath: "docs/evaluations/antigravity-contracts-2026-08-31.md"
    },
    {
      code: "agy-emergency-guard-probe-required",
      severity: "warning",
      message: "agy emergency guard output is documented but executable package-root resolution remains unverified; automatic hook execution is disabled.",
      sourcePath: "docs/evaluations/antigravity-contracts-2026-08-31.md"
    },
    {
      code: "agy-hook-failure-contract-unverified",
      severity: "warning",
      message: "Antigravity documents agy hook events and JSON input/output, but not hook-process failure behavior or portable package-root command resolution; executable hooks remain disabled.",
      sourcePath: "docs/evaluations/antigravity-contracts-2026-08-31.md"
    },
    ...input.core.roles.flatMap((role) => nativeCapabilityDiagnostics({
      surface: SURFACE,
      role,
      mappings: AGY_SEMANTIC_MAPPINGS,
      blockedNativeTools: ["write_to_file", "replace_file_content", "multi_replace_file_content", "run_command", "invoke_subagent", "define_subagent", "manage_subagents"]
    })),
    ...nativeScopeDiagnostics(input.core.roles),
    ...actionDiagnostics(),
    ...canonicalSkillIds(input.core).filter((skill) => !skillRecords.has(skill)).map((skill) => ({
      code: "missing-skill-source",
      severity: "error",
      message: `Canonical skill '${skill}' has no source record; owner: cycle-05-skill-remediation (T017-T043). Package is deferred until the source is supplied.`,
      sourcePath: "core/inventory.json"
    }))
  ];

  const nativeStatusline = createNativeIntegrationRecord({
    surface: SURFACE,
    feature: "statusline",
    phases: {
      rendered: { status: "pass", evidence: "agy statusline renderer, config, and platform launchers were rendered." },
      validated: { status: "pass", evidence: "agy statusline settings, renderer, and launchers pass adapter validation." },
      registered: { status: "not-run", evidence: "Native registration requires merging the sparse statusLine overlay into the documented agy settings file." },
      trusted: { status: "not-run-unavailable", evidence: "The agy statusline command has no native trust concept." },
      active: { status: "not-run", evidence: "An agy CLI session has not been opened to observe the statusline." },
      runtimeVerified: { status: "not-run", evidence: "A native agy statusline runtime check has not been run." }
    },
    sourcePath: "adapters/agy/adapter.mjs",
    manualSteps: [
      "After a reviewed dry-run and exact authority, run repository register --apply to install the package and merge the sparse statusLine overlay.",
      "Confirm plugin discovery with agy plugin list.",
      "Open a fresh agy CLI session to observe the statusline."
    ]
  });
  const nativeEmergency = createNativeIntegrationRecord({
    surface: SURFACE,
    feature: "emergency-protection",
    phases: {
      rendered: {
        status: "pass",
        evidence: semanticProfile.authority === "full"
          ? "Rendered the agy always-proceed settings overlay and canonical emergency deny policy; the optional per-run skip operation is recorded separately."
          : "Rendered the agy request-review settings overlay and canonical emergency deny policy."
      },
      validated: {
        status: "not-run",
        evidence: "agy has no verified native emergency-policy validator; only the rendered settings deny overlay is recorded."
      },
      registered: {
        status: "not-run",
        evidence: "The agy settings deny overlay requires an authorized register --apply or an explicit manual merge; native plugin registration was not run during rendering."
      },
      trusted: {
        status: "not-run",
        evidence: "The native agy emergency hook is disabled; hook trust was not established."
      },
      active: {
        status: "not-run",
        evidence: "No fresh agy session was opened to observe emergency protection."
      },
      runtimeVerified: {
        status: "not-run",
        evidence: "agy emergency deny output was not executed in a native runtime probe."
      }
    },
    sourcePath: "adapters/agy/adapter.mjs",
    manualSteps: [
      `For the ${semanticProfile.authority === "full" ? "always-proceed" : "request-review"} settings overlay, use a reviewed and authorized register --apply or explicitly merge the deny rules before any native run.`,
      semanticProfile.authority === "full"
        ? "Retain command(rm -rf), command(sudo), write_file(.git/), and write_file(/home/user/.ssh); the optional per-run skip operation does not remove them."
        : "Retain command(rm -rf), command(sudo), write_file(.git/), and write_file(/home/user/.ssh).",
      "Keep the native emergency hook disabled until a disposable agy deny-output probe verifies hook execution and command resolution."
    ]
  });
  const result = {
    files,
    registrations: [
      profileTranslation(semanticProfile, SURFACE),
      nativeStatusline,
      nativeEmergency,
      {
        kind: "plugin-registration",
        surface: SURFACE,
        relativePath: "plugin.json",
        command: "agy plugin install PACKAGE_DIRECTORY",
        stagedDestination: "~/.gemini/antigravity-cli/plugins/all-about-agents/",
        manualOnly: false,
        disposableOnly: true,
        automaticInstall: true,
        automaticFromRender: false,
        status: "register-apply-after-review",
        reason: "Rendering is read-only. After dry-run review and exact authorization, register --apply runs agy plugin install for the supplied package root."
      },
      {
        kind: "plugin-discovery",
        surface: SURFACE,
        command: "agy plugin list",
        manualOnly: false,
        automaticAfterAuthority: true,
        status: "register-apply-after-review"
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
      ...(modelSelected ? [{
        kind: "model-selection",
        surface: SURFACE,
        model: AGY_MODEL_POLICY.model,
        effort: AGY_MODEL_POLICY.effort,
        args: buildHeadlessArgs(),
        manualOnly: true,
        fallback: "Run agy models and retry with an exact listed slug or omit --model; no silent model substitution."
      }, {
        kind: "full-access-per-run",
        surface: SURFACE,
        args: buildHeadlessArgs({ dangerouslySkipPermissions: true }),
        permission: "toolPermission: always-proceed",
        manualOnly: true,
        emergencyDeny: [...EMERGENCY_DENIES]
      }] : []),
      {
        kind: "settings-overlay",
        surface: SURFACE,
        relativePath: "settings.overlay.json",
        profile,
        manualOnly: false,
        automaticWrite: true,
        status: "apply-after-review",
        reason: "Rendering is read-only. After dry-run review and exact authorization, register --apply merges the sparse overlay into the documented settings file and preserves unknown keys.",
        destinationCandidates: [AGY_DOCUMENTED_SETTINGS_DESTINATION]
      },
      {
        kind: "statusline-config",
        surface: SURFACE,
        relativePath: "statusline/statusline.json",
        destination: "statusline/statusline.json",
        configRoot,
        command: statuslineCommand
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
        kind: "activity-audit",
        surface: SURFACE,
        relativePath: "activity-audit.json",
        event: agyActivityTemplate.event,
        optional: true,
        automatic: false,
        probeRequired: true,
        status: agyActivityTemplate.probe.status,
        failureMode: agyActivityTemplate.failureMode,
        recordedFields: [...agyActivityTemplate.recordedFields]
      },
      {
        kind: "checkpoint",
        surface: SURFACE,
        relativePath: "checkpoint.json",
        automatic: false,
        nativeHookEquivalent: false,
        durableWorkflow: agyCheckpointTemplate.durableWorkflow,
        failureMode: agyCheckpointTemplate.failureMode,
        recordedFields: [...agyCheckpointTemplate.recordedFields]
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
        ...nativeAcceptance()
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
    allowExplicitUnsupported: true,
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
  allowExplicitUnsupported: true,
  actionMappings: AGY_ACTION_MAPPINGS,
  semanticMappings: AGY_SEMANTIC_MAPPINGS
});

export { AGY_PROFILE_SETTINGS };
