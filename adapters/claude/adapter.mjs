import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join, posix } from "node:path";

import { renderJson } from "../shared/render-utils.mjs";
import {
  renderSurface as validateSurface,
  validateRenderResult
} from "../shared/adapter-contract.mjs";

const CLAUDE_SURFACE = "claude";
const MAX_STATUSLINE_NAME_CODE_POINTS = 64;
const CONTROL_OR_ANSI = /[\u0000-\u001f\u007f]|\u001b\[[0-?]*[ -/]*[@-~]/u;

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
  portable: Object.freeze({
    model: "claude-opus-5",
    fallbackModel: Object.freeze(["claude-sonnet-5"]),
    env: Object.freeze({ CLAUDE_CODE_EFFORT_LEVEL: "xhigh" })
  }),
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
    tools: ["Read", "Glob", "Grep", "Bash"]
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
    tools: ["Read", "Glob", "Grep", "Bash"]
  }),
  reviewer: Object.freeze({
    description: "Review specifications, diffs, tests, and maintainability evidence.",
    capabilities: ["repository-read", "evaluation", "schema-validation"],
    tools: ["Read", "Glob", "Grep", "Bash"]
  }),
  "security-reviewer": Object.freeze({
    description: "Check threat paths, secrets, containment, and emergency guardrails.",
    capabilities: ["repository-read", "evaluation", "schema-validation"],
    tools: ["Read", "Glob", "Grep", "Bash"]
  })
});

const HOOK_SOURCES = Object.freeze({
  "session-start.mjs": `#!/usr/bin/env node
// SessionStart is deliberately data-only and fail-open. It never reads CLAUDE.md.
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
try { JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { /* fail open */ }
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "All About Agents bootstrap is available through the installed plugin skills." } }));
`,
  "emergency-guard.mjs": `#!/usr/bin/env node
// Native permissions.deny remains authoritative; this hook only parses input and fails open.
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
try { JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { /* fail open */ }
`,
  "activity-audit.mjs": `#!/usr/bin/env node
// Activity audit is optional and intentionally emits no arguments or results.
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
try { JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { /* fail open */ }
`,
  "pre-compact.mjs": `#!/usr/bin/env node
// Checkpointing is owned by the durable workflow; this hook does not rewrite user files.
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
try { JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { /* fail open */ }
`
});

const STATUSLINE_SOURCE_TEXT = `#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const CONTROL = /[\\u0000-\\u001f\\u007f]|\\u001b\\[[0-?]*[ -/]*[@-~]/gu;
export function sanitizeTerminalText(value) {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL, "").replace(/[\\r\\n]/gu, " ").trim();
}
export function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}
export async function readStatuslineConfig(root) {
  try {
    const parsed = JSON.parse(await readFile(join(root, "all-about-agents", "statusline.json"), "utf8"));
    return { displayName: typeof parsed.displayName === "string" ? sanitizeTerminalText(parsed.displayName) : "" };
  } catch {
    return { displayName: "" };
  }
}
`;

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

/** Resolve the documented Claude settings root without reading or writing it. */
export function resolveClaudeConfigDir({ env = process.env, homeDir = homedir(), platform = process.platform } = {}) {
  const configured = env && typeof env.CLAUDE_CONFIG_DIR === "string" ? env.CLAUDE_CONFIG_DIR.trim() : "";
  return configured || (platform === "win32" ? join(homeDir, ".claude") : posix.join(homeDir, ".claude"));
}

function profileId(profile) {
  const id = typeof profile === "string" ? profile : profile?.id;
  if (id !== "portable" && id !== "template") throw new TypeError("profile.id must be portable or template");
  return id;
}

function canonicalSkillIds(core) {
  const fromInventory = Array.isArray(core?.inventory?.skills) ? core.inventory.skills : [];
  const fromRecords = Array.isArray(core?.skills) ? core.skills.map((record) => record?.id ?? record?.name) : [];
  return [...new Set([...fromInventory, ...fromRecords].filter((id) => typeof id === "string" && id.length > 0))].sort();
}

