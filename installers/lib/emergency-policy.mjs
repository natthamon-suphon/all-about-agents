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

function substitutionBodies(source) {
  const bodies = [];
  let quote = "";
  const balanced = (start) => {
    let depth = 1;
    let nestedQuote = "";
    for (let index = start + 1; index < source.length; index += 1) {
      const character = source[index];
      if (nestedQuote) {
        if (character === nestedQuote) nestedQuote = "";
        continue;
      }
      if (character === "'" || character === '"') {
        nestedQuote = character;
        continue;
      }
      if (character === "(") depth += 1;
      else if (character === ")") {
        depth -= 1;
        if (depth === 0) return { body: source.slice(start + 1, index), end: index };
      }
    }
    return null;
  };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote === "'") {
      if (character === "'") quote = "";
      continue;
    }
    if (quote === '"' && character !== "$" && character !== "`") {
      if (character === '"') quote = "";
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "`" || (character === "$" && source[index + 1] === "(")) {
      const start = character === "`" ? index : index + 1;
      if (character === "`") {
        const end = source.indexOf("`", index + 1);
        if (end >= 0) {
          bodies.push(source.slice(index + 1, end));
          index = end;
        }
      } else {
        const match = balanced(start);
        if (match) {
          bodies.push(match.body);
          index = match.end;
        }
      }
    }
  }
  return bodies;
}

function commandTokens(value) {
  const source = text(value);
  const tokens = [];
  let current = "";
  let quote = "";
  const flush = () => {
    if (current.length > 0) {
      tokens.push(current);
      current = "";
    }
  };
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
      flush();
      continue;
    }
    // Split shell operators even when the caller omitted surrounding spaces.
    // This is lexical inspection only; no shell is ever invoked here.
    if (character === ";" || character === "&" || character === "|" || character === "<" || character === ">") {
      flush();
      const next = source[index + 1];
      if ((character === "&" && next === "&") || (character === "|" && next === "|") || (character === ">" && next === ">") || (character === "<" && next === "<")) index += 1;
      continue;
    }
    current += character;
  }
  flush();
  for (const body of substitutionBodies(source)) tokens.push(...commandTokens(body));
  return tokens;
}

function commandSegments(value) {
  const source = text(value);
  const segments = [];
  let current = "";
  let quote = "";
  const flush = () => {
    if (current.trim().length > 0) segments.push(current.trim());
    current = "";
  };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      current += character;
      if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (character === ";" || character === "&" || character === "|" || character === "\n" || character === "\r") {
      flush();
      const next = source[index + 1];
      if ((character === "&" && next === "&") || (character === "|" && next === "|")) index += 1;
      continue;
    }
    current += character;
  }
  flush();
  return segments;
}

const SHELL_INTERPRETERS = new Set(["sh", "bash", "dash", "zsh", "ksh", "fish", "cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe"]);
const SHELL_COMMAND_OPTIONS = new Set(["-c", "--command", "-command", "/c", "/k", "/command"]);
const SHELL_OPAQUE_OPTIONS = new Set(["-file", "/file", "-encodedcommand", "/encodedcommand", "-commandwithargs", "/commandwithargs"]);

function lexicalWords(value) {
  const source = text(value);
  const words = [];
  let current = "";
  let quote = "";
  const flush = () => {
    if (current.length > 0) {
      words.push(current);
      current = "";
    }
  };
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
    if (/\s/u.test(character) || character === ";" || character === "&" || character === "|" || character === "<" || character === ">") {
      flush();
      const next = source[index + 1];
      if ((character === "&" && next === "&") || (character === "|" && next === "|") || (character === ">" && next === ">") || (character === "<" && next === "<")) index += 1;
      continue;
    }
    current += character;
  }
  flush();
  return words;
}

function commandVariants(value) {
  const variants = [];
  const seen = new Set();
  const visit = (source, depth) => {
    if (depth > 8) return;
    for (const segment of commandSegments(source)) {
      const key = segment;
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push(segment);
      for (const record of shellInvocationRecords(segment)) if (record.payload) visit(record.payload, depth + 1);
      for (const body of substitutionBodies(segment)) visit(body, depth + 1);
    }
  };
  visit(value, 0);
  return variants;
}

