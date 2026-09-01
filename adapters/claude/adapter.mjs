import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix } from "node:path";

import claudeBootstrapTemplate from "./templates/hooks/bootstrap.json" with { type: "json" };
import claudeEmergencyTemplate from "./templates/hooks/emergency-guard.json" with { type: "json" };
import claudeActivityTemplate from "./templates/hooks/activity-audit.json" with { type: "json" };
import claudeCheckpointTemplate from "./templates/hooks/checkpoint.json" with { type: "json" };

import { renderJson } from "../shared/render-utils.mjs";
import {
  renderSurface as validateSurface,
  validateRenderResult
} from "../shared/adapter-contract.mjs";
import { assertNativeRoleRecords, assertNativeRoleSemantics, hasNarrowerNativeScope, nativeCapabilityDiagnostics, nativeScopeDiagnostics, isRoleReadOnly } from "../../core/roles/contract.mjs";
import { assertUnifiedSkillPortfolio, skillCompanionsFor } from "../../installers/lib/load-core.mjs";
import { profileTranslation, resolveProfile } from "../../profiles/profile-contract.mjs";
import { createNativeIntegrationRecord } from "../shared/native-state.mjs";
import { renderClaudeGlobalInstructions } from "../shared/global-instructions.mjs";
import { displayLabel, renderInvocationGuidance, renderPresentationCatalog } from "../../installers/lib/presentation-contract.mjs";

