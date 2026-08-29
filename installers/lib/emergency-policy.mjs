const DEFAULT_RULE_IDS = Object.freeze([
  "filesystem-root-erasure",
  "raw-disk-destruction",
  "git-force-push",
  "git-history-rewrite",
  "git-discard-uncommitted",
  "secret-credential-access",
  "secret-output-or-transmission",
  "guardrail-bypass"
]);

const REASONS = Object.freeze({
  "filesystem-root-erasure": "Denied: broad or unresolved filesystem erasure is an emergency action.",
  "raw-disk-destruction": "Denied: raw-disk or partition destruction is an emergency action.",
  "git-force-push": "Denied: force-push would rewrite shared Git history.",
  "git-history-rewrite": "Denied: destructive Git history rewriting is an emergency action.",
  "git-discard-uncommitted": "Denied: this operation can discard uncommitted user work.",
  "secret-credential-access": "Denied: credential or secret-store access is an emergency action.",
  "secret-output-or-transmission": "Denied: secret output or transmission is an emergency action.",
  "guardrail-bypass": "Denied: disabling or bypassing safety guardrails is an emergency action."
});

const ABSOLUTE_PATH = /^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/u;
const SECRET_PATH = /(?:^|[\\/])(?:\.env(?!\.example(?:$|[\\/]))|\.npmrc|credentials?(?:\.json)?|token|secret|id_(?:rsa|dsa|ecdsa|ed25519)|private[_-]?key|\.ssh(?:[\\/]|$)|\.aws[\\/]credentials(?:$|[\\/]))/iu;
const EXAMPLE_PATH = /(?:^|[\\/])(?:\.env\.example|example\.(?:crt|cer|pem)|public[_-]?certificate)/iu;

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function text(value) {
  return typeof value === "string" ? value : "";
}

function normalized(value) {
  return text(value).replace(/[\u0000-\u001f\u007f]/gu, " ").toLowerCase();
}

function commandTokens(value) {
  const source = text(value);
  const tokens = [];
  let current = "";
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = "";
      else current += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/u.test(character)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}

function tokenName(value) {
  return normalized(value).split(/[\\/]/u).at(-1) || "";
}

function gitInvocation(command) {
  const tokens = commandTokens(command);
  const executableIndex = tokens.findIndex((token) => tokenName(token) === "git" || tokenName(token) === "git.exe");
  if (executableIndex < 0) return null;
  let index = executableIndex + 1;
  while (index < tokens.length) {
    const token = normalized(tokens[index]);
    if (token === "--") {
      index += 1;
      break;
    }
    if (!token.startsWith("-")) break;
    const takesValue = token === "-c" || token === "-C" || token === "--git-dir" || token === "--work-tree" || token === "--namespace" || token === "--config-env";
    index += 1;
    if (takesValue) index += 1;
  }
  const subcommand = tokenName(tokens[index] || "");
  return subcommand ? { subcommand, args: tokens.slice(index + 1).map(normalized) } : null;
}

function isPathLikeToken(value) {
  const candidate = text(value).trim();
  const lower = candidate.toLowerCase();
  return candidate.length > 0
    && !candidate.startsWith("-")
    && (candidate.includes("/") || candidate.includes("\\") || candidate.startsWith("~")
      || /^(?:\.env(?:\.example)?|\.ssh|\.aws|credentials?(?:\.json)?|id_(?:rsa|dsa|ecdsa|ed25519)|private[_-]?key)$/iu.test(lower));
}

export function extractCandidatePaths(command) {
  return [...new Set(commandTokens(command).filter(isPathLikeToken))];
}

function valuesFromPaths(paths) {
  if (!Array.isArray(paths)) return [];
  return paths.map((entry) => {
    if (typeof entry === "string") return { raw: entry, path: entry, kind: "" };
    if (!isPlainObject(entry)) return { raw: "", path: "", kind: "" };
    const path = text(entry.resolvedPath) || text(entry.path) || text(entry.filePath);
    return { raw: path, path, kind: normalized(entry.kind || entry.scope) };
  }).filter((entry) => entry.path.length > 0);
}