function hasDynamicShellPayload(value) {
  const source = normalized(value);
  if (/\b(?:invoke-expression|iex)\b/u.test(source) || /(?:^|[\s;|])&\s*[$%`({]/u.test(source)) return true;
  const seen = new Set();
  const visit = (source, depth) => {
    if (depth > 8) return false;
    for (const segment of commandSegments(source)) {
      const key = `${depth}:${segment}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const record of shellInvocationRecords(segment)) {
        if (record.opaque || record.dynamic) return true;
        if (record.payload && visit(record.payload, depth + 1)) return true;
      }
    }
    return false;
  };
  return visit(value, 0);
}

function tokenName(value) {
  return normalized(value).split(/[\\/]/u).at(-1) || "";
}

function commandName(value) {
  const raw = normalized(value).replace(/[\\^`]/gu, "");
  return /(?:^|[:/])([^:/]+)$/u.exec(raw)?.[1] || tokenName(value);
}

function shellInvocationRecords(value) {
  const records = [];
  for (const segment of commandSegments(value)) {
    const words = lexicalWords(segment);
    let index = 0;
    while (index < words.length && ["sudo", "command", "builtin"].includes(tokenName(words[index]))) index += 1;
    const interpreter = tokenName(words[index] || "");
    if (!SHELL_INTERPRETERS.has(interpreter)) continue;
    const next = normalized(words[index + 1] || "");
    if (!next) {
      records.push({ opaque: true, dynamic: false, attached: false, payload: "" });
      continue;
    }
    const opaque = SHELL_OPAQUE_OPTIONS.has(next)
      || [...SHELL_OPAQUE_OPTIONS].some((option) => next.startsWith(option) && next.length > option.length);
    if (opaque) {
      records.push({ opaque: true, dynamic: false, attached: false, payload: text(words[index + 2]).trim() });
      continue;
    }
    const exactOption = SHELL_COMMAND_OPTIONS.has(next);
    const attachedOption = next.startsWith("-c") && !next.startsWith("-command") && next.length > 2
      || next.startsWith("/c") && next.length > 2
      || next.startsWith("--command=")
      || next.startsWith("-command") && next.length > "-command".length
      || next.startsWith("/command") && next.length > "/command".length;
    if (exactOption || attachedOption) {
      let payload = "";
      if (attachedOption) {
        if (next.startsWith("--command=")) payload = next.slice("--command=".length);
        else if (next.startsWith("/command")) payload = next.slice("/command".length);
        else if (next.startsWith("-command")) payload = next.slice("-command".length);
        else payload = next.slice(2);
        if (next.startsWith("--command=") && words.length > index + 2) {
          payload = [payload, ...words.slice(index + 2)].join(" ").trim();
        }
      } else payload = words.slice(index + 2).join(" ").trim();
      const shortAttached = attachedOption
        && next.startsWith("-c")
        && !next.startsWith("-command")
        && !next.startsWith("--command");
      const compactOpaque = shortAttached
        && !isBenignInterpreterPayload(payload)
        && !/^[({*]/u.test(payload)
        && !/\s/u.test(payload);
      records.push({
        opaque: !payload
          || payload === "-"
          || tokenName(lexicalWords(payload)[0] || "") === "call"
          || compactOpaque,
        dynamic: hasDynamicShellSyntax(payload),
        attached: attachedOption,
        payload
      });
      continue;
    }
    const script = words.slice(index + 1).join(" ").trim();
    records.push({ opaque: true, dynamic: hasDynamicShellSyntax(script), attached: false, payload: script });
  }
  return records;
}

function hasDynamicShellSyntax(value) {
  const source = text(value);
  return /(?:\$\{|\$\(|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%|![A-Za-z_][A-Za-z0-9_]*!|`)/u.test(source)
    || /\b(?:get-variable|invoke-expression|iex|environment\]::|process[.]env)\b/u.test(normalized(source));
}

function isBenignInterpreterPayload(value) {
  const words = lexicalWords(value);
  const executable = tokenName(words[0] || "");
  if (["echo", "printf", "true", "false", "write-output", "write-host"].includes(executable)) return true;
  const invocation = gitInvocation(value);
  if (invocation?.subcommand === "status" || invocation?.subcommand === "log") return true;
  if (invocation?.subcommand === "checkout" && invocation.args.length === 1 && !/[\\/]/u.test(invocation.args[0])) return true;
  return false;
}

