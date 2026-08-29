/** Canonical role IDs and mutation semantics shared by the loader and adapters. */
export const CANONICAL_ROLE_IDS = Object.freeze([
  "researcher",
  "investigator",
  "architect",
  "implementer",
  "verifier",
  "reviewer",
  "security-reviewer"
]);

export const WRITE_SEMANTIC_CAPABILITIES = Object.freeze([
  "repository-write",
  "filesystem-write",
  "git-write",
  "isolated-write",
  "command-execution"
]);

// This is the single portable vocabulary allowed to cross into native adapters.
// Keep vendor tool names out of this list; each adapter owns its translation.
export const SEMANTIC_CAPABILITIES = Object.freeze([
  "repository-read",
  "repository-write",
  "web-primary-sources",
  "isolated-write",
  "command-execution",
  "filesystem-read",
  "filesystem-write",
  "git-read",
  "git-write",
  "test-execution",
  "external-research",
  "evaluation",
  "role-dispatch",
  "workflow-state",
  "schema-validation",
  "native-rendering"
]);

/** Capabilities that must never be granted to a canonical role artifact. */
export const PRIVILEGED_SEMANTIC_CAPABILITIES = Object.freeze(["role-dispatch"]);

const CANONICAL_ROLE_SET = new Set(CANONICAL_ROLE_IDS);
const WRITE_CAPABILITY_SET = new Set(WRITE_SEMANTIC_CAPABILITIES);
const SEMANTIC_CAPABILITY_SET = new Set(SEMANTIC_CAPABILITIES);
const PRIVILEGED_CAPABILITY_SET = new Set(PRIVILEGED_SEMANTIC_CAPABILITIES);
const IMPLEMENTER_SCOPE_OPERATIONS = new Set(["create", "modify", "delete"]);
const PROMPT_NATIVE_INSTRUCTION_PATTERN = /(?:\b(?:use|invoke|call|run|execute|launch)\s+(?:bash|git\s+bash|powershell|pwsh|edit|write|agent|subagent|run_command|write_to_file|replace_file_content|multi_replace_file_content|invoke_subagent|define_subagent|manage_subagents)\b|\b(?:bash|git\s+bash|powershell|pwsh|agent|subagent)\s+(?:tool|command|shell)\b|\b(?:git\s+bash|powershell|pwsh)\b|\b(?:claude\s+)?(?:edit|write)\s+tools?\b|`(?:bash|powershell|pwsh|edit|write|agent|subagent|run_command|write_to_file|replace_file_content|multi_replace_file_content|invoke_subagent|define_subagent|manage_subagents)`|\b(?:run_command|write_to_file|replace_file_content|multi_replace_file_content|invoke_subagent|define_subagent|manage_subagents)\b)/iu;