function operationText(value) {
  if (typeof value === "string") return normalized(value);
  if (!isPlainObject(value)) return "";
  return normalized([
    value.operation,
    value.action,
    value.kind,
    value.command,
    value.target,
    value.resource
  ].filter((entry) => typeof entry === "string").join(" "));
}

function cleanPath(value) {
  return text(value).trim().replace(/^['"]|['"]$/gu, "").replaceAll("\\", "/").replace(/\/{2,}/gu, (match) => match.startsWith("//") ? "//" : "/");
}

function pathKey(value) {
  const clean = cleanPath(value);
  if (/^[A-Za-z]:\//u.test(clean) || clean.startsWith("//")) return clean.toLowerCase();
  return clean;
}

function isAbsolute(value) {
  return ABSOLUTE_PATH.test(cleanPath(value));
}

function isContained(root, target) {
  const rootRaw = pathKey(root);
  const targetRaw = pathKey(target);
  const rootKey = rootRaw === "/" || /^[a-z]:\/$/u.test(rootRaw) ? rootRaw : rootRaw.replace(/\/+$/u, "");
  const targetKey = targetRaw === "/" || /^[a-z]:\/$/u.test(targetRaw) ? targetRaw : targetRaw.replace(/\/+$/u, "");
  if (!isAbsolute(rootKey) || !isAbsolute(targetKey)) return false;
  if (rootKey === targetKey) return false;
  return rootKey === "/" || /^[a-z]:\/$/u.test(rootKey)
    ? targetKey.startsWith(rootKey)
    : targetKey.startsWith(`${rootKey}/`);
}

function isDesignatedNarrowRoot(rootValue, root) {
  const designation = normalized(rootValue.designation);
  const kind = normalized(rootValue.kind || rootValue.scope);
  const designated = rootValue.disposable === true || designation === "disposable" || kind === "disposable";
  if (!designated) return false;
  if (/(?:root|home|workspace|repository|repo|drive|unc|device|volume|disk)/u.test(kind)) return false;
  const clean = cleanPath(root);
  const lower = clean.toLowerCase();
  if (clean.startsWith("//") || lower === "/" || /^[a-z]:\/$/u.test(lower)) return false;
  if (/^(?:\/(?:tmp|var\/tmp)|[a-z]:\/temp)$/u.test(lower)) return false;
  const segments = lower.split("/").filter(Boolean);
  const afterDrive = /^[a-z]:$/u.test(segments[0] || "") ? segments.slice(1) : segments;
  if (afterDrive.length === 0 || afterDrive.some((segment) => /^(?:home|users?|workspace|workspaces|repo(?:sitory)?|root|drive|windows|program files|system32)$/u.test(segment))) return false;
  return true;
}

function verifiedDisposableTargets(rootValue, pathEntries) {
  if (!isPlainObject(rootValue)) return false;
  const root = text(rootValue.resolvedPath) || text(rootValue.path);
  const resolved = rootValue.resolved === true || rootValue.status === "resolved";
  const attestation = rootValue.allTargetsContained === true
    || rootValue.containsAll === true
    || rootValue.targetsContained === true;
  if (!resolved || !attestation || !isAbsolute(root) || pathEntries.length === 0 || !isDesignatedNarrowRoot(rootValue, root)) return false;
  if (/(?:^|\/)\.\.?(?:\/|$)/u.test(cleanPath(root))) return false;
  const declaredTargets = Array.isArray(rootValue.targets) ? rootValue.targets.map((entry) => cleanPath(typeof entry === "string" ? entry : entry?.resolvedPath || entry?.path)).filter(Boolean) : null;
  if (!declaredTargets || declaredTargets.length !== pathEntries.length || declaredTargets.some((target) => !pathEntries.some((entry) => cleanPath(entry.path) === target))) return false;
  return pathEntries.every((entry) => {
    const target = cleanPath(entry.path);
    if (/(?:^|\/)\.\.?(?:\/|$)/u.test(target)) return false;
    return isContained(root, target) && !normalized(entry.kind).match(/(?:root|home|workspace|repository|drive)/u);
  });
}

function isRecursiveFlag(value) {
  const token = normalized(value);
  if (token === "/s" || token === "--recursive" || token === "--recurse" || token === "-recurse") return true;
  return /^-[a-z]*r[a-z]*$/u.test(token);
}

function recursiveErase(command, capability) {
  const tokens = commandTokens(command);
  const commandText = normalized(command);
  const capabilityText = normalized(capability);
  const recursiveCommands = new Set(["rm", "rmdir", "rd", "del", "erase", "shred", "remove-item"]);
  const recursiveIndex = tokens.findIndex((token) => recursiveCommands.has(tokenName(token)));
  const findIndex = tokens.findIndex((token) => tokenName(token) === "find");
  const recursiveCommand = recursiveIndex >= 0 && tokens.slice(recursiveIndex + 1).some(isRecursiveFlag);
  const findDelete = findIndex >= 0 && tokens.slice(findIndex + 1).some((token) => normalized(token) === "-delete");
  return recursiveCommand || findDelete || /(?:recursive|erase|wipe|delete[-_ ]all|filesystem[-_ ]root)/u.test(capabilityText) || /(?:^|\s)filesystem[-_ ]root(?:\s|$)/u.test(commandText);
}

function hasRawDiskDestruction(command, capability, operation) {
  const all = `${normalized(command)} ${normalized(capability)} ${operationText(operation)}`;
  return /(?:\b(?:format|fdisk|diskpart|mkfs|dd|wipefs|clear[-_ ]disk|remove[-_ ]partition)\b|(?:raw|physical)[-_ ]?(?:disk|device)|(?:partition|volume)[-_ ]?(?:delete|destroy|format)|\\\\\.\\[a-z]:)/u.test(all)
    && !/\b(?:format|formatting)\s+(?:text|json|date|number)/u.test(all);
}

function hasForcePush(command, operation) {
  const all = `${normalized(command)} ${operationText(operation)}`;
  const invocation = gitInvocation(command);
  if (invocation?.subcommand === "push") {
    return invocation.args.some((argument) => /^--force(?:-with-lease)?$/u.test(argument) || /^-f+$/u.test(argument) || /^\+[^:]+:[^:]+$/u.test(argument));
  }
  return /\bforce[-_ ]?push\b/u.test(all);
}

function hasHistoryRewrite(command, operation) {
  const all = `${normalized(command)} ${operationText(operation)}`;
  const invocation = gitInvocation(command);
  return ["rebase", "filter-branch", "filter-repo", "replace"].includes(invocation?.subcommand)
    || invocation?.subcommand === "reflog" && invocation.args[0] === "expire"
    || invocation?.subcommand === "commit" && invocation.args.includes("--amend")
    || /\b(?:history[-_ ]rewrite|rewrite[-_ ]history|amend[-_ ]commit)\b/u.test(all);
}

function hasDiscard(command, operation) {
  const all = `${normalized(command)} ${operationText(operation)}`;
  const invocation = gitInvocation(command);
  const discard = invocation?.subcommand === "clean" && invocation.args.some((argument) => /^-[a-z]*f[a-z]*$/u.test(argument))
    || ["checkout", "restore"].includes(invocation?.subcommand) && invocation.args.includes("--")
    || invocation?.subcommand === "reset" && invocation.args.includes("--hard")
    || invocation?.subcommand === "stash" && ["drop", "clear"].includes(invocation.args[0]);
  return discard
    || /\b(?:discard[-_ ]uncommitted|drop[-_ ]changes|delete[-_ ]uncommitted)\b/u.test(all);
}

function hasCredentialAccess(command, capability, operation, pathEntries) {
  const all = `${normalized(command)} ${normalized(capability)} ${operationText(operation)}`;
  const pathHit = pathEntries.some((entry) => {
    const path = cleanPath(entry.path);
    const traversal = /(?:^|\/)\.\.?(?:\/|$)/u.test(path);
    const sensitive = SECRET_PATH.test(path) || EXAMPLE_PATH.test(path);
    return sensitive && (!EXAMPLE_PATH.test(path) || traversal);
  });
  return pathHit || /(?:credential|secret|token|private[_-]?key|id_(?:rsa|dsa|ecdsa|ed25519)|secret[-_ ]store|password[-_ ]store)/u.test(all)
    && /(?:read|cat|type|head|tail|open|load|access|export|list|inspect|view|grep|find)/u.test(all);
}

function hasSecretOutput(command, capability, operation, pathEntries) {
  const all = `${normalized(command)} ${normalized(capability)} ${operationText(operation)}`;
  const secretPath = pathEntries.some((entry) => {
    const path = cleanPath(entry.path);
    const traversal = /(?:^|\/)\.\.?(?:\/|$)/u.test(path);
    const sensitive = SECRET_PATH.test(path) || EXAMPLE_PATH.test(path);
    return sensitive && (!EXAMPLE_PATH.test(path) || traversal);
  });
  const secretMarker = /(?:\$[a-z_][a-z0-9_]*|%[a-z_][a-z0-9_]*%|token|secret|password|private[_-]?key|credential)/u.test(all);
  return secretPath && /(?:print|printf|echo|cat|type|write|send|post|put|upload|curl|wget|invoke-webrequest|scp|nc|transmit|log)/u.test(all)
    || secretMarker && /(?:echo|printf|printenv|set\b|env\b|curl|wget|invoke-webrequest|scp|nc|transmit|upload|send|post|put|log)/u.test(all);
}

function hasGuardrailBypass(command, capability, operation) {
  const all = `${normalized(command)} ${normalized(capability)} ${operationText(operation)}`;
  return /(?:dangerously-skip-permissions|dangerously-bypass|bypass[-_ ]?permissions|full[-_ ]?access|disable[-_ ]?(?:safety|guard|hook|deny)|skip[-_ ]?(?:safety|guard|hook|verification)|hooks?\s+(?:off|disable)|permissions?\s+(?:off|disable)|--no-verify\b|(?:approval[-_ ]policy|sandbox)\s+(?:never|danger-full-access)|--no-sandbox\b)/u.test(all);
}

function ruleIds(policy) {
  if (!isPlainObject(policy)) return DEFAULT_RULE_IDS;
  const ids = policy.orderedRuleIds;
  if (!Array.isArray(ids) || ids.length !== DEFAULT_RULE_IDS.length || ids.some((id, index) => id !== DEFAULT_RULE_IDS[index])) return DEFAULT_RULE_IDS;
  return DEFAULT_RULE_IDS;
}

function decision(reasonId) {
  return { decision: "deny", ruleId: reasonId, reason: REASONS[reasonId] || "Denied: emergency action requires explicit review." };
}

/**
 * Pure, data-only emergency classifier. It never invokes a shell or reads
 * ambient state. A verified disposable-root exception is intentionally strict.
 */
export function classifyEmergencyAction(input = {}) {
  const { capability = "", command = "", paths = [], gitOperation = null, secretOperation = null, verifiedDisposableRoot = null, policy = null } = isPlainObject(input) ? input : {};
  const pathEntries = [...valuesFromPaths(paths), ...valuesFromPaths(extractCandidatePaths(command))]
    .filter((entry, index, entries) => entries.findIndex((candidate) => cleanPath(candidate.path) === cleanPath(entry.path)) === index);
  const checks = {
    "filesystem-root-erasure": () => {
      if (!recursiveErase(command, capability)) return false;
      return !verifiedDisposableTargets(verifiedDisposableRoot, pathEntries);
    },
    "raw-disk-destruction": () => hasRawDiskDestruction(command, capability, gitOperation),
    "git-force-push": () => hasForcePush(command, gitOperation),
    "git-history-rewrite": () => hasHistoryRewrite(command, gitOperation),
    "git-discard-uncommitted": () => hasDiscard(command, gitOperation),
    "secret-credential-access": () => hasCredentialAccess(command, capability, secretOperation, pathEntries),
    "secret-output-or-transmission": () => hasSecretOutput(command, capability, secretOperation, pathEntries),
    "guardrail-bypass": () => hasGuardrailBypass(command, capability, secretOperation)
  };
  for (const ruleId of ruleIds(policy)) if (checks[ruleId]?.()) return decision(ruleId);
  return { decision: "allow", ruleId: null, reason: "Allowed: no emergency rule matched." };
}

export { DEFAULT_RULE_IDS, REASONS };