function gitInvocation(command) {
  const tokens = commandTokens(command);
  const gitName = (token) => {
    const raw = normalized(token).replace(/[\\^`]/gu, "");
    return /(?:^|[:/])git(?:[.](?:exe|cmd))?$/u.test(raw) ? "git" : tokenName(token);
  };
  const executableIndex = tokens.findIndex((token) => gitName(token) === "git" || gitName(token) === "git.exe");
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

function structuredGitRecords(value) {
  const records = [];
  if (typeof value === "string") {
    const invocation = gitInvocation(value);
    records.push({
      label: normalized(value),
      command: value,
      subcommand: invocation?.subcommand || "",
      args: invocation ? invocation.args : commandTokens(value)
    });
    return records;
  }
  const visit = (node, key, depth) => {
    if (!isPlainObject(node) || depth > 4) return;
    const command = text(node.command) || text(node.operation) || text(node.subcommand) || key;
    const parsed = typeof command === "string" && gitInvocation(command);
    const explicitArgs = Array.isArray(node.args) ? node.args.filter((entry) => typeof entry === "string").map(normalized) : [];
    const args = parsed ? [...parsed.args, ...explicitArgs] : explicitArgs;
    records.push({
      label: normalized(`${key} ${command}`),
      command,
      subcommand: parsed?.subcommand || normalized(command),
      args: node.force === true ? [...args, "--force"] : args
    });
    for (const [childKey, child] of Object.entries(node)) {
      if (isPlainObject(child)) visit(child, childKey, depth + 1);
    }
  };
  visit(value, "", 0);
  return records;
}

function structuredGitInvocation(record) {
  if (record?.subcommand === "git" && record.args.length > 0) {
    return { subcommand: record.args[0], args: record.args.slice(1) };
  }
  return { subcommand: record?.subcommand || "", args: record?.args || [] };
}

function pathTokenValue(value) {
  const candidate = text(value).trim();
  const path = candidate.startsWith("@") ? candidate.slice(1) : candidate;
  const lower = path.toLowerCase();
  return path.length > 0
    && !path.startsWith("-")
    && (path.includes("/") || path.includes("\\") || path.startsWith("~")
      || /^(?:\.env(?:\.example)?|\.ssh|\.aws|credentials?(?:\.json)?|id_(?:rsa|dsa|ecdsa|ed25519)|private[_-]?key)$/iu.test(lower))
    ? path
    : "";
}

function optionPathValue(value) {
  const candidate = text(value).trim();
  const match = /^--?[A-Za-z][A-Za-z0-9_-]*(?:=|:)(.+)$/u.exec(candidate);
  return match && pathTokenValue(match[1]) ? match[1].startsWith("@") ? match[1].slice(1) : match[1] : "";
}

export function extractCandidatePaths(command) {
  const candidates = [];
  for (const token of commandTokens(command)) {
    const path = pathTokenValue(token);
    if (path) candidates.push(path);
    const optionValue = optionPathValue(token);
    if (optionValue) candidates.push(optionValue);
  }
  return [...new Set(candidates)];
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
  const resourceValues = [];
  for (const resource of [value.resource, ...(Array.isArray(value.resources) ? value.resources : [])]) {
    if (typeof resource === "string") resourceValues.push(resource);
    else if (isPlainObject(resource)) {
      for (const key of ["path", "resolvedPath", "filePath", "uri", "target", "url", "name"]) {
        if (typeof resource[key] === "string") resourceValues.push(resource[key]);
      }
    }
  }
  return normalized([
    value.operation,
    value.action,
    value.kind,
    value.command,
    value.path,
    value.target,
    ...resourceValues
  ].filter((entry) => typeof entry === "string").join(" "));
}

function operationPaths(value) {
  const extractOperationPaths = (source) => extractCandidatePaths(source).filter((candidate) => /[\\/]/u.test(candidate) || /^[.~]/u.test(candidate) || /^[A-Za-z]:/u.test(candidate));
  if (typeof value === "string") return extractOperationPaths(value);
  if (!isPlainObject(value)) return [];
  const paths = [];
  for (const resource of [value.resource, ...(Array.isArray(value.resources) ? value.resources : [])]) {
    if (typeof resource === "string") paths.push(resource);
    else if (isPlainObject(resource)) {
      for (const key of ["path", "resolvedPath", "filePath", "uri", "target", "url", "name"]) {
        if (typeof resource[key] === "string") paths.push(resource[key]);
      }
    }
  }
  for (const key of ["path", "target"]) if (typeof value[key] === "string") paths.push(value[key]);
  for (const key of ["command", "operation"]) if (typeof value[key] === "string") paths.push(...extractOperationPaths(value[key]));
  return paths;
}

function cleanPath(value) {
  return text(value).trim().replace(/^['"]|['"]$/gu, "").replaceAll("\\", "/").replace(/\/{2,}/gu, (match) => match.startsWith("//") ? "//" : "/");
}

function hasDynamicPathSyntax(value) {
  const raw = text(value).trim();
  return /(?:\$\{|\$\(|\(|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%|![A-Za-z_][A-Za-z0-9_]*!|[*?{}^]|\[[^\]]*\]|`)/u.test(raw);
}

function isPublicExampleArtifact(value) {
  const segments = cleanPath(value).split("/").filter(Boolean);
  const basename = segments.at(-1) || "";
  return /^(?:\.env\.example|example\.(?:crt|cer|pem)|public[_-]?certificate)$/iu.test(basename);
}

function pathKey(value) {
  const clean = cleanPath(value);
  if (/^[A-Za-z]:\//u.test(clean) || clean.startsWith("//")) return clean.toLowerCase();
  return clean;
}

function isUnsafeNativeNamespace(value) {
  const raw = text(value).trim().replace(/^['"]|['"]$/gu, "");
  if (!raw) return false;
  const native = raw.replaceAll("/", "\\").toLowerCase();
  if (["\\??\\", "\\\\??\\", "\\?\\", "\\\\?\\", "\\.\\", "\\\\.\\", "\\device\\", "\\\\device\\"].some((prefix) => native.startsWith(prefix))) return true;
  const clean = cleanPath(raw).toLowerCase();
  return ["/??/", "//??/", "/?./", "//?./", "/?/", "//?/", "/./", "//./", "/device/", "//device/"].some((prefix) => clean.startsWith(prefix));
}

function isAbsolute(value) {
  const raw = text(value).trim().replace(/^['"]|['"]$/gu, "");
  if (/^\\(?!\\)/u.test(raw)) return false;
  return ABSOLUTE_PATH.test(cleanPath(raw));
}

function isContained(root, target) {
  if (isUnsafeNativeNamespace(root) || isUnsafeNativeNamespace(target)) return false;
  if (!isAbsolute(root) || !isAbsolute(target)) return false;
  const rootRaw = pathKey(root);
  const targetRaw = pathKey(target);
  const rootKey = rootRaw === "/" || /^[a-z]:\/$/u.test(rootRaw) ? rootRaw : rootRaw.replace(/\/+$/u, "");
  const targetKey = targetRaw === "/" || /^[a-z]:\/$/u.test(targetRaw) ? targetRaw : targetRaw.replace(/\/+$/u, "");
  if (rootKey === targetKey) return false;
  return rootKey === "/" || /^[a-z]:\/$/u.test(rootKey)
    ? targetKey.startsWith(rootKey)
    : targetKey.startsWith(`${rootKey}/`);
}

function isDesignatedNarrowRoot(rootValue, root) {
  if (isUnsafeNativeNamespace(root)) return false;
  if (hasDynamicPathSyntax(root)) return false;
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
  if (isUnsafeNativeNamespace(root) || hasDynamicPathSyntax(root) || pathEntries.some((entry) => isUnsafeNativeNamespace(entry.path) || hasDynamicPathSyntax(entry.path))) return false;
  if (!resolved || !attestation || !isAbsolute(root) || pathEntries.length === 0 || !isDesignatedNarrowRoot(rootValue, root)) return false;
  if (/(?:^|\/)\.\.?(?:\/|$)/u.test(cleanPath(root))) return false;
  const declaredTargets = Array.isArray(rootValue.targets) ? rootValue.targets.map((entry) => cleanPath(typeof entry === "string" ? entry : entry?.resolvedPath || entry?.path)).filter(Boolean) : null;
  if (!declaredTargets || declaredTargets.some(hasDynamicPathSyntax) || declaredTargets.length !== pathEntries.length || declaredTargets.some((target) => !pathEntries.some((entry) => cleanPath(entry.path) === target))) return false;
  return pathEntries.every((entry) => {
    const target = cleanPath(entry.path);
    if (/(?:^|\/)\.\.?(?:\/|$)/u.test(target)) return false;
    return isContained(root, target) && !normalized(entry.kind).match(/(?:root|home|workspace|repository|drive)/u);
  });
}

function isRecursiveFlag(value) {
  const token = normalized(value);
  if (token === "/s" || token === "--recursive" || token === "--recurse" || token === "-recurse") return true;
  if (/^-(?:recurse|r)(?::|=).+$/u.test(token)) return true;
  return /^-[a-z]*r[a-z]*$/u.test(token);
}

function recursiveErase(command, capability) {
  const variants = commandVariants(command);
  const commandText = normalized(command);
  const capabilityText = normalized(capability);
  const dynamicCallOperator = /&\s*[$%`({]/u.test(text(command));
  const recursiveCommands = new Set(["rm", "rmdir", "rd", "del", "erase", "shred", "remove-item"]);
  const dynamicToken = (token) => /(?:\$|%[A-Za-z_]|![A-Za-z_]|`|[{}^])/u.test(text(token));
  const recursiveCommand = variants.some((variant) => {
    const tokens = lexicalWords(variant);
    const recursiveIndex = tokens.findIndex((token) => recursiveCommands.has(commandName(token)));
    if (recursiveIndex >= 0) {
      const argumentsAfterCommand = tokens.slice(recursiveIndex + 1);
      return argumentsAfterCommand.some(isRecursiveFlag)
        || argumentsAfterCommand.some((token) => dynamicToken(token) && /(?:flag|opt|recur|recursive)/iu.test(token));
    }
    const dynamicExecutable = tokens.findIndex((token) => dynamicToken(token) && !token.startsWith("-"));
    if (dynamicCallOperator && dynamicExecutable >= 0) return false;
    return dynamicExecutable >= 0 && tokens.slice(dynamicExecutable + 1).some((token) => isRecursiveFlag(token) || dynamicToken(token));
  });
  const findDelete = variants.some((variant) => {
    const tokens = lexicalWords(variant);
    const findIndex = tokens.findIndex((token) => tokenName(token) === "find");
    return findIndex >= 0 && tokens.slice(findIndex + 1).some((token) => normalized(token) === "-delete");
  });
  return recursiveCommand || findDelete || /(?:recursive|erase|wipe|delete[-_ ]all|filesystem[-_ ]root)/u.test(capabilityText) || /(?:^|\s)filesystem[-_ ]root(?:\s|$)/u.test(commandText);
}

function hasRawDiskDestruction(command, capability, operation) {
  const rawDevicePath = /(?:\/dev\/[^\s"']+|[\\/]{1,2}(?:\?\?|[.?]|device)[\\/][^\s"']+)/u;
  const destructiveUtility = /(?:\b(?:fdisk|diskpart|mkfs|dd|wipefs|shred|sgdisk|parted|sfdisk|cfdisk|partprobe|clear[-_ ]disk|remove[-_ ]disk|remove[-_ ]partition|remove-volume|blkdiscard)\b|\bdiskutil\s+(?:erase(?:disk|volume)|partitiondisk|apfs\s+(?:deletevolume|resizecontainer))\b|\b(?:hdparm)\b[^;|&]*\bsecurity[-_ ]?erase\b|\b(?:mdadm)\b[^;|&]*\bzero[-_ ]?superblock\b|(?:raw|physical)[-_ ]?(?:disk|device)|(?:partition|volume)[-_ ]?(?:delete|destroy|format)|\\\\\.\\[a-z]:)/u;
  const formatCommand = (segment) => {
    const tokens = commandTokens(segment);
    const executable = tokenName(tokens[0] || "");
    if (executable !== "format" && executable !== "format.exe" && executable !== "format.com") return false;
    return !(tokens.length === 2 && ["text", "json", "date", "number"].includes(normalized(tokens[1])));
  };
  const isUnsafeSegment = (segment) => {
    const value = normalized(segment).trim();
    const rawDeviceOperation = rawDevicePath.test(value) && /(?:>{1,2}|\b(?:set-content|out-file|add-content|copy-item|move-item|rename-item|remove-item|format|fdisk|diskpart|mkfs|dd|wipefs|shred|sgdisk|parted|sfdisk|cfdisk|partprobe|clear[-_ ]disk|remove[-_ ]disk|remove[-_ ]partition|remove-volume|writeall(?:text|bytes|lines)|writebyte|filestream|file[.]open|file[.]copy|file[.]create|appendalltext)\b|\bfile\]::(?:open|copy|create|writebyte|appendalltext)\b)/u.test(value);
    return formatCommand(value) || rawDeviceOperation || destructiveUtility.test(value);
  };
  if (commandVariants(command).some(isUnsafeSegment)) return true;
  return isUnsafeSegment(`${normalized(capability)} ${operationText(operation)}`);
}

function hasForcePush(command, operation) {
  const all = `${normalized(command)} ${operationText(operation)}`;
  const forceArgument = (argument) => {
    const value = normalized(argument);
    const unescaped = value.replace(/[\\^`]/gu, "");
    return /^--(?:force(?:-with-lease)?|mirror)(?:=.*)?$/u.test(unescaped)
      || /^-f+$/u.test(unescaped)
      || /^\+.+/u.test(unescaped)
      || /(?:force|mirror)/u.test(unescaped) && /[\$%{}!`^\\]/u.test(value)
      || /^--[\$%{}!`^\\(]/u.test(value)
      || /^--[^\s=]+[\$%{}!`^\\(]/u.test(value)
      || /^--[^\s=]*[\$%{}!`^\\(][^\s=]*$/u.test(value);
  };
  if (commandVariants(command).some((variant) => {
    const invocation = gitInvocation(variant);
    return invocation?.subcommand === "push" && invocation.args.some(forceArgument);
  })) return true;
  if (commandVariants(command).some((variant) => {
    const tokens = lexicalWords(variant);
    const hasDynamicExecutable = tokens.some((token) => /[\$%{}!`^\\(]/u.test(token));
    return hasDynamicExecutable
      && tokens.some((token) => commandName(token) === "push")
      && tokens.some(forceArgument);
  })) return true;
  if (structuredGitRecords(operation).some((record) => {
    const invocation = structuredGitInvocation(record);
    return invocation.subcommand === "push" && invocation.args.some(forceArgument)
      || /(?:^|\s)push(?:\s|$)/u.test(record.label) && record.args.some(forceArgument);
  })) return true;
  if (/(?:\bgit\b|\bgit[.$%!?`^\\])/u.test(all) && /\bpush\b/u.test(all) && /(?:force|mirror|\+\S+)/u.test(all) && /[\$%{}!`^\\]/u.test(all)) return true;
  if (/\b(?:git|git[.$%!?`^\\])\s+[$%{}!`^\\(]/u.test(all) && /(?:force|mirror|\+\S+)/u.test(all)) return true;
  return /\bforce[-_ ]?push\b/u.test(all);
}

function hasHistoryRewrite(command, operation) {
  const all = `${normalized(command)} ${operationText(operation)}`;
  const historyRewrite = commandVariants(command).some((variant) => {
    const invocation = gitInvocation(variant);
    const tokens = lexicalWords(variant);
    const gitIndex = tokens.findIndex((token) => commandName(token) === "git");
    const dynamicSubcommand = gitIndex >= 0 && /[\$%{}!`^\\(]/u.test(tokens[gitIndex + 1] || "");
    const dynamicHistoryFlag = ["rebase", "commit", "reflog"].includes(invocation?.subcommand)
      && invocation.args.some((argument) => /[\$%{}!`^\\(]/u.test(argument));
    return ["rebase", "filter-branch", "filter-repo", "replace"].includes(invocation?.subcommand)
      || invocation?.subcommand === "reflog" && invocation.args[0] === "expire"
      || invocation?.subcommand === "commit" && invocation.args.includes("--amend")
      || invocation?.subcommand === "push" && invocation.args.includes("--delete")
      || dynamicSubcommand
      || dynamicHistoryFlag;
  });
  return historyRewrite || structuredGitRecords(operation).some((record) => {
    const invocation = structuredGitInvocation(record);
    const label = record.label;
    const args = invocation.args;
    const subcommand = invocation.subcommand;
    return /(?:^|\s)(?:rebase|filter-branch|filter-repo|replace)(?:\s|$)/u.test(label)
      || subcommand === "reflog" && args.includes("expire")
      || subcommand === "commit" && args.includes("--amend")
      || subcommand === "push" && args.includes("--delete")
      || /(?:^|\s)git(?:\s|$)/u.test(label) && /[\$%{}!`^\\(]/u.test(record.subcommand || "")
      || /(?:^|\s)(?:rebase|commit|reflog)(?:\s|$)/u.test(label) && args.some((argument) => /[\$%{}!`^\\(]/u.test(argument));
  })
    || /\b(?:history[-_ ]rewrite|rewrite[-_ ]history|amend[-_ ]commit)\b/u.test(all);
}

function hasDiscard(command, operation) {
  const all = `${normalized(command)} ${operationText(operation)}`;
  const forceFlag = (argument) => /^-[a-z]*f[a-z]*$/u.test(argument) || /^--force(?:=.*)?$/u.test(argument);
  const pathArgument = (argument) => argument === "." || argument === ".." || /[\\/]/u.test(argument) || /\.[a-z0-9]{1,32}$/u.test(argument)
    || /^(?:readme|license|copying|changelog|dockerfile|makefile)$/iu.test(argument);
  const branchArgument = (argument) => /^(?:main|master|develop(?:ment)?|branch|feature(?:[-/][a-z0-9._-]+)?|release(?:[-/][a-z0-9._-]+)?|hotfix(?:[-/][a-z0-9._-]+)?|staging|stage|trunk|default|head(?:[~^][0-9]*)?)$/iu.test(argument);
  const checkoutPathArgument = (argument) => !branchArgument(argument) && (pathArgument(argument) || /^[^-'"]+$/u.test(argument));
  const discard = commandVariants(command).some((variant) => {
    const invocation = gitInvocation(variant);
    const nonOptions = invocation?.args.filter((argument) => !argument.startsWith("-")) || [];
    return invocation?.subcommand === "clean" && invocation.args.some(forceFlag)
      || invocation?.subcommand === "clean" && invocation.args.some((argument) => argument === "." || argument === "..")
      || ["checkout", "restore"].includes(invocation?.subcommand) && invocation.args.some((argument) => argument === "--" || forceFlag(argument) || argument === "--discard-changes" || argument === "." || argument === ".." || argument.startsWith("--pathspec-from-file"))
      || invocation?.subcommand === "restore" && (invocation.args.some((argument) => argument === "--staged" || argument === "--worktree" || argument.startsWith("--source")) || invocation.args.some((argument) => !argument.startsWith("-")))
      || invocation?.subcommand === "checkout" && (nonOptions.length > 1 || nonOptions.some(checkoutPathArgument) || invocation.args.some((argument) => argument.startsWith("--pathspec-from-file")))
      || invocation?.subcommand === "checkout-index" && invocation.args.some(forceFlag)
      || invocation?.subcommand === "read-tree" && invocation.args.includes("-m") && invocation.args.includes("-u")
      || invocation?.subcommand === "switch" && invocation.args.some((argument) => forceFlag(argument) || argument === "--discard-changes")
      || invocation?.subcommand === "reset" && invocation.args.includes("--hard")
      || invocation?.subcommand === "stash" && ["drop", "clear"].includes(invocation.args[0]);
  });
  const structuredDiscard = structuredGitRecords(operation).some((record) => {
    const invocation = structuredGitInvocation(record);
    const args = invocation.args;
    const subcommand = invocation.subcommand;
    const label = record.label;
    const nonOptions = args.filter((argument) => !argument.startsWith("-"));
    return subcommand === "checkout" && (nonOptions.length > 1 || nonOptions.some(checkoutPathArgument) || args.some((argument) => argument.startsWith("--pathspec-from-file")))
      || subcommand === "restore" && (nonOptions.length > 1 || nonOptions.some(pathArgument) || args.some((argument) => argument.startsWith("--pathspec-from-file") || argument === "--staged" || argument === "--worktree" || argument.startsWith("--source")))
      || subcommand === "checkout-index" && args.some(forceFlag)
      || subcommand === "read-tree" && args.includes("-m") && args.includes("-u")
      || subcommand === "switch" && args.some((argument) => forceFlag(argument) || argument === "--discard-changes")
      || subcommand === "clean" && (args.some(forceFlag) || args.includes(".") || args.includes(".."))
      || subcommand === "reset" && args.includes("--hard")
      || subcommand === "stash" && args.some((argument) => ["drop", "clear"].includes(argument));
  });
  return discard || structuredDiscard
    || /\b(?:discard[-_ ]uncommitted|drop[-_ ]changes|delete[-_ ]uncommitted)\b/u.test(all);
}

function hasCredentialAccess(command, capability, operation, pathEntries) {
  const all = `${normalized(command)} ${normalized(capability)} ${operationText(operation)}`;
  const pathHit = pathEntries.some((entry) => {
    const path = cleanPath(entry.path);
    const traversal = /(?:^|\/)\.\.?(?:\/|$)/u.test(path);
    return traversal || SECRET_PATH.test(path) && !isPublicExampleArtifact(path);
  });
  return pathHit || /(?:credential|secret|token|private[_-]?key|id_(?:rsa|dsa|ecdsa|ed25519)|secret[-_ ]store|password[-_ ]store)/u.test(all)
    && /(?:read|cat|type|head|tail|open|load|access|export|list|inspect|view|grep|find)/u.test(all);
}

function hasSecretOutput(command, capability, operation, pathEntries) {
  const all = `${normalized(command)} ${normalized(capability)} ${operationText(operation)}`;
  const secretPath = pathEntries.some((entry) => {
    const path = cleanPath(entry.path);
    const traversal = /(?:^|\/)\.\.?(?:\/|$)/u.test(path);
    return traversal || SECRET_PATH.test(path) && !isPublicExampleArtifact(path);
  });
  const secretMarker = /(?:\$[a-z_][a-z0-9_]*|%[a-z_][a-z0-9_]*%|![a-z_][a-z0-9_]*!|token|secret|password|private[_-]?key|credential|env:|process[.]env|environment[.]getenvironmentvariable|environment\]::getenvironmentvariable)/u.test(all);
  const commandAfterWrappers = (tokens) => {
    let index = 0;
    while (index < tokens.length && ["sudo", "command", "builtin"].includes(tokenName(tokens[index]))) index += 1;
    return { name: tokenName(tokens[index] || ""), args: tokens.slice(index + 1).map(normalized) };
  };
  const environmentDump = commandVariants(command).some((segment) => {
    const tokens = commandTokens(segment);
    const commandInfo = commandAfterWrappers(tokens);
    const cmdSet = tokenName(tokens[0] || "") === "cmd"
      && tokens.some((token, index) => tokenName(token) === "set" && tokens.slice(index + 1).every((argument) => !argument.includes("=")));
    return ["printenv", "env"].includes(commandInfo.name)
      || commandInfo.name === "export" && commandInfo.args.includes("-p")
      || commandInfo.name === "set" && (commandInfo.args.length === 0 || commandInfo.args.every((argument) => !argument.includes("=")))
      || cmdSet;
  })
    || commandSegments(operationText(operation)).some((segment) => ["printenv", "env"].includes(tokenName(commandTokens(segment)[0])))
    || /(?:\$\(|`)\s*(?:printenv|env)\b/u.test(normalized(command));
  const environmentProvider = /\benv\s*:/u.test(all) && /(?:get-content|get-item|cat|type|read|print|echo|write|copy|export)/u.test(all);
  const processEnvironment = /(?:process[.]env|os[.]environ|os[.]getenv|environment[.]getenvironmentvariable|environment\]::getenvironmentvariable)/u.test(all);
  const dynamicSecretRead = commandVariants(command).some((segment) => {
    const tokens = commandTokens(segment);
    const commandInfo = commandAfterWrappers(tokens);
    return ["cat", "type", "get-content"].includes(commandInfo.name) && commandInfo.args.some(hasDynamicPathSyntax);
  });
  return environmentDump || environmentProvider || processEnvironment || dynamicSecretRead
    || secretPath && /(?:print|printf|echo|cat|type|get-content|write|send|post|put|upload|curl|wget|invoke-webrequest|scp|nc|transmit|log)/u.test(all)
    || secretMarker && /(?:echo|print|printf|printenv|set\b|env\b|export\b|curl|wget|invoke-webrequest|scp|nc|transmit|upload|send|post|log)/u.test(all);
}

function hasGuardrailBypass(command, capability, operation) {
  const all = `${normalized(command)} ${normalized(capability)} ${operationText(operation)}`;
  const scan = all.replace(/["']/gu, "");
  const dynamicGuardrailValue = /--(?:approval[-_ ]?policy|sandbox|bypass(?:[-_ ]?permissions)?)(?:\s*(?:=|:)\s*|\s+)([^\s;|]+)/gu;
  for (const match of scan.matchAll(dynamicGuardrailValue)) {
    if (/[\$%!]\w|\$\{|\$\(|`|\^|\\|\(|\)|\{|\}/u.test(match[1])) return true;
  }
  return hasDynamicShellPayload(command)
    || /(?:dangerously-skip-permissions|dangerously-bypass|bypass[-_ ]?permissions|full[-_ ]?access|disable[-_ ]?(?:safety|guard|hook|deny)|skip[-_ ]?(?:safety|guard|hook|verification)|hooks?\s+(?:off|disable)|permissions?\s+(?:off|disable)|--no-verify\b|(?:approval[-_ ]policy|sandbox)\s*(?:=|:|\s+)\s*(?:never|danger-full-access)\b|--no-sandbox\b)/u.test(scan)
    || /--(?:approval[-_ ]?policy|sandbox|bypass(?:[-_ ]?permissions)?)(?:\s*(?:=|:)\s*|\s+)[`$%!^\\({]/u.test(scan)
    || /--bypass(?:[-_ ]?permissions)?(?:[-_ ]+)[`$%!^\\({]/u.test(scan)
    || /--bypass(?:[-_ ]?permissions)?[`$%!^\\{(]/u.test(scan);
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
  const pathEntries = [...valuesFromPaths(paths), ...valuesFromPaths(extractCandidatePaths(command)), ...valuesFromPaths(operationPaths(secretOperation))]
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