function renderSkill(name, record) {
  const description = record?.description || `Canonical ${name} skill.`;
  const body = stripFrontmatter(record?.content || `This canonical skill is installed by the All About Agents Claude plugin.\n`);
  return ensureText(`---\nname: ${name}\ndescription: ${quoteFrontmatter(description)}\n---\n\n${body}`);
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

function renderAgent(name, role) {
  const fallback = DEFAULT_ROLES[name] || DEFAULT_ROLES.reviewer;
  const description = role?.description || role?.purpose || fallback.description;
  const semanticNames = [
    ...(Array.isArray(role?.capabilities) ? role.capabilities : []),
    ...(Array.isArray(role?.requiredCapabilities) ? role.requiredCapabilities : [])
  ];
  const mappedTools = semanticNames.flatMap((capability) => CLAUDE_SEMANTIC_MAPPINGS[capability] || []);
  const tools = [...new Set([...(mappedTools.length > 0 ? mappedTools : fallback.tools)])].sort();
  const roleContext = [
    role?.purpose,
    Array.isArray(role?.invariants) && role.invariants.length > 0 ? `Invariants: ${role.invariants.join("; ")}` : "",
    Array.isArray(role?.dispatchCriteria) && role.dispatchCriteria.length > 0 ? `Dispatch criteria: ${role.dispatchCriteria.join("; ")}` : ""
  ].filter(Boolean).join("\n\n");
  const body = role?.prompt || roleContext || `Operate as the ${name} role. Preserve scope, verify evidence, and report uncertainty.\n`;
  return ensureText(`---\nname: ${name}\ndescription: ${quoteFrontmatter(description)}\nmodel: inherit\ntools:\n${tools.map((tool) => `  - ${tool}`).join("\n")}\n---\n\n${body}`);
}

function renderCommand(command) {
  const description = command.presentation?.help || `Dispatch ${command.actionId}.`;
  return ensureText(`---\ndescription: ${quoteFrontmatter(description)}\n---\n\nDispatch canonical action \`${command.actionId}\` through workflow \`${command.workflowId}\`.\n`);
}

function hookConfig() {
  const command = (fileName) => ({
    type: "command",
    command: "node",
    args: [`${"${CLAUDE_PLUGIN_ROOT}"}/hooks/${fileName}`],
    timeout: 10
  });
  return { hooks: {
    SessionStart: [{ matcher: "startup|resume|clear|compact|fork", hooks: [command("session-start.mjs")] }],
    PreToolUse: [{ matcher: ".*", hooks: [command("emergency-guard.mjs")] }],
    PostToolUse: [{ matcher: ".*", hooks: [command("activity-audit.mjs")] }],
    PreCompact: [{ matcher: ".*", hooks: [command("pre-compact.mjs")] }]
  } };
}

function settingsFor(profile) {
  const settings = clone(CLAUDE_MODEL_POLICY[profile]);
  settings.permissions = {
    defaultMode: profile === "template" ? "bypassPermissions" : "default",
    deny: [...EMERGENCY_DENIES]
  };
  return settings;
}

function pluginManifest() {
  return {
    name: "all-about-agents",
    version: "1.0.0",
    description: "Portable all-about-agents skills, agents, commands, hooks, and rules for Claude Code.",
    author: { name: "All About Agents" },
    hooks: "./hooks/hooks.json"
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
  lines.push("", "Settings are shared by Claude Code CLI and Claude Desktop local Code through `CLAUDE_CONFIG_DIR`.", "The plugin never loads a root `CLAUDE.md`; rules are emitted as independent files under `rules/`.");
  return ensureText(lines.join("\n"));
}

function addFile(files, relativePath, content, mode = null) {
  files.push({ relativePath, content: new TextEncoder().encode(ensureText(content)), mode });
}

function makeOwnership(files) {
  return files
    .map((file) => ({
      relativePath: file.relativePath,
      sha256: createHash("sha256").update(file.content).digest("hex")
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

/** Render one complete deterministic Claude package and config overlay. */
export function renderClaude(input = {}) {
  const core = input.core;
  if (!core || typeof core !== "object") throw new TypeError("core is required");
  for (const collection of ["rules", "skills", "workflows", "commands"]) {
    if (!Array.isArray(core[collection])) throw new TypeError(`core.${collection} must be an array`);
  }
  const profile = profileId(input.profile ?? "portable");
  const statuslineName = validStatuslineName(input.statuslineName ?? "");
  const files = [];
  const skillRecords = new Map(core.skills.map((record) => [record.id || record.name, record]));
  const roleRecords = new Map((Array.isArray(core.roles) ? core.roles : []).map((record) => [record.id || record.name, record]));

  addFile(files, ".claude-plugin/plugin.json", renderJson(pluginManifest()));
  addFile(files, "config/settings.json", renderJson(settingsFor(profile)));
  addFile(files, "config/statusline.json", renderJson({ schemaVersion: 1, displayName: statuslineName }));
  addFile(files, "docs/semantic-mappings.md", mappingsDocument());
  addFile(files, "hooks/hooks.json", renderJson(hookConfig()));
  for (const [fileName, source] of Object.entries(HOOK_SOURCES)) addFile(files, `hooks/${fileName}`, source, 0o755);
  addFile(files, "statusline/statusline.mjs", STATUSLINE_SOURCE_TEXT, 0o755);

  for (const skill of canonicalSkillIds(core)) addFile(files, `skills/${skill}/SKILL.md`, renderSkill(skill, skillRecords.get(skill)));
  for (const rule of [...core.rules].sort((left, right) => String(left.id).localeCompare(String(right.id)))) addFile(files, `rules/${rule.id}.md`, renderRule(rule));

  const roleNames = [...new Set([...Object.keys(DEFAULT_ROLES), ...roleRecords.keys()])].sort();
  for (const roleName of roleNames) addFile(files, `agents/${roleName}.md`, renderAgent(roleName, roleRecords.get(roleName)));
  for (const command of [...core.commands].sort((left, right) => String(left.id).localeCompare(String(right.id)))) addFile(files, `commands/${command.id}.md`, renderCommand(command));

  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const configRoot = resolveClaudeConfigDir(input);
  const result = {
    files,
    registrations: [
      {
        kind: "plugin-registration",
        relativePath: ".claude-plugin/plugin.json",
        scope: "user",
        command: ["claude", "plugin", "install", "all-about-agents@local"]
      },
      {
        kind: "settings",
        relativePath: "config/settings.json",
        rootEnv: "CLAUDE_CONFIG_DIR",
        destination: "settings.json",
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
      }
    ],
    diagnostics: profile === "template"
      ? [{ code: "experimental-advisor", severity: "warning", message: "Fable advisor access is experimental and may be unavailable; the primary/fallback chain remains unchanged.", sourcePath: "config/settings.json" }]
      : [],
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