/** Keep mutation scopes portable and unambiguous at every native boundary. */
export function isValidMutationScopePath(scopePath) {
  if (typeof scopePath !== "string" || scopePath.length === 0 || /[\u0000-\u001f\u007f]/u.test(scopePath) || scopePath.includes("\\")) return false;
  if (scopePath === "workspace") return true;
  const segments = scopePath.split("/");
  if (segments[0] !== "workspace" || segments.some((segment) => segment.length === 0 || segment === "." || segment === ".." || segment.includes("..") || /^[A-Za-z]:$/u.test(segment))) return false;
  const globIndex = segments.indexOf("**");
  if (globIndex >= 0 && (globIndex !== segments.length - 1 || segments.filter((segment) => segment === "**").length !== 1)) return false;
  if (segments.some((segment) => /[<>:"|?]/u.test(segment) || (segment.includes("*") && segment !== "**"))) return false;
  return true;
}

export function isValidMutationScopeOperation(operation) {
  return typeof operation === "string" && !/[\u0000-\u001f\u007f]/u.test(operation) && IMPLEMENTER_SCOPE_OPERATIONS.has(operation);
}

export function isSafePortableRolePrompt(prompt) {
  return typeof prompt === "string" && !PROMPT_NATIVE_INSTRUCTION_PATTERN.test(prompt);
}

export function isCanonicalRoleId(value) {
  return typeof value === "string" && CANONICAL_ROLE_SET.has(value);
}

/** Reject unknown or duplicate role records before any native renderer runs. */
export function assertCanonicalRoleRecords(roles) {
  const errors = [];
  if (!Array.isArray(roles)) {
    errors.push({ code: "canonical-role", path: "/roles", message: "core.roles must be an array of canonical role records" });
  } else {
    const seen = new Set();
    for (const [index, role] of roles.entries()) {
      const id = role?.id;
      if (!isCanonicalRoleId(id)) {
        errors.push({ code: "canonical-role", path: `/roles/${index}/id`, message: `unknown canonical role ${String(id)}` });
      } else if (seen.has(id)) {
        errors.push({ code: "canonical-role", path: `/roles/${index}/id`, message: `duplicate canonical role ${id}` });
      } else {
        seen.add(id);
      }
    }
    for (const id of [...CANONICAL_ROLE_SET].sort()) {
      if (!seen.has(id)) errors.push({ code: "canonical-role", path: `/roles/${id}`, message: `missing canonical role ${id}` });
    }
  }
  if (errors.length > 0) {
    const error = new Error("Canonical role contract validation failed");
    error.name = "CanonicalRoleContractError";
    error.errors = errors;
    throw error;
  }
}

export function writeCapabilities(role) {
  return roleCapabilities(role).filter((capability) => WRITE_CAPABILITY_SET.has(capability));
}

export function roleCapabilities(role) {
  return [...new Set([
    ...(Array.isArray(role?.capabilities) ? role.capabilities : []),
    ...(Array.isArray(role?.requiredCapabilities) ? role.requiredCapabilities : []),
    ...(Array.isArray(role?.allowedCapabilities) ? role.allowedCapabilities : [])
  ])];
}

function contractError(errors, message = "Canonical role contract validation failed") {
  if (errors.length === 0) return;
  const error = new Error(message);
  error.name = "CanonicalRoleContractError";
  error.errors = errors;
  throw error;
}

/** Validate the minimum portable record contract before native artifact creation. */
export function assertNativeRoleRecords(roles) {
  assertCanonicalRoleRecords(roles);
  const errors = [];
  for (const [index, role] of roles.entries()) {
    const path = `/roles/${index}`;
    for (const capability of roleCapabilities(role)) {
      if (!SEMANTIC_CAPABILITY_SET.has(capability)) {
        errors.push({ code: "semantic-capability", path: `${path}/capabilities`, message: `unknown semantic capability ${String(capability)}` });
      }
    }
    if (typeof role.prompt !== "string" || role.prompt.trim().length === 0) {
      errors.push({ code: "prompt", path: `${path}/prompt`, message: "canonical role requires a non-empty prompt" });
    } else if (!isSafePortableRolePrompt(role.prompt)) {
      errors.push({ code: "prompt-safety", path: `${path}/prompt`, message: "portable role prompts cannot invoke vendor-native mutable or command tools" });
    }
    if (typeof role.purpose !== "string" || role.purpose.trim().length === 0) errors.push({ code: "purpose", path: `${path}/purpose`, message: "canonical role requires a non-empty purpose" });
    if (!Array.isArray(role.invariants) || role.invariants.length === 0 || role.invariants.some((invariant) => typeof invariant !== "string" || invariant.trim().length === 0)) errors.push({ code: "invariants", path: `${path}/invariants`, message: "canonical role requires non-empty string invariants" });
    if (!Array.isArray(role.dispatchCriteria) || role.dispatchCriteria.length === 0 || role.dispatchCriteria.some((criterion) => typeof criterion !== "string" || criterion.trim().length === 0)) errors.push({ code: "dispatch-criteria", path: `${path}/dispatchCriteria`, message: "canonical role requires non-empty string dispatch criteria" });
    if (!Array.isArray(role.routingKeywords) || role.routingKeywords.length === 0 || role.routingKeywords.some((keyword) => typeof keyword !== "string" || keyword.trim().length === 0)) errors.push({ code: "routing-keywords", path: `${path}/routingKeywords`, message: "canonical role requires non-empty string routing keywords" });
    if (!Array.isArray(role.capabilities) || role.capabilities.length === 0 || role.capabilities.some((capability) => typeof capability !== "string" || capability.trim().length === 0)) errors.push({ code: "capabilities", path: `${path}/capabilities`, message: "canonical role requires non-empty string capabilities" });
    if (!Object.hasOwn(role, "mutationScope")) errors.push({ code: "mutation-scope", path: `${path}/mutationScope`, message: "canonical role requires an explicit mutation scope" });
    const evidence = role.evidenceContract;
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) || !Array.isArray(evidence.required) || evidence.required.length === 0 || evidence.required.some((item) => typeof item !== "string" || item.trim().length === 0) || typeof evidence.format !== "string" || evidence.format.trim().length === 0 || !Array.isArray(evidence.limitations) || evidence.limitations.length === 0 || evidence.limitations.some((item) => typeof item !== "string" || item.trim().length === 0)) {
      errors.push({ code: "evidence-contract", path: `${path}/evidenceContract`, message: "canonical role requires a complete evidence contract" });
    }
    const input = role.inputContract;
    if (!input || (typeof input === "string" ? input.trim().length === 0 : typeof input !== "object" || Array.isArray(input) || Object.keys(input).length === 0)) {
      errors.push({ code: "input-contract", path: `${path}/inputContract`, message: "canonical role inputContract must be non-empty" });
    }
    const output = role.outputContract;
    const outputEvidenceValid = typeof output?.evidence === "string"
      ? output.evidence.trim().length > 0
      : Array.isArray(output?.evidence) && output.evidence.length > 0 && output.evidence.every((item) => typeof item === "string" && item.trim().length > 0);
    if (!output || typeof output !== "object" || Array.isArray(output) || !outputEvidenceValid) {
      errors.push({ code: "output-contract", path: `${path}/outputContract`, message: "canonical role outputContract must declare non-empty evidence" });
    }
  }
  contractError(errors, "Native canonical role contract validation failed");
}

/** Enforce role mutation semantics before a native adapter creates artifacts. */
export function assertNativeRoleSemantics(roles) {
  const errors = [];
  if (!Array.isArray(roles)) return;
  for (const [index, role] of roles.entries()) {
    if (!isCanonicalRoleId(role?.id)) continue;
    const path = `/roles/${index}`;
    const capabilities = roleCapabilities(role);
    const privilegedCapabilities = capabilities.filter((capability) => PRIVILEGED_CAPABILITY_SET.has(capability));
    if (privilegedCapabilities.length > 0) {
      errors.push({ code: "privileged-capability", path: `${path}/capabilities`, message: `canonical role cannot declare privileged capability ${privilegedCapabilities.join(", ")}` });
    }
    const unknownCapabilities = capabilities.filter((capability) => !SEMANTIC_CAPABILITY_SET.has(capability));
    for (const capability of unknownCapabilities) {
      errors.push({ code: "semantic-capability", path: `${path}/capabilities`, message: `unknown semantic capability ${String(capability)}` });
    }
    const mutationCapabilities = capabilities.filter((capability) => WRITE_CAPABILITY_SET.has(capability));
    if (role.id !== "implementer") {
      if (mutationCapabilities.length > 0) {
        errors.push({ code: "mutation-scope", path: `${path}/capabilities`, message: `read-only role cannot declare ${mutationCapabilities.join(", ")}` });
      }
      if (role.mutationScope !== "none") {
        errors.push({ code: "mutation-scope", path: `${path}/mutationScope`, message: "every non-implementer role must use mutationScope none" });
      }
      continue;
    }
    if (mutationCapabilities.length === 0) {
      errors.push({ code: "semantic-capability", path: `${path}/capabilities`, message: `implementer must declare one of ${[...WRITE_SEMANTIC_CAPABILITIES].sort().join(", ")}` });
    }
    const scope = role.mutationScope;
    const validScope = scope && typeof scope === "object" && !Array.isArray(scope) &&
      Array.isArray(scope.paths) && scope.paths.length > 0 &&
      Array.isArray(scope.operations) && scope.operations.length > 0 &&
      scope.paths.every(isValidMutationScopePath) &&
      scope.operations.every(isValidMutationScopeOperation);
    if (!validScope || role.mutationScope === "full") {
      errors.push({ code: "mutation-scope", path: `${path}/mutationScope`, message: "implementer must declare non-empty scoped paths and operations" });
    }
  }
  if (errors.length > 0) {
    contractError(errors, "Native role semantic validation failed");
  }
}

/** Return explicit diagnostics for semantic capabilities suppressed by a surface policy. */
export function nativeCapabilityDiagnostics({ surface, role, mappings = {}, blockedNativeTools = [], unavailableCapabilities = [] } = {}) {
  if (isRoleReadOnly(role) || unavailableCapabilities.length > 0) return roleCapabilities(role).flatMap((capability) => {
    const mapped = Array.isArray(mappings[capability]) ? mappings[capability] : [];
    const blocked = mapped.filter((tool) => blockedNativeTools.includes(tool));
    if (blocked.length === 0 && !unavailableCapabilities.includes(capability)) return [];
    const retained = mapped.filter((tool) => !blocked.includes(tool));
    const reason = unavailableCapabilities.includes(capability)
      ? "no documented native tool vocabulary is available"
      : `native mapping ${blocked.join(", ")} is suppressed by the read-only policy`;
    const retainedNote = retained.length > 0 ? ` Safe read-only mapping retained: ${retained.join(", ")}.` : "";
    return [{
      code: "role-capability-unavailable",
      severity: "warning",
      message: `Role ${role.id} capability ${capability} is unavailable on ${surface}: ${reason}.${retainedNote} Manual/fail-closed guidance: do not infer support; use a documented read-only alternative or stop and ask for direction.`,
      sourcePath: `core/roles/${role.id}/role.json`
    }];
  });
  return [];
}

/** Explain that native workspace controls cannot enforce a narrower portable scope. */
export function nativeScopeDiagnostics(roles) {
  return roles.filter(hasNarrowerNativeScope).map((role) => ({
    code: "native-scope-not-enforced",
    severity: "warning",
    message: `Role implementer declares ${role.mutationScope.paths.join(", ")}, but native workspace controls are workspace-wide and cannot enforce those paths. The task scope remains an outer approval boundary; fail closed when it is not independently approved.`,
    sourcePath: "core/roles/implementer/role.json"
  }));
}

/** Unknown or malformed roles are safe read-only values at native boundaries. */
export function isRoleReadOnly(role) {
  if (!role || typeof role !== "object" || Array.isArray(role)) return true;
  if (!isCanonicalRoleId(role.id)) return true;
  if (role.mutationScope === "none") return true;
  return writeCapabilities(role).length === 0;
}

export function hasScopedMutation(role) {
  return !isRoleReadOnly(role) && role?.mutationScope && typeof role.mutationScope === "object" && !Array.isArray(role.mutationScope) && role.mutationScope.paths?.length > 0;
}

/** Identify scopes narrower than the only native workspace-wide control. */
export function hasNarrowerNativeScope(role) {
  return role?.id === "implementer" && hasScopedMutation(role) && !(role.mutationScope.paths.length === 1 && role.mutationScope.paths[0] === "workspace/**");
}
