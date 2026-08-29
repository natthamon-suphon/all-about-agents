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

const CANONICAL_ROLE_SET = new Set(CANONICAL_ROLE_IDS);
const WRITE_CAPABILITY_SET = new Set(WRITE_SEMANTIC_CAPABILITIES);
const IMPLEMENTER_SCOPE_OPERATIONS = new Set(["create", "modify", "delete"]);

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
  return [
    ...(Array.isArray(role?.capabilities) ? role.capabilities : []),
    ...(Array.isArray(role?.requiredCapabilities) ? role.requiredCapabilities : []),
    ...(Array.isArray(role?.allowedCapabilities) ? role.allowedCapabilities : [])
  ]
    .filter((capability) => WRITE_CAPABILITY_SET.has(capability));
}

/** Enforce role mutation semantics before a native adapter creates artifacts. */
export function assertNativeRoleSemantics(roles) {
  const errors = [];
  if (!Array.isArray(roles)) return;
  for (const [index, role] of roles.entries()) {
    if (!isCanonicalRoleId(role?.id)) continue;
    const path = `/roles/${index}`;
    const mutationCapabilities = writeCapabilities(role);
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
      scope.paths.every((scopePath) => typeof scopePath === "string" && /^workspace(?:\/|$)/u.test(scopePath) && !scopePath.includes("..")) &&
      scope.operations.every((operation) => IMPLEMENTER_SCOPE_OPERATIONS.has(operation));
    if (!validScope || role.mutationScope === "full") {
      errors.push({ code: "mutation-scope", path: `${path}/mutationScope`, message: "implementer must declare non-empty scoped paths and operations" });
    }
  }
  if (errors.length > 0) {
    const error = new Error("Native role semantic validation failed");
    error.name = "CanonicalRoleContractError";
    error.errors = errors;
    throw error;
  }
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
