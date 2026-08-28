import { homedir } from "node:os";
import { posix, win32 } from "node:path";

import { createHash } from "node:crypto";
import { renderJson, renderText, renderToml } from "../shared/render-utils.mjs";
import { AdapterContractError, renderSurface as validateSurface, validateCommandRecords, validateRenderResult } from "../shared/adapter-contract.mjs";

const CODEX_SURFACE = "codex";
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
    model: "gpt-5.6-sol",
    model_reasoning_effort: "max",
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

function profileId(profile) {
  const id = typeof profile === "string" ? profile : profile?.id;
  if (id !== "portable" && id !== "template") throw new TypeError("profile.id must be portable or template");
  return id;
}

function addFile(files, relativePath, content, mode = null) {
  files.push({ relativePath, content: new TextEncoder().encode(content), mode });
}

function makeOwnership(files) {
  return files.map((file) => ({
    relativePath: file.relativePath,
    sha256: createHash("sha256").update(file.content).digest("hex")
  })).sort((left, right) => compareCodePoints(left.relativePath, right.relativePath));
}

function configFor(model, profile, includePermissions = true) {
  if (!includePermissions) return renderToml(CODEX_MODEL_POLICY.alternate);
  const policy = CODEX_MODEL_POLICY[profile];
  return renderToml({
    approval_policy: policy.approval_policy,
    model: model ?? policy.model,
    model_reasoning_effort: policy.model_reasoning_effort,
    sandbox_mode: policy.sandbox_mode
  });
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
  const fallback = DEFAULT_ROLES[name] || DEFAULT_ROLES.reviewer;
  const description = role?.description || role?.purpose || fallback.description;
  const capabilities = role
    ? [
      ...(Array.isArray(role.capabilities) ? role.capabilities : []),
      ...(Array.isArray(role.requiredCapabilities) ? role.requiredCapabilities : [])
    ]
    : fallback.capabilities;
  const roleContext = [
    role?.purpose,
    capabilities.length > 0 ? `Semantic capabilities: ${[...new Set(capabilities)].join(", ")}.` : "",
    Array.isArray(role?.invariants) && role.invariants.length > 0 ? `Invariants: ${role.invariants.join("; ")}` : "",
    Array.isArray(role?.dispatchCriteria) && role.dispatchCriteria.length > 0 ? `Dispatch criteria: ${role.dispatchCriteria.join("; ")}` : ""
  ].filter(Boolean).join("\n\n");
  const instructions = role?.prompt || roleContext || `Operate as the ${name} role. Preserve scope, verify evidence, and report uncertainty.`;
  return ensureText([
    `name = ${JSON.stringify(name)}`,
    `description = ${JSON.stringify(description)}`,
    `developer_instructions = ${JSON.stringify(instructions)}`,
    ""
  ].join("\n"));
}

function pluginManifest() {
  return {
    name: "all-about-agents",
    version: "1.0.0",
    description: "Portable all-about-agents skills for Codex CLI and Desktop.",
    skills: "./.agents/skills"
  };
}

