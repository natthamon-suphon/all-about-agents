import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

import packageJson from "../../package.json" with { type: "json" };
import { renderJson, renderText } from "../shared/render-utils.mjs";
import { renderSurface as validateSurface, validateRenderResult } from "../shared/adapter-contract.mjs";
import { SURFACE_HOME_DIRECTORY, SURFACE_ROOT_ENV } from "../shared/surfaces.mjs";
import { createNativeIntegrationRecord } from "../shared/native-state.mjs";
import { assertNativeRoleRecords, assertNativeRoleSemantics, hasNarrowerNativeScope, nativeScopeDiagnostics } from "../../core/roles/contract.mjs";
import { skillCompanionsFor } from "../../installers/lib/load-core.mjs";
import { profileTranslation, resolveProfile } from "../../profiles/profile-contract.mjs";
import { renderAntigravityGlobalInstructions } from "../shared/global-instructions.mjs";

const ANTIGRAVITY_SURFACE = "antigravity";
const ANTIGRAVITY_TARGET_RUNTIMES = Object.freeze(["cli", "desktop"]);
const PLUGIN_NAME = "all-about-agents";

// No hook is rendered for this surface. The recorded lifecycle events carry no
// session-start event, but that list is inherited from the 2026-08-31 record of
// agy 1.1.22 and was not re-verified on 1.2.7, which publishes no hook
// documentation. Since no event can be named, none is declared.
// See docs/evaluations/research-antigravity.md and the plan's decision A4.
const ANTIGRAVITY_SEMANTIC_MAPPINGS = Object.freeze({
  "repository-read": Object.freeze(["GEMINI.md"]),
  "repository-write": Object.freeze(["GEMINI.md"]),
  "web-primary-sources": Object.freeze(["search_web"]),
  "isolated-write": Object.freeze(["write_file"]),
  "command-execution": Object.freeze(["run_shell_command"]),
  "filesystem-read": Object.freeze(["read_file"]),
  "filesystem-write": Object.freeze(["write_file"]),
  "git-read": Object.freeze(["run_shell_command"]),
  "git-write": Object.freeze(["run_shell_command"]),
  "test-execution": Object.freeze(["run_shell_command"]),
  "external-research": Object.freeze(["search_web"]),
  evaluation: Object.freeze(["run_shell_command"]),
  "role-dispatch": Object.freeze(["invoke_subagent"]),
  "workflow-state": Object.freeze(["GEMINI.md"]),
  "schema-validation": Object.freeze(["run_shell_command"]),
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

/**
 * Resolve the Gemini configuration root that Antigravity shares with agy.
 *
 * Antigravity documents no environment variable for its home. Without an
 * override every qualification run would resolve to the operator's live
 * directory, so this installer reads its own repository-scoped variable. It is
 * deliberately not a product variable name.
 */
export const ANTIGRAVITY_ROOT_ENV = SURFACE_ROOT_ENV[ANTIGRAVITY_SURFACE];

export function resolveGeminiHome({ env = process.env, homeDir = homedir(), platform = process.platform } = {}) {
  const path = platform === "win32" ? win32 : posix;
  const override = env && typeof env === "object" ? env[ANTIGRAVITY_ROOT_ENV] : null;
  if (typeof override === "string" && override.trim() !== "") return override.trim();
  return path.join(homeDir, SURFACE_HOME_DIRECTORY[ANTIGRAVITY_SURFACE]);
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
    ? "\nSee [Antigravity adapter capability guidance](./references/adapter-capability-guidance.md).\n"
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
  return ensureText(`---\nname: ${name}\ndescription: ${quoteFrontmatter(description)}\n---\n\n${instructions}\n`);
}

/**
 * The plugin manifest Antigravity reads.
 *
 * `agy plugin validate` requires plugin.json at the package root, not inside a
 * vendor directory, and the documented schema allows only these properties.
 */
function pluginManifest() {
  return {
    name: PLUGIN_NAME,
    description: `Portable all-about-agents skills and roles for Antigravity, version ${packageJson.version}.`
  };
}

function capabilityGuidance(semanticProfile) {
  const modelGuidance = semanticProfile.modelPolicies[ANTIGRAVITY_SURFACE] === "surface-default"
    ? "- The portable profile leaves the model and reasoning effort unchanged."
    : "- The template profile records `gemini-3.1-pro-high` as the approved model; selection stays a manual `--model` or `/model` action because no documented on-disk key is published.";
  return ensureText([
    "# Antigravity adapter capability guidance",
    "",
    "This package is the Antigravity adapter's documented surface map.",
    "",
    "- The configuration root is the user's `.gemini` directory. No environment variable is documented for it, so none is read.",
    "- `GEMINI.md` carries the canonical global body, the inlined routing contract, the canonical rules, and the presentation catalog.",
    "- Skills are packaged under `skills/<skill>/SKILL.md` and roles under `agents/<role>.md`; `agy plugin validate` reports both counts.",
    "- There is no session-start event. The routing contract is inlined into `GEMINI.md` rather than injected, and this adapter renders no hook files.",
    "- This adapter renders no status line. The removed adapters built one from a plugin path the product never creates.",
    modelGuidance,
    "- Antigravity Desktop discovery is a manual per-workspace step; see `docs/manual-desktop.md`.",
    "",
    "If a selected Antigravity capability, path, syntax, or product surface is unavailable, report that condition and stop or ask for direction rather than inferring support.",
    ""
  ].join("\n"));
}

function desktopInstructions(semanticProfile) {
  const modelLines = semanticProfile.modelPolicies[ANTIGRAVITY_SURFACE] === "surface-default"
    ? ["The portable profile keeps the current Antigravity model and effort controls unchanged."]
    : ["The template profile records `gemini-3.1-pro-high`. Select it in the Desktop model controls; no documented Desktop profile selector is assumed by this adapter."];
  return ensureText([
    "# Antigravity Desktop manual setup",
    "",
    "The `agy` CLI discovers this package through `agy plugin install`, which",
    "copies it into the shared Gemini plugin root. Antigravity Desktop is not",
    "driven by that command and is registered by hand.",
    "",
    "Copy `plugin.json`, `skills/`, and `agents/` from this package into the",
    "workspace you open in Desktop:",
    "",
    "```text",
    "<workspace>/.agents/plugins/all-about-agents/",
    "```",
    "",
    "Add `.agents/plugins/` to that workspace's ignore file.",
    "",
    ...modelLines,
    "",
    "ASSUMPTION MADE: Desktop reads the per-workspace slot rather than the shared",
    "plugin root. The source is a 2026-09-03 observation, not a check on the",
    "current Desktop build, and Desktop has no headless mode, so registration,",
    "active state, and runtime evidence stay manual and are not claimed here.",
    ""
  ].join("\n"));
}

function packageReadme(semanticProfile) {
  return ensureText([
    "# all-about-agents for Antigravity",
    "",
    `Rendered from all-about-agents ${packageJson.version}, profile \`${semanticProfile.id}\`.`,
    "",
    "## Install",
    "",
    "```text",
    "agy plugin validate <this directory>",
    "agy plugin install <this directory>",
    "agy plugin list",
    "agy agents",
    "```",
    "",
    "`agy plugin install` takes a plain directory and needs no Git repository.",
    "",
    "## Global instructions",
    "",
    "`GEMINI.md` belongs at the root of the user's `.gemini` directory. It is",
    "deployed with a no-clobber guard: when a different file is already there,",
    "registration reports `manual-required` and writes nothing, because that file",
    "may hold sections this package does not own.",
    "",
    "## Desktop",
    "",
    "See `docs/manual-desktop.md`.",
    ""
  ].join("\n"));
}

/**
 * Record that the Antigravity emergency deny rules are not a runtime claim.
 *
 * This adapter renders no settings overlay: the deny list lives in the
 * operator's own `antigravity-cli/settings.json`, which this package does not
 * own. The record therefore states what must stay in place and never claims
 * the product enforces it.
 */
function nativeEmergencyRecord(targetRuntime, semanticProfile) {
  const desktop = targetRuntime === "desktop";
  const permissionStep = semanticProfile.authority === "full"
    ? "Keep always-proceed tool permission bounded by the permission deny policy."
    : "Keep the portable permission profile and do not claim full access.";
  const exactDenyStep = "Retain command(rm -rf), command(sudo), write_file(.git/), and write_file(/home/user/.ssh).";
  return createNativeIntegrationRecord({
    surface: ANTIGRAVITY_SURFACE,
    feature: "emergency-protection",
    phases: {
      rendered: {
        status: "pass",
        evidence: `Recorded the Antigravity ${desktop ? "Desktop" : "CLI"} permission expectation for ${semanticProfile.authority === "full" ? "full authority" : "the portable permission profile"}; no settings file is rendered.`
      },
      validated: {
        status: "not-run",
        evidence: "The deny policy is recorded only; no native validation of the permission settings was run."
      },
      registered: {
        status: "not-run",
        evidence: desktop
          ? "Antigravity Desktop discovery and permission registration were not run; Desktop remains manual."
          : "agy plugin registration was not run during rendering, and this package never writes the permission settings."
      },
      trusted: {
        status: "not-run-unavailable",
        evidence: "The Antigravity permission deny policy has no native trust concept."
      },
      active: {
        status: "not-run",
        evidence: desktop
          ? "Antigravity Desktop permission protection is not active by claim; no Desktop evidence was collected."
          : "Antigravity CLI deny-policy state was not checked in a fresh session."
      },
      runtimeVerified: {
        status: "not-run",
        evidence: desktop
          ? "Antigravity Desktop deny enforcement was not exercised in a native runtime probe."
          : "Antigravity CLI deny enforcement was not exercised in a native session."
      }
    },
    sourcePath: "adapters/antigravity/adapter.mjs",
    manualSteps: desktop ? [
      "Record the installed Antigravity Desktop version and platform.",
      permissionStep,
      exactDenyStep
    ] : [
      "Install the rendered package with agy plugin install.",
      permissionStep,
      exactDenyStep,
      "Start a fresh agy session before checking active permission behavior."
    ]
  });
}

function targetRuntimeOf(input) {
  const requested = input?.targetRuntime ?? "cli";
  if (!ANTIGRAVITY_TARGET_RUNTIMES.includes(requested)) throw new TypeError(`unsupported Antigravity target runtime ${String(requested)}`);
  return requested;
}

/** Render the deterministic Antigravity package. */
export function renderAntigravity(input = {}) {
  const core = input.core;
  if (!core || typeof core !== "object") throw new TypeError("core is required");
  for (const collection of ["rules", "skills"]) {
    if (!Array.isArray(core[collection])) throw new TypeError(`core.${collection} must be an array`);
  }
  assertNativeRoleRecords(core.roles);
  assertNativeRoleSemantics(core.roles);
  const targetRuntime = targetRuntimeOf(input);
  const semanticProfile = resolveProfile(input.profile ?? "portable", {
    surface: ANTIGRAVITY_SURFACE,
    modelPolicyRefs: ["surface-default", "approved-gemini-pro"]
  });

  const files = [];
  addFile(files, "plugin.json", renderJson(pluginManifest()));
  addFile(files, "GEMINI.md", renderAntigravityGlobalInstructions(core, { canonicalRules: core.rules }));
  addFile(files, "README.md", packageReadme(semanticProfile));
  addFile(files, "docs/manual-desktop.md", desktopInstructions(semanticProfile));

  const skillRecords = new Map(core.skills.map((record) => [record.id || record.name, record]));
  const missingSkills = [];
  addFile(files, "skills/using-all-about-agents/references/adapter-capability-guidance.md", capabilityGuidance(semanticProfile));
  for (const skill of canonicalSkillIds(core)) {
    const rendered = renderSkill(skill, skillRecords.get(skill));
    if (!rendered.hasSource) missingSkills.push({ skill, hasRecord: skillRecords.has(skill) });
    addFile(files, `skills/${skill}/SKILL.md`, rendered.content);
    for (const companion of skillCompanionsFor(skillRecords.get(skill))) addFile(files, `skills/${skill}/${companion.relativePath}`, companion.content, companion.mode, "companion");
  }

  const roleRecords = new Map((Array.isArray(core.roles) ? core.roles : []).map((record) => [record.id || record.name, record]));
  const roleNames = [...(roleRecords.size > 0 ? roleRecords.keys() : Object.keys(DEFAULT_ROLES))].sort(compareCodePoints);
  for (const roleName of roleNames) addFile(files, `agents/${roleName}.md`, renderRole(roleName, roleRecords.get(roleName)));

  files.sort((left, right) => compareCodePoints(left.relativePath, right.relativePath));
  const configRoot = resolveGeminiHome(input);

  const result = {
    files,
    registrations: [
      profileTranslation(semanticProfile, ANTIGRAVITY_SURFACE),
      nativeEmergencyRecord(targetRuntime, semanticProfile),
      {
        kind: "plugin-package",
        relativePath: "plugin.json",
        packageRoot: ".",
        validateArgs: ["plugin", "validate", "PACKAGE_ROOT"],
        installArgs: ["plugin", "install", "PACKAGE_ROOT"],
        discoveryArgs: ["plugin", "list"]
      },
      {
        // GEMINI.md is shared with everything else the operator keeps in the
        // Gemini home. Unlike Claude's CLAUDE.md this render is not a superset
        // of that file, so registration must refuse rather than replace it.
        kind: "instructions",
        relativePath: "GEMINI.md",
        destination: "GEMINI.md",
        guard: "no-clobber",
        consumers: ["antigravity-cli", "antigravity-desktop"]
      },
      {
        kind: "plugin-skills",
        relativeDirectory: "skills",
        destination: "skills",
        consumers: ["antigravity-cli", "antigravity-desktop"]
      },
      {
        kind: "agents",
        relativeDirectory: "agents",
        destination: "agents",
        consumers: ["antigravity-cli", "antigravity-desktop"],
        format: "markdown"
      },
      {
        kind: "manual-step",
        surface: "antigravity-desktop",
        id: "desktop-workspace-slot",
        instruction: "Copy plugin.json, skills/, and agents/ into <workspace>/.agents/plugins/all-about-agents/; see docs/manual-desktop.md."
      },
      ...(semanticProfile.modelPolicies[ANTIGRAVITY_SURFACE] === "surface-default" ? [] : [{
        kind: "manual-step",
        surface: "antigravity-cli",
        id: "approved-gemini-pro-model",
        instruction: "Select gemini-3.1-pro-high with agy --model or the /model command; no documented on-disk key persists it."
      }]),
      {
        kind: "resolved-config-root",
        rootEnv: null,
        path: configRoot
      }
    ],
    diagnostics: [
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
  if (!validation.valid) throw new Error(`Antigravity adapter produced an invalid RenderResult: ${JSON.stringify(validation.errors)}`);
  return result;
}

/** Apply the shared adapter seam. */
export function renderSurface(input = {}) {
  const capabilityRecord = {
    surface: ANTIGRAVITY_SURFACE,
    render: () => renderAntigravity(input)
  };
  return validateSurface({
    ...input,
    surface: ANTIGRAVITY_SURFACE,
    capabilityRecord: { ...capabilityRecord, ...input.capabilityRecord }
  });
}

export const render = renderAntigravity;
export const ANTIGRAVITY_CAPABILITY_RECORD = Object.freeze({
  surface: ANTIGRAVITY_SURFACE,
  semanticMappings: ANTIGRAVITY_SEMANTIC_MAPPINGS
});
export { ANTIGRAVITY_SEMANTIC_MAPPINGS, ANTIGRAVITY_TARGET_RUNTIMES };