const CLAUDE_SURFACE = "claude";
const MAX_STATUSLINE_NAME_CODE_POINTS = 64;
const CONTROL_OR_ANSI = /[\u0000-\u001f\u007f]|\u001b\[[0-?]*[ -/]*[@-~]/u;
const compareCodePoints = (left, right) => left === right ? 0 : left < right ? -1 : 1;
const BOOTSTRAP_SOURCE = readFileSync(new URL("../../core/hooks/bootstrap.mjs", import.meta.url), "utf8");
const BOOTSTRAP_CONFIG_SOURCE = readFileSync(new URL("../../core/hooks/bootstrap.json", import.meta.url), "utf8");
const EMERGENCY_GUARD_SOURCE = readFileSync(new URL("../../core/hooks/emergency-guard.mjs", import.meta.url), "utf8");
const EMERGENCY_CONFIG_SOURCE = readFileSync(new URL("../../core/hooks/emergency-guard.json", import.meta.url), "utf8");
const EMERGENCY_POLICY_SOURCE = readFileSync(new URL("../../installers/lib/emergency-policy.mjs", import.meta.url), "utf8");
const AUDIT_LOG_SOURCE = readFileSync(new URL("../../installers/lib/audit-log.mjs", import.meta.url), "utf8");
const STATUSLINE_SOURCE_TEXT = readFileSync(new URL("./templates/statusline/statusline.mjs", import.meta.url), "utf8");
const STATUSLINE_TRACK_TOOL_SOURCE_TEXT = readFileSync(new URL("./templates/statusline/track-tool.mjs", import.meta.url), "utf8");
const STATUSLINE_WINDOWS_SOURCE_TEXT = readFileSync(new URL("./templates/statusline/statusline.ps1", import.meta.url), "utf8");
const STATUSLINE_POSIX_SOURCE_TEXT = readFileSync(new URL("./templates/statusline/statusline.sh", import.meta.url), "utf8");

/** Static installer preflight for the Node.js entrypoint used by every hook. */
export const CLAUDE_PREREQUISITES = Object.freeze({
  executable: "node",
  check: Object.freeze(["node", "--version"]),
  minimumVersion: claudeBootstrapTemplate.runtime.minimumVersion,
  onMissing: "reject",
  requiredBy: Object.freeze(["hooks/*.mjs", "statusline/statusline.mjs"])
});

/** The statusline's optional PostToolUse tracker shares the same Node runtime. */
export const CLAUDE_STATUSLINE_PREREQUISITES = Object.freeze({
  executable: "node",
  check: Object.freeze(["node", "--version"]),
  minimumVersion: claudeBootstrapTemplate.runtime.minimumVersion,
  onMissing: "reject",
  requiredBy: Object.freeze(["statusline/statusline.mjs", "statusline/track-tool.mjs"])
});

const READ_ONLY_NATIVE_TOOLS = Object.freeze(["Agent", "Bash", "Edit", "Write"]);

/**
 * The names at this boundary are intentionally Claude-native. The core only
 * supplies semantic capability identifiers; this table is the adapter's
 * documented translation into Claude Code tools.
 */
export const CLAUDE_SEMANTIC_MAPPINGS = Object.freeze({
  "repository-read": Object.freeze(["Read", "Glob", "Grep"]),
  "repository-write": Object.freeze(["Write", "Edit"]),
  "web-primary-sources": Object.freeze(["WebSearch", "WebFetch"]),
  "isolated-write": Object.freeze(["Write", "Edit", "Bash"]),
  "command-execution": Object.freeze(["Bash"]),
  "filesystem-read": Object.freeze(["Read", "Glob", "Grep"]),
  "filesystem-write": Object.freeze(["Write", "Edit"]),
  "git-read": Object.freeze(["Bash"]),
  "git-write": Object.freeze(["Bash"]),
  "test-execution": Object.freeze(["Bash"]),
  "external-research": Object.freeze(["WebSearch", "WebFetch"]),
  evaluation: Object.freeze(["Bash", "Read"]),
  "role-dispatch": Object.freeze(["Agent"]),
  "workflow-state": Object.freeze(["Read", "Write"]),
  "schema-validation": Object.freeze(["Bash"]),
  "native-rendering": Object.freeze(["Skill"])
});

export const CLAUDE_ACTION_MAPPINGS = Object.freeze({
  "aaa:design": Object.freeze({ supported: true, native: "commands/design.md" }),
  "aaa:build": Object.freeze({ supported: true, native: "commands/build.md" }),
  "aaa:fix": Object.freeze({ supported: true, native: "commands/fix.md" }),
  "aaa:review": Object.freeze({ supported: true, native: "commands/review.md" }),
  "aaa:audit": Object.freeze({ supported: true, native: "commands/audit.md" }),
  "aaa:improve-skill": Object.freeze({ supported: true, native: "commands/improve-skill.md" }),
  "aaa:resume": Object.freeze({ supported: true, native: "commands/resume.md" }),
  "aaa:verify": Object.freeze({ supported: true, native: "commands/verify.md" })
});

/** Exact settings policy approved for Claude Code and Claude Desktop local Code. */
export const CLAUDE_MODEL_POLICY = Object.freeze({
  portable: Object.freeze({}),
  template: Object.freeze({
    model: "claude-opus-5",
    fallbackModel: Object.freeze(["claude-sonnet-5"]),
    advisorModel: "claude-fable-5",
    env: Object.freeze({ CLAUDE_CODE_EFFORT_LEVEL: "max" })
  })
});

const EMERGENCY_DENIES = Object.freeze([
  "Bash(rm -rf /)",
  "Bash(rm -rf ~)",
  "Bash(git push --force*)",
  "Bash(git reset --hard*)"
]);

const DEFAULT_ROLES = Object.freeze({
  researcher: Object.freeze({
    description: "Find and cite primary sources without mutating the repository.",
    capabilities: ["external-research", "web-primary-sources", "repository-read"],
    tools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch"]
  }),
  investigator: Object.freeze({
    description: "Reproduce an internal problem and rank evidence-backed hypotheses.",
    capabilities: ["repository-read", "filesystem-read", "test-execution"],
    tools: ["Read", "Glob", "Grep"],
    readOnly: true
  }),
  architect: Object.freeze({
    description: "Design modules, interfaces, seams, invariants, and risks.",
    capabilities: ["repository-read", "schema-validation", "evaluation"],
    tools: ["Read", "Glob", "Grep"]
  }),
  implementer: Object.freeze({
    description: "Make scoped test-first changes and report fresh evidence.",
    capabilities: ["repository-read", "repository-write", "isolated-write", "test-execution"],
    tools: ["Read", "Glob", "Grep", "Write", "Edit", "Bash", "Agent"]
  }),
  verifier: Object.freeze({
    description: "Run fresh black-box checks without changing implementation files.",
    capabilities: ["repository-read", "test-execution", "evaluation"],
    tools: ["Read", "Glob", "Grep"],
    readOnly: true
  }),
  reviewer: Object.freeze({
    description: "Review specifications, diffs, tests, and maintainability evidence.",
    capabilities: ["repository-read", "evaluation", "schema-validation"],
    tools: ["Read", "Glob", "Grep"],
    readOnly: true
  }),
  "security-reviewer": Object.freeze({
    description: "Check threat paths, secrets, containment, and emergency guardrails.",
    capabilities: ["repository-read", "evaluation", "schema-validation"],
    tools: ["Read", "Glob", "Grep"],
    readOnly: true
  })
});

const HOOK_SOURCES = Object.freeze({
  "activity-audit.mjs": `#!/usr/bin/env node
import { appendAuditEvent } from "./audit-log.mjs";
import { readBoundedStdin } from "./bootstrap.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const rawInput = await readBoundedStdin();
if (rawInput === null) process.exit(0);
try {
  const payload = JSON.parse(rawInput || "{}");
  await appendAuditEvent(join(dirname(fileURLToPath(import.meta.url)), "audit"), {
    surface: "claude",
    actionId: payload.actionId ?? payload.tool_name,
    outcome: payload.outcome ?? "success",
    sessionKey: payload.sessionKey ?? payload.session_id ?? payload.tool_use_id
  });
} catch { /* optional audit is fail-open */ }
`,
  "pre-compact.mjs": `#!/usr/bin/env node
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
    workflowId: safe(payload.workflowId, "claude-hook"),
    taskId: safe(payload.taskId, "pre-compact"),
    state: safe(payload.state, "compacting"),
    status: safe(payload.status, "checkpointed")
  };
  const root = join(dirname(fileURLToPath(import.meta.url)), "checkpoints");
  await mkdir(root, { recursive: true });
  await appendFile(join(root, "checkpoint.jsonl"), JSON.stringify(checkpoint) + "\\n", { encoding: "utf8", flag: "a" });
} catch { /* durable checkpoint is fail-open */ }
`
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureText(value) {
  const text = typeof value === "string" ? value : String(value ?? "");
  return `${text.replace(/\r\n?/gu, "\n").replace(/\n+$/u, "")}\n`;
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

function validStatuslineName(value) {
  if (typeof value !== "string") throw new TypeError("statuslineName must be a string");
  if (CONTROL_OR_ANSI.test(value)) throw new TypeError("statuslineName contains a control or ANSI escape sequence");
  const trimmed = value.trim();
  if ([...trimmed].length > MAX_STATUSLINE_NAME_CODE_POINTS) throw new RangeError("statuslineName exceeds 64 Unicode code points");
  return trimmed;
}

function normalizeWindowsPath(value) {
  const slashed = value.replaceAll("\\", "/");
  if (slashed.startsWith("//")) return "//" + slashed.slice(2).replace(/\/{2,}/gu, "/");
  return slashed.replace(/\/{2,}/gu, "/");
}

function isAbsoluteWindowsPath(value) {
  return /^(?:[A-Za-z]:\/|\/\/)/u.test(value);
}

function quotePosix(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function quotePowerShell(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function validateStatuslineRoot(value, platform) {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError("Claude statusline config root must be a non-empty path");
  const root = value.trim();
  if (/[\u0000-\u001f\u007f]/u.test(root)) throw new TypeError("Claude statusline config root contains control characters");
  if (platform !== "win32") {
    if (!root.startsWith("/")) throw new TypeError("Claude statusline command requires an absolute config root");
    return root;
  }
  if (/[\x22<>|?*]/u.test(root)) throw new TypeError("Claude statusline config root contains forbidden Windows path characters");
  const slashed = root.replaceAll("\\", "/");
  const unc = slashed.startsWith("//");
  const drive = /^[A-Za-z]:\//u.test(slashed);
  if (!drive && !unc) throw new TypeError("Claude statusline command requires an absolute Windows config root");
  const body = unc ? slashed.slice(2) : slashed.slice(3);
  if (/\/{2,}/u.test(body)) throw new TypeError("Claude statusline config root contains an empty path segment");
  const withoutTrailingSlash = body.replace(/\/$/u, "");
  const segments = withoutTrailingSlash.length > 0 ? withoutTrailingSlash.split("/") : [];
  if (unc && segments.length < 2) throw new TypeError("Claude statusline config root requires a UNC server and share");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === ".." || segment.includes(":"))) {
    throw new TypeError("Claude statusline config root contains an invalid path segment");
  }
  const normalized = normalizeWindowsPath(root);
  if (drive && segments.length === 0) return normalized.endsWith("/") ? normalized : normalized + "/";
  if (!isAbsoluteWindowsPath(normalized)) throw new TypeError("Claude statusline command requires an absolute Windows config root");
  return normalized.replace(/\/$/u, "");
}

/** Build the native command string for the launcher installed under the config root. */
export function renderClaudeStatuslineCommand({ configRoot, homeDir = homedir(), platform = process.platform } = {}) {
  if (!["win32", "darwin", "linux"].includes(platform)) throw new TypeError(`Claude statusline does not support platform ${String(platform)}`);
  if (typeof homeDir !== "string" || homeDir.trim().length === 0 || /[\u0000-\u001f\u007f]/u.test(homeDir)) throw new TypeError("Claude statusline home directory is unsafe");
  const windows = platform === "win32";
  const fallbackRoot = resolveClaudeConfigDir({ homeDir, platform });
  const normalizedRoot = validateStatuslineRoot(configRoot ?? fallbackRoot, platform);
  const normalizedHome = windows ? normalizeWindowsPath(homeDir.trim()) : homeDir.trim().replace(/\/$/u, "");
  const defaultRoot = windows ? `${normalizedHome}/.claude` : posix.join(normalizedHome, ".claude");
  const isDefaultRoot = windows
    ? normalizedRoot.toLowerCase() === defaultRoot.toLowerCase()
    : normalizedRoot === defaultRoot;
  const suffix = windows ? "statusline.ps1" : "statusline.sh";
  if (windows) {
    const windowsScriptPath = normalizedRoot + (normalizedRoot.endsWith("/") ? "" : "/") + "statusline/" + suffix;
    const encodedScript = Buffer.from("$ProgressPreference = 'SilentlyContinue'\n& " + quotePowerShell(windowsScriptPath) + "\nexit $LASTEXITCODE\n", "utf16le").toString("base64");
    return "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand " + encodedScript;
  }
  const scriptPath = isDefaultRoot ? `~/.claude/statusline/${suffix}` : `${normalizedRoot}/statusline/${suffix}`;
  return isDefaultRoot ? scriptPath : quotePosix(scriptPath);
}

/** Resolve the documented Claude settings root without reading or writing it. */
export function resolveClaudeConfigDir({ env = process.env, homeDir = homedir(), platform = process.platform } = {}) {
  const configured = env && typeof env.CLAUDE_CONFIG_DIR === "string" ? env.CLAUDE_CONFIG_DIR.trim() : "";
  return configured || (platform === "win32" ? join(homeDir, ".claude") : posix.join(homeDir, ".claude"));
}

function canonicalSkillIds(core) {
  const fromInventory = Array.isArray(core?.inventory?.skills) ? core.inventory.skills : [];
  const fromRecords = Array.isArray(core?.skills) ? core.skills.map((record) => record?.id ?? record?.name) : [];
  return [...new Set([...fromInventory, ...fromRecords].filter((id) => typeof id === "string" && id.length > 0))].sort();
}

function renderSkill(name, record, presentation) {
  const hasSource = Boolean(record && typeof record.content === "string" && record.content.trim().length > 0);
  const description = record?.description || `Canonical ${name} skill.`;
  const sourceBody = hasSource
    ? stripFrontmatter(record.content)
    : "DEFERRED: canonical source is missing.\nOwner: cycle-05-skill-remediation (T017-T043).\n";
  const guidance = renderInvocationGuidance(presentation, {
    kind: "skill",
    id: name,
    task: `Apply ${displayLabel(presentation, "skill", name)} to the current task`,
    reason: `Use ${displayLabel(presentation, "skill", name)} when its scope matches the current task.`
  });
  return {
    content: ensureText(`---\nname: ${name}\ndescription: ${quoteFrontmatter(description)}\n---\n\n${guidance}\n\n${sourceBody}`),
    hasSource
  };
}

function renderRule(rule) {
  const lines = [`# ${rule.title || rule.id}`, "", rule.description || rule.purpose || "Canonical portable rule.", ""];
  if (Array.isArray(rule.requirements) && rule.requirements.length > 0) {
    lines.push("## Requirements", "", ...rule.requirements.map((item) => `- ${item}`), "");
  }
  if (Array.isArray(rule.invariants) && rule.invariants.length > 0) {
    lines.push("## Invariants", "", ...rule.invariants.map((item) => `- ${item}`), "");
  }
  return ensureText(lines.join("\n"));
}

function renderAgent(name, role, presentation) {
  const defaultRole = DEFAULT_ROLES[name];
  const fallback = defaultRole || Object.freeze({ description: "Unknown role; no native capabilities are granted.", capabilities: [], readOnly: true });
  const description = role?.description || role?.purpose || fallback.description;
  const semanticNames = [
    ...(Array.isArray(role?.capabilities) ? role.capabilities : []),
    ...(Array.isArray(role?.requiredCapabilities) ? role.requiredCapabilities : []),
    ...(Array.isArray(role?.allowedCapabilities) ? role.allowedCapabilities : [])
  ];
  const mappedTools = semanticNames.flatMap((capability) => CLAUDE_SEMANTIC_MAPPINGS[capability] || []);
  const tools = [...new Set([...(role ? mappedTools : (mappedTools.length > 0 ? mappedTools : fallback.tools))])].sort();
  const roleContext = [
    role?.purpose,
    Array.isArray(role?.invariants) && role.invariants.length > 0 ? `Invariants: ${role.invariants.join("; ")}` : "",
    Array.isArray(role?.dispatchCriteria) && role.dispatchCriteria.length > 0 ? `Dispatch criteria: ${role.dispatchCriteria.join("; ")}` : ""
  ].filter(Boolean).join("\n\n");
  const capabilityDiagnostics = nativeCapabilityDiagnostics({ surface: CLAUDE_SURFACE, role: role || fallback, mappings: CLAUDE_SEMANTIC_MAPPINGS, blockedNativeTools: READ_ONLY_NATIVE_TOOLS });
  const guidance = renderInvocationGuidance(presentation, {
    kind: "role",
    id: name,
    task: `Delegate the current task to ${displayLabel(presentation, "role", name)}`,
    reason: `Use ${displayLabel(presentation, "role", name)} when its role matches the task and scope.`
  });
  const body = `${guidance}\n\n${role?.prompt || roleContext || `Operate as the ${name} role. Preserve scope, verify evidence, and report uncertainty.\n`}${capabilityDiagnostics.length > 0 ? `\n\nNative capability diagnostic: ${capabilityDiagnostics.map((entry) => entry.message).join(" ")}` : ""}${hasNarrowerNativeScope(role) ? "\n\nNative controls are workspace-wide; the declared task paths remain an outer approval boundary." : ""}`;
  const readOnly = isRoleReadOnly(role || fallback);
  const allowedTools = readOnly ? tools.filter((tool) => !READ_ONLY_NATIVE_TOOLS.includes(tool)) : tools;
  const restriction = readOnly
    ? `disallowedTools:\n${READ_ONLY_NATIVE_TOOLS.map((tool) => `  - ${tool}`).join("\n")}\n`
    : "";
  return ensureText(`---\nname: ${name}\ndescription: ${quoteFrontmatter(description)}\nmodel: inherit\ntools:\n${allowedTools.map((tool) => `  - ${tool}`).join("\n")}\n${restriction}---\n\n${body}`);
}

function renderCommand(command, presentation) {
  const description = command.presentation?.help || `Dispatch ${command.actionId}.`;
  const guidance = renderInvocationGuidance(presentation, {
    kind: "command",
    id: command.actionId,
    workflowId: command.workflowId,
    task: `Run ${displayLabel(presentation, "command", command.actionId)} for the requested workflow`,
    reason: `Run ${displayLabel(presentation, "command", command.actionId)} for the requested workflow.`
  });
  const workflowLabel = displayLabel(presentation, "workflow", command.workflowId);
  return ensureText(`---\ndescription: ${quoteFrontmatter(description)}\n---\n\nDispatch canonical action \`${command.actionId}\` through workflow \`${workflowLabel}\`.\n\n${guidance}\n`);
}

function hookConfig() {
  const command = (fileName) => ({
    type: "command",
    command: "node",
    args: [`${"${CLAUDE_PLUGIN_ROOT}"}/hooks/${fileName}`],
    timeout: 10
  });
  const bootstrapCommand = {
    type: "command",
    command: "node",
    args: [
      `${"${CLAUDE_PLUGIN_ROOT}"}/hooks/${claudeBootstrapTemplate.module}.mjs`,
      "--surface",
      claudeBootstrapTemplate.surface,
      "--skill-path",
      `${"${CLAUDE_PLUGIN_ROOT}"}/${claudeBootstrapTemplate.contentRef.replace(/^core\//u, "")}`,
      "--config-path",
      `${"${CLAUDE_PLUGIN_ROOT}"}/hooks/bootstrap.json`
    ],
    timeout: 10
  };
  const emergencyCommand = {
    type: "command",
    command: "node",
    args: [
      `${"${CLAUDE_PLUGIN_ROOT}"}/hooks/emergency-guard.mjs`,
      "--surface",
      "claude",
      "--policy-path",
      `${"${CLAUDE_PLUGIN_ROOT}"}/hooks/emergency-guard.json`
    ],
    timeout: 10
  };
  const statuslineTrackerCommand = {
    type: "command",
    command: "node",
    args: [`${"${CLAUDE_PLUGIN_ROOT}"}/statusline/track-tool.mjs`],
    timeout: 10
  };
  return { hooks: {
    [claudeBootstrapTemplate.event]: [{ matcher: claudeBootstrapTemplate.nativeMatcher, hooks: [bootstrapCommand] }],
    PreToolUse: [{ matcher: claudeEmergencyTemplate.nativeMatcher, hooks: [emergencyCommand] }],
    [claudeActivityTemplate.event]: [{ matcher: claudeActivityTemplate.nativeMatcher, hooks: [command("activity-audit.mjs"), statuslineTrackerCommand] }],
    [claudeCheckpointTemplate.event]: [{ matcher: claudeCheckpointTemplate.nativeMatcher, hooks: [command("pre-compact.mjs")] }]
  } };
}

function nativeEmergencyRecord(profile) {
  return createNativeIntegrationRecord({
    surface: CLAUDE_SURFACE,
    feature: "emergency-protection",
    phases: {
      rendered: {
        status: "pass",
        evidence: "Rendered the Claude emergency PreToolUse guard and canonical deny policy."
      },
      validated: {
        status: "not-run",
        evidence: "Claude strict plugin validation was not run by this render; validation must not imply emergency hook execution."
      },
      registered: {
        status: "not-run",
        evidence: "Claude plugin registration was not run during rendering."
      },
      trusted: {
        status: "not-run-unavailable",
        evidence: "This Claude emergency hook feature has no native trust concept."
      },
      active: {
        status: "not-run",
        evidence: "No fresh Claude Code session was opened to observe the emergency hook state."
      },
      runtimeVerified: {
        status: "not-run",
        evidence: "Claude emergency hook execution was not run in a native session."
      }
    },
    sourcePath: "adapters/claude/adapter.mjs",
    manualSteps: [
      "Run claude plugin validate PACKAGE_ROOT --strict to advance package validation; this does not verify emergency hook execution.",
      "Register the plugin and open a fresh Claude Code session before checking hook behavior.",
      `Keep the ${profile.authority === "full" ? "bypassPermissions" : "default"} profile's canonical Bash emergency deny rules in settings.json.`
    ]
  });
}

export function settingsFor(profile, { statuslineCommand } = {}) {
  if (typeof statuslineCommand !== "string" || statuslineCommand.trim().length === 0) throw new TypeError("Claude statusline command must be a non-empty string");
  const settings = profile.modelPolicies[CLAUDE_SURFACE] === "surface-default"
    ? {}
    : clone(CLAUDE_MODEL_POLICY.template);
  settings.statusLine = {
    type: "command",
    command: statuslineCommand,
    padding: 0
  };
  settings.permissions = {
    defaultMode: profile.authority === "full" ? "bypassPermissions" : "default",
    deny: [...EMERGENCY_DENIES]
  };
  return settings;
}

function pluginManifest() {
  return {
    name: "all-about-agents",
    version: "1.0.0",
    description: "Portable all-about-agents skills, agents, commands, hooks, and rules for Claude Code.",
    author: { name: "All About Agents" }
  };
}

function marketplaceManifest(plugin) {
  return {
    name: "all-about-agents-dev",
    description: "Generated local development marketplace for the All About Agents package.",
    owner: { name: "All About Agents" },
    plugins: [
      {
        name: plugin.name,
        source: "./",
        description: plugin.description,
        version: plugin.version,
        author: plugin.author
      }
    ]
  };
}

function mappingsDocument() {
  const lines = [
    "# Claude adapter semantic mappings",
    "",
    "The core names semantic capabilities; this adapter names only documented Claude Code tools.",
    "",
    "| Capability | Claude tools |",
    "|---|---|"
  ];
  for (const key of Object.keys(CLAUDE_SEMANTIC_MAPPINGS).sort()) lines.push(`| ${key} | ${CLAUDE_SEMANTIC_MAPPINGS[key].join(", ")} |`);
  lines.push(
    "",
    "Settings are shared by Claude Code CLI and Claude Desktop local Code through `CLAUDE_CONFIG_DIR`.",
    "Read-only agents use Claude's `disallowedTools` for `Agent`, `Bash`, `Edit`, and `Write`.",
    "Read-only capability diagnostics identify any semantic action suppressed by that policy; record it as unavailable or not run rather than inferring a native substitute.",
    "The implementer's native Write/Edit controls are workspace-wide; its declared task paths remain an outer approval boundary.",
    "The plugin never loads a root `CLAUDE.md`; rules are emitted as independent files under `rules/`."
  );
  return ensureText(lines.join("\n"));
}

function addFile(files, relativePath, content, mode = null, contentKind = "generated") {
  const body = contentKind === "companion" ? content : ensureText(content);
  if (typeof body !== "string") throw new TypeError("rendered file content must be a string");
  files.push({ relativePath, content: new TextEncoder().encode(body), mode });
}

function makeOwnership(files) {
  return files
    .map((file) => ({
      relativePath: file.relativePath,
      sha256: createHash("sha256").update(file.content).digest("hex")
    }))
    .sort((left, right) => compareCodePoints(left.relativePath, right.relativePath));
}

/** Render one complete deterministic Claude package and config overlay. */
export function renderClaude(input = {}) {
  assertUnifiedSkillPortfolio(input);
  const core = input.core;
  if (!core || typeof core !== "object") throw new TypeError("core is required");
  for (const collection of ["rules", "skills", "workflows", "commands"]) {
    if (!Array.isArray(core[collection])) throw new TypeError(`core.${collection} must be an array`);
  }
  assertNativeRoleRecords(core.roles);
  assertNativeRoleSemantics(core.roles);
  const semanticProfile = resolveProfile(input.profile ?? "portable", {
    surface: CLAUDE_SURFACE,
    modelPolicyRefs: ["surface-default", "approved-opus-sonnet"]
  });
  const profile = semanticProfile.id;
  const statuslineName = validStatuslineName(input.statuslineName ?? "");
  const configRoot = resolveClaudeConfigDir(input);
  const statuslineCommand = renderClaudeStatuslineCommand({ configRoot, homeDir: input.homeDir, platform: input.platform });
  const files = [];
  const skillRecords = new Map(core.skills.map((record) => [record.id || record.name, record]));
  const roleRecords = new Map((Array.isArray(core.roles) ? core.roles : []).map((record) => [record.id || record.name, record]));

  const plugin = pluginManifest();
  addFile(files, ".claude-plugin/plugin.json", renderJson(plugin));
  addFile(files, ".claude-plugin/marketplace.json", renderJson(marketplaceManifest(plugin)));
  addFile(files, "CLAUDE.md", renderClaudeGlobalInstructions(core));
  addFile(files, "config/settings.json", renderJson(settingsFor(semanticProfile, { statuslineCommand })));
  addFile(files, "config/statusline.json", renderJson({ schemaVersion: 1, displayName: statuslineName }));
  addFile(files, "docs/semantic-mappings.md", mappingsDocument());
  addFile(files, "hooks/hooks.json", renderJson(hookConfig()));
  addFile(files, "hooks/bootstrap.json", BOOTSTRAP_CONFIG_SOURCE);
  addFile(files, `hooks/${claudeBootstrapTemplate.module}.mjs`, BOOTSTRAP_SOURCE, 0o755);
  addFile(files, "hooks/emergency-guard.json", EMERGENCY_CONFIG_SOURCE);
  addFile(files, "hooks/emergency-guard.mjs", EMERGENCY_GUARD_SOURCE, 0o755);
  addFile(files, "hooks/emergency-policy.mjs", EMERGENCY_POLICY_SOURCE, 0o755);
  addFile(files, "hooks/activity-audit.json", renderJson(claudeActivityTemplate));
  addFile(files, "hooks/checkpoint.json", renderJson(claudeCheckpointTemplate));
  addFile(files, "hooks/audit-log.mjs", AUDIT_LOG_SOURCE, 0o755);
  for (const [fileName, source] of Object.entries(HOOK_SOURCES)) addFile(files, `hooks/${fileName}`, source, 0o755);
  addFile(files, "statusline/statusline.mjs", STATUSLINE_SOURCE_TEXT, 0o755);
  addFile(files, "statusline/track-tool.mjs", STATUSLINE_TRACK_TOOL_SOURCE_TEXT, 0o755);
  addFile(files, "statusline/statusline.ps1", STATUSLINE_WINDOWS_SOURCE_TEXT);
  addFile(files, "statusline/statusline.sh", STATUSLINE_POSIX_SOURCE_TEXT, 0o755);

  const missingSkills = [];
  for (const skill of canonicalSkillIds(core)) {
    const rendered = renderSkill(skill, skillRecords.get(skill), core.presentation);
    if (!rendered.hasSource) missingSkills.push(skill);
    addFile(files, `skills/${skill}/SKILL.md`, rendered.content);
    for (const companion of skillCompanionsFor(skillRecords.get(skill))) addFile(files, `skills/${skill}/${companion.relativePath}`, companion.content, companion.mode, "companion");
  }
  addFile(files, "rules/presentation.md", renderPresentationCatalog(core.presentation));
  for (const rule of [...core.rules].sort((left, right) => String(left.id).localeCompare(String(right.id)))) addFile(files, `rules/${rule.id}.md`, renderRule(rule));

  const roleNames = [...(roleRecords.size > 0 ? roleRecords.keys() : Object.keys(DEFAULT_ROLES))].sort();
  for (const roleName of roleNames) addFile(files, `agents/${roleName}.md`, renderAgent(roleName, roleRecords.get(roleName), core.presentation));
  for (const command of [...core.commands].sort((left, right) => String(left.id).localeCompare(String(right.id)))) addFile(files, `commands/${command.id}.md`, renderCommand(command, core.presentation));

  files.sort((left, right) => compareCodePoints(left.relativePath, right.relativePath));
  const nativeStatusline = createNativeIntegrationRecord({
    surface: CLAUDE_SURFACE,
    feature: "statusline",
    phases: {
      rendered: { status: "pass", evidence: "Claude statusline renderer and platform launchers were rendered." },
      validated: { status: "pass", evidence: "Claude settings, renderer, and launchers pass adapter validation." },
      registered: { status: "not-run", evidence: "Native registration requires writing the mapped settings to the selected Claude config root." },
      trusted: { status: "not-run-unavailable", evidence: "Claude Code statusline commands have no native trust step." },
      active: { status: "not-run", evidence: "A Claude Code session has not been opened to observe the statusline." },
      runtimeVerified: { status: "not-run", evidence: "A native Claude statusline runtime check has not been run." }
    },
    sourcePath: "adapters/claude/adapter.mjs",
    manualSteps: [
      "Write the mapped settings.json and statusline files to the selected Claude config root.",
      "Open a fresh Claude Code session to observe the statusline."
    ]
  });
  const result = {
    files,
    registrations: [
      profileTranslation(semanticProfile, CLAUDE_SURFACE),
      nativeEmergencyRecord(semanticProfile),
      nativeStatusline,
      {
        kind: "plugin-registration",
        relativePath: ".claude-plugin/plugin.json",
        scope: "user",
        marketplace: "all-about-agents-dev",
        marketplaceCommand: ["claude", "plugin", "marketplace", "add", "."],
        command: ["claude", "plugin", "install", "all-about-agents@all-about-agents-dev"]
      },
      {
        kind: "runtime-prerequisite",
        ...CLAUDE_PREREQUISITES,
        platforms: ["win32", "darwin", "linux"]
      },
      {
        kind: "statusline-runtime-prerequisite",
        ...CLAUDE_STATUSLINE_PREREQUISITES,
        platforms: ["win32", "darwin", "linux"]
      },
      {
        kind: "settings",
        relativePath: "config/settings.json",
        rootEnv: "CLAUDE_CONFIG_DIR",
        destination: "settings.json",
        consumers: ["claude-code-cli", "claude-desktop-local-code"]
      },
      {
        kind: "instructions",
        relativePath: "CLAUDE.md",
        rootEnv: "CLAUDE_CONFIG_DIR",
        destination: "CLAUDE.md",
        consumers: ["claude-code-cli", "claude-desktop-local-code"]
      },
      {
        kind: "rules",
        relativeDirectory: "rules",
        rootEnv: "CLAUDE_CONFIG_DIR",
        destination: "rules"
      },
      {
        kind: "statusline-config",
        relativePath: "config/statusline.json",
        rootEnv: "CLAUDE_CONFIG_DIR",
        destination: "all-about-agents/statusline.json"
      },
      {
        kind: "resolved-config-root",
        rootEnv: "CLAUDE_CONFIG_DIR",
        path: configRoot
      },
      {
        kind: "activity-audit",
        surface: CLAUDE_SURFACE,
        relativePath: "hooks/hooks.json",
        event: claudeActivityTemplate.event,
        matcher: claudeActivityTemplate.nativeMatcher,
        optional: true,
        automatic: true,
        failureMode: claudeActivityTemplate.failureMode,
        recordedFields: [...claudeActivityTemplate.recordedFields]
      },
      {
        kind: "checkpoint",
        surface: CLAUDE_SURFACE,
        relativePath: "hooks/hooks.json",
        event: claudeCheckpointTemplate.event,
        matcher: claudeCheckpointTemplate.nativeMatcher,
        automatic: true,
        durableWorkflow: "explicit",
        failureMode: claudeCheckpointTemplate.failureMode,
        recordedFields: [...claudeCheckpointTemplate.recordedFields]
      }
    ],
    diagnostics: [
      ...core.roles.flatMap((role) => nativeCapabilityDiagnostics({ surface: CLAUDE_SURFACE, role, mappings: CLAUDE_SEMANTIC_MAPPINGS, blockedNativeTools: READ_ONLY_NATIVE_TOOLS })),
      ...nativeScopeDiagnostics(core.roles),
      ...missingSkills.map((skill) => ({
        code: "missing-skill-source",
        severity: "error",
        message: `Canonical skill '${skill}' has no source record; owner: cycle-05-skill-remediation (T017-T043). Package is deferred until the source is supplied.`,
        sourcePath: "core/inventory.json"
      })),
      ...(profile === "template"
        ? [{ code: "fable-advisor-availability", severity: "warning", message: "Fable advisor is documented, but account, organization, plan, provider, consent, and product-version conditions can limit access; the primary/fallback chain remains unchanged.", sourcePath: "config/settings.json" }]
        : [])
    ],
    ownership: makeOwnership(files)
  };
  const validation = validateRenderResult(result);
  if (!validation.valid) throw new Error(`Claude adapter produced an invalid RenderResult: ${JSON.stringify(validation.errors)}`);
  return result;
}

/** Apply the shared adapter seam and its required canonical action mappings. */
export function renderSurface(input = {}) {
  const capabilityRecord = {
    surface: CLAUDE_SURFACE,
    requiredMappings: Object.keys(CLAUDE_ACTION_MAPPINGS),
    actionMappings: CLAUDE_ACTION_MAPPINGS,
    render: () => renderClaude(input)
  };
  return validateSurface({ ...input, surface: CLAUDE_SURFACE, capabilityRecord: { ...capabilityRecord, ...input.capabilityRecord } });
}

export const render = renderClaude;
export const CLAUDE_CAPABILITY_RECORD = Object.freeze({
  surface: CLAUDE_SURFACE,
  requiredMappings: Object.freeze(Object.keys(CLAUDE_ACTION_MAPPINGS)),
  actionMappings: CLAUDE_ACTION_MAPPINGS,
  semanticMappings: CLAUDE_SEMANTIC_MAPPINGS
});
export const sanitizeStatuslineName = validStatuslineName;
export const STATUSLINE_SOURCE = STATUSLINE_SOURCE_TEXT;
export const STATUSLINE_TRACK_TOOL_SOURCE = STATUSLINE_TRACK_TOOL_SOURCE_TEXT;