function desktopInstructions() {
  return ensureText([
    "# Codex Desktop manual setup",
    "",
    "The shared default uses gpt-5.6-sol with max reasoning.",
    "",
    "To use the explicit alternate in Codex Desktop, select gpt-5.6-terra and max reasoning in the Desktop model controls for the current thread.",
    "",
    "Desktop model selection is manual because no documented Desktop profile selector is assumed by this adapter.",
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
  const lines = value.replace(/\r\n?/gu, "\n").split("\n");
  if (lines.at(-1) !== "") throw new SyntaxError("TOML document must end with a newline");
  lines.slice(0, -1).forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;
    const match = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/u.exec(trimmed);
    if (!match) throw new SyntaxError(`invalid TOML assignment on line ${index + 1}`);
    const [, key, raw] = match;
    if (Object.hasOwn(result, key)) throw new SyntaxError(`duplicate TOML key ${key} on line ${index + 1}`);
    result[key] = parseTomlValue(raw, index + 1);
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

function capabilityGuidance() {
  return ensureText([
    "# Codex adapter capability guidance",
    "",
    "This package is the Codex adapter's documented surface map.",
    "",
    "- `CODEX_HOME` selects the shared Codex CLI/Desktop configuration root; the fallback is the user's `.codex` directory.",
    "- `AGENTS.md` is rendered as a regular instruction file for the canonical rules and action-to-workflow mappings.",
    "- Skills are packaged under `.agents/skills/<skill>/SKILL.md`; missing canonical sources remain marked `DEFERRED`.",
    "- Custom roles are standalone custom-agent TOML files under `.codex/agents/<role>.toml`.",
    "- The primary overlay uses Sol/max; `terra-max.config.toml` is an explicit Terra/max CLI alternative.",
    "- Codex Desktop Terra/max selection is manual in its model controls.",
    "",
    "This adapter does not define repository schedules or a native statusline. If a selected Codex capability, path, syntax, or product surface is unavailable, report that condition and stop or ask for direction rather than inferring support.",
    ""
  ].join("\n"));
}

/** Render the initial deterministic Codex policy overlays. */
export function renderCodex(input = {}) {
  const core = input.core;
  if (!core || typeof core !== "object") throw new TypeError("core is required");
  for (const collection of ["rules", "skills", "workflows", "commands"]) {
    if (!Array.isArray(core[collection])) throw new TypeError(`core.${collection} must be an array`);
  }
  const commandValidation = validateCommandRecords(core.commands, core.workflows);
  if (!commandValidation.valid) throw new AdapterContractError(commandValidation.errors);
  validateCommandPresentation(core.commands);
  const profile = profileId(input.profile ?? "portable");
  const files = [];
  addFile(files, ".codex-plugin/plugin.json", renderJson(pluginManifest()));
  addFile(files, "AGENTS.md", renderAgentsDocument(core));
  addFile(files, ".agents/skills/using-all-about-agents/references/adapter-capability-guidance.md", capabilityGuidance());
  addFile(files, "docs/manual-desktop.md", desktopInstructions());
  addFile(files, "config.toml", configFor("gpt-5.6-sol", profile));
  addFile(files, "terra-max.config.toml", configFor("gpt-5.6-terra", profile, false));
  const skillRecords = new Map(core.skills.map((record) => [record.id || record.name, record]));
  const missingSkills = [];
  for (const skill of canonicalSkillIds(core)) {
    const rendered = renderSkill(skill, skillRecords.get(skill));
    if (!rendered.hasSource) missingSkills.push({ skill, hasRecord: skillRecords.has(skill) });
    addFile(files, `.agents/skills/${skill}/SKILL.md`, rendered.content);
  }
  const roleRecords = new Map((Array.isArray(core.roles) ? core.roles : []).map((record) => [record.id || record.name, record]));
  const roleNames = [...new Set([...Object.keys(DEFAULT_ROLES), ...roleRecords.keys()])].sort(compareCodePoints);
  for (const roleName of roleNames) addFile(files, `.codex/agents/${roleName}.toml`, renderRole(roleName, roleRecords.get(roleName)));
  files.sort((left, right) => compareCodePoints(left.relativePath, right.relativePath));
  for (const file of files) {
    if (file.relativePath.endsWith(".toml")) parseCodexToml(new TextDecoder().decode(file.content));
  }
  const configRoot = resolveCodexHome(input);
  const result = {
    files,
    registrations: [
      {
        kind: "plugin-package",
        relativePath: ".codex-plugin/plugin.json",
        packageRoot: "."
      },
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
      {
        kind: "profile",
        name: "terra-max",
        relativePath: "terra-max.config.toml",
        rootEnv: "CODEX_HOME",
        destination: "terra-max.config.toml",
        consumers: ["codex-cli"]
      },
      {
        kind: "manual-step",
        surface: "codex-desktop",
        id: "terra-max-model",
        instruction: "Select gpt-5.6-terra and max reasoning in the Desktop model controls."
      },
      {
        kind: "resolved-config-root",
        rootEnv: "CODEX_HOME",
        path: configRoot
      }
    ],
    diagnostics: missingSkills.map(({ skill, hasRecord }) => ({
      code: "missing-skill-source",
      severity: "error",
      message: `Canonical skill '${skill}' ${hasRecord ? "has no usable source content" : "has no source record"}; owner: cycle-05-skill-remediation (T017-T043). Package is deferred until the source is supplied.`,
      sourcePath: "core/inventory.json"
    })),
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
