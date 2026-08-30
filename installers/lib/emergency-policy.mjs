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
const MAX_SOURCE_LENGTH = 32_768;
const MAX_TOKEN_COUNT = 2_048;
const MAX_SEPARATOR_COUNT = 256;
const MAX_VARIANT_COUNT = 256;
const MAX_STRUCTURED_DEPTH = 6;
const MAX_STRUCTURED_NODES = 512;
const MAX_SUBSTITUTION_DEPTH = 32;
const MAX_WRAPPER_STEPS = 24;
const PARSER_OVERFLOW_RULE = "guardrail-bypass";

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
  if (source.length > MAX_SOURCE_LENGTH) return [];
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

function commandTokens(value, depth = 0, state = { count: 0 }) {
  const source = text(value);
  if (source.length > MAX_SOURCE_LENGTH || depth > MAX_SUBSTITUTION_DEPTH) return ["__emergency_parser_overflow__"];
  const tokens = [];
  let current = "";
  let quote = "";
  const flush = () => {
    if (current.length > 0) {
      tokens.push(current);
      current = "";
      state.count += 1;
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
  if (state.count > MAX_TOKEN_COUNT) return ["__emergency_parser_overflow__"];
  for (const body of substitutionBodies(source)) {
    if (depth >= MAX_SUBSTITUTION_DEPTH || state.count > MAX_TOKEN_COUNT) return ["__emergency_parser_overflow__"];
    tokens.push(...commandTokens(body, depth + 1, state));
    if (tokens.length > MAX_TOKEN_COUNT) return ["__emergency_parser_overflow__"];
  }
  return tokens;
}

function commandSegments(value) {
  const source = text(value);
  if (source.length > MAX_SOURCE_LENGTH) return [];
  const segments = [];
  let current = "";
  let quote = "";
  const flush = () => {
    if (current.trim().length > 0 && segments.length < MAX_VARIANT_COUNT) segments.push(current.trim());
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
const SHELL_PREFIXES = new Set(["sudo", "doas", "nice", "timeout", "env", "command", "builtin", "exec", "nohup", "if", "then"]);
const SHELL_VERSION_OPTIONS = new Set(["--version", "-version", "/version", "--help", "-help", "-h", "/?", "/help"]);

function hasDynamicToken(value) {
  return /(?:\$|%[A-Za-z_]|![A-Za-z_]|`|[{}^\\])/u.test(text(value));
}

function isAssignmentToken(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*\+?=/u.test(text(value));
}

function wrapperOptionTakesValue(wrapper, option) {
  const name = tokenName(wrapper);
  const flag = normalized(option);
  if (["sudo", "doas"].includes(name)) return ["-u", "--user", "-g", "--group", "-h", "--host"].includes(flag);
  if (name === "nice") return ["-n", "--adjustment"].includes(flag) || /^-[0-9]+$/u.test(flag);
  if (name === "timeout") return ["-k", "--kill-after"].includes(flag);
  if (name === "env") return flag === "-s";
  return false;
}

function wrapperEnd(words) {
  let index = 0;
  let steps = 0;
  while (index < words.length && steps++ < 24) {
    if (isAssignmentToken(words[index])) {
      index += 1;
      continue;
    }
    const name = tokenName(words[index]);
    if (!SHELL_PREFIXES.has(name)) break;
    // With no following assignment or executable, `env` is itself the
    // environment-dump command rather than a launcher prefix.
    if (name === "env" && index + 1 >= words.length) break;
    const wrapper = words[index];
    index += 1;
    while (index < words.length && steps++ < 24) {
      const option = normalized(words[index]);
      if (isAssignmentToken(words[index])) {
        index += 1;
        continue;
      }
      // `env -S` carries a split command string, so leave the following
      // executable visible to the interpreter scanner. Other wrapper
      // options (notably `sudo -u root`) consume their value as one unit.
      if (wrapperOptionTakesValue(wrapper, option) && !(name === "env" && option === "-s")) {
        index += 2;
        continue;
      }
      if (option.startsWith("-") && name !== "if") {
        index += 1;
        continue;
      }
      if (name === "timeout" && /^(?:[0-9]+(?:ms|s|m|h)?|[0-9]+(?:\.[0-9]+)?)$/u.test(option)) {
        index += 1;
        continue;
      }
      if (name === "if") {
        if (option === "then") {
          index += 1;
          break;
        }
        index += 1;
        continue;
      }
      break;
    }
  }
  return index;
}

function interpreterIndex(words) {
  const start = wrapperEnd(words);
  for (let index = start; index < Math.min(words.length, start + 24); index += 1) {
    if (SHELL_INTERPRETERS.has(tokenName(words[index]))) return index;
    if (index > start && !SHELL_PREFIXES.has(tokenName(words[index - 1])) && !isAssignmentToken(words[index - 1])) break;
  }
  return -1;
}

function lexicalWords(value) {
  const source = text(value);
  if (source.length > MAX_SOURCE_LENGTH) return ["__emergency_parser_overflow__"];
  const words = [];
  let current = "";
  let quote = "";
  const flush = () => {
    if (current.length > 0 && words.length < MAX_TOKEN_COUNT) {
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

function sourceShapeExceeded(value) {
  const source = text(value);
  if (source.length > MAX_SOURCE_LENGTH) return true;
  let substitutionDepth = 0;
  let separatorCount = 0;
  let tokenCount = 0;
  let tokenStarted = false;
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      tokenStarted = true;
      if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      tokenStarted = true;
      continue;
    }
    if (character === ";" || character === "&" || character === "|" || character === "\n" || character === "\r") separatorCount += 1;
    if (separatorCount >= MAX_SEPARATOR_COUNT) return true;
    if (/\s/u.test(character) || ";&|<>".includes(character)) {
      if (tokenStarted) {
        tokenCount += 1;
        tokenStarted = false;
      }
      if (tokenCount > MAX_TOKEN_COUNT) return true;
    } else tokenStarted = true;
    if (character === "$" && source[index + 1] === "(") {
      substitutionDepth += 1;
      if (substitutionDepth > MAX_SUBSTITUTION_DEPTH) return true;
      index += 1;
    } else if (character === ")" && substitutionDepth > 0) substitutionDepth -= 1;
  }
  return tokenCount + (tokenStarted ? 1 : 0) > MAX_TOKEN_COUNT;
}

function wrapperScanExceeded(value) {
  for (const segment of commandSegments(value)) {
    const words = lexicalWords(segment);
    let index = 0;
    let steps = 0;
    while (index < words.length && steps < MAX_WRAPPER_STEPS) {
      if (isAssignmentToken(words[index])) {
        steps += 1;
        index += 1;
        continue;
      }
      const name = tokenName(words[index]);
      if (!SHELL_PREFIXES.has(name)) break;
      const wrapper = words[index];
      index += 1;
      steps += 1;
      while (index < words.length && steps < MAX_WRAPPER_STEPS) {
        const option = normalized(words[index]);
        if (isAssignmentToken(words[index])) {
          steps += 1;
          index += 1;
          continue;
        }
        if (wrapperOptionTakesValue(wrapper, option)) {
          steps += 1;
          index += 1;
          if (index >= words.length) return true;
          steps += 1;
          index += 1;
          continue;
        }
        if (option.startsWith("-") || (name === "if" && option === "then")) {
          steps += 1;
          index += 1;
          continue;
        }
        break;
      }
    }
    if (index < words.length && steps >= MAX_WRAPPER_STEPS) return true;
  }
  return false;
}

function structuredBoundsExceeded(value, depth = 0, state = { nodes: 0 }, seen = new WeakSet()) {
  if (typeof value === "string") return sourceShapeExceeded(value);
  if (value === null || typeof value !== "object") return false;
  if (depth > MAX_STRUCTURED_DEPTH || state.nodes >= MAX_STRUCTURED_NODES) return true;
  if (seen.has(value)) return true;
  seen.add(value);
  state.nodes += 1;
  if (Array.isArray(value)) {
    if (value.length > MAX_STRUCTURED_NODES) return true;
    return value.some((entry) => structuredBoundsExceeded(entry, depth + 1, state, seen));
  }
  if (!isPlainObject(value)) return true;
  return Object.entries(value).some(([key, child]) => key !== "policy" && structuredBoundsExceeded(child, depth + 1, state, seen));
}

function structuredShapeInvalid(value, depth = 0, seen = new WeakSet()) {
  if (value === undefined || value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return false;
  if (Array.isArray(value)) return value.some((child) => structuredShapeInvalid(child, depth + 1, seen));
  if (!isPlainObject(value) || depth > MAX_STRUCTURED_DEPTH) return true;
  if (seen.has(value)) return true;
  seen.add(value);
  return Object.entries(value).some(([key, child]) => {
    if (key === "force" && typeof child !== "boolean") return true;
    if (key === "args" && !Array.isArray(child)) return true;
    if (key === "command" && typeof child !== "string" && !Array.isArray(child)) return true;
    return structuredShapeInvalid(child, depth + 1, seen);
  });
}

function parserBoundsExceeded(input) {
  if (!isPlainObject(input)) return true;
  if (Object.hasOwn(input, "command") && typeof input.command !== "string") return true;
  if (Object.hasOwn(input, "capability") && typeof input.capability !== "string") return true;
  if (Object.hasOwn(input, "paths") && !Array.isArray(input.paths)) return true;
  if (structuredShapeInvalid(input.gitOperation) || structuredShapeInvalid(input.secretOperation)) return true;
  if (structuredBoundsExceeded(input)) return true;
  return sourceShapeExceeded(input.command) || sourceShapeExceeded(input.capability) || wrapperScanExceeded(input.command);
}

function isDispatcherRunner(value) {
  const name = tokenName(value);
  return SHELL_INTERPRETERS.has(name) || SHELL_PREFIXES.has(name) || isNonShellRunnerName(value)
    || ["git", "git.exe", "git.cmd", "git.bat", "rm", "rmdir", "rd", "del", "erase", "remove-item", "ri", "clear-item", "srm"].includes(commandName(value));
}

function xargsOptionTakesValue(value) {
  const option = normalized(value).split("=", 1)[0];
  return [
    "-a", "--arg-file", "-d", "--delimiter", "-e", "--eof", "-i", "--replace",
    "-l", "--max-lines", "-n", "--max-args", "-p", "--max-procs", "-s", "--max-chars",
    "--process-slot-var"
  ].includes(option);
}

function dispatcherPayloads(value) {
  const payloads = [];
  for (const segment of commandSegments(value)) {
    const words = lexicalWords(segment);
    for (let index = 0; index < words.length; index += 1) {
      const name = tokenName(words[index]);
      if (name === "find") {
        for (let execIndex = index + 1; execIndex < words.length; execIndex += 1) {
          if (!["-exec", "-execdir"].includes(normalized(words[execIndex] || ""))) continue;
          const candidate = words.slice(execIndex + 1);
          const start = candidate.findIndex(isDispatcherRunner);
          if (start >= 0) payloads.push(candidate.slice(start).join(" "));
        }
      }
      if (name === "xargs") {
        const args = words.slice(index + 1);
        let commandIndex = 0;
        while (commandIndex < args.length) {
          const option = normalized(args[commandIndex]);
          if (option === "--") {
            commandIndex += 1;
            break;
          }
          if (option.startsWith("-") && !isDispatcherRunner(args[commandIndex])) {
            commandIndex += 1;
            if (xargsOptionTakesValue(option) && !option.includes("=") && commandIndex < args.length) commandIndex += 1;
            continue;
          }
          break;
        }
        const start = args.slice(commandIndex).findIndex(isDispatcherRunner);
        if (start >= 0) payloads.push(args.slice(commandIndex + start).join(" "));
      }
    }
  }
  return payloads;
}

function dispatcherRemovesFindTargets(value) {
  const segments = commandSegments(value);
  return segments.some((segment, index) => {
    const source = lexicalWords(segment);
    const findIndex = source.findIndex((word) => tokenName(word) === "find");
    if (findIndex < 0) return false;
    const sourceOperand = source.slice(findIndex + 1).find((word) => !word.startsWith("-") && word !== "!");
    if (!sourceOperand || !(sourceOperand === "." || sourceOperand === ".." || sourceOperand.startsWith("~") || isAbsolute(sourceOperand))) return false;
    const downstream = segments.slice(index + 1).find((candidate) => lexicalWords(candidate).some((word) => tokenName(word) === "xargs"));
    if (!downstream) return false;
    return dispatcherPayloads(downstream).some((payload) => {
      const words = lexicalWords(payload);
      return ["rm", "rmdir", "rd", "del", "erase", "remove-item", "ri", "clear-item", "srm"].includes(commandName(words[0] || ""));
    });
  });
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
      if (variants.length >= MAX_VARIANT_COUNT) return;
      variants.push(segment);
      for (const record of shellInvocationRecords(segment)) if (record.payload) visit(record.payload, depth + 1);
      for (const payload of dispatcherPayloads(segment)) visit(payload, depth + 1);
      for (const body of substitutionBodies(segment)) visit(body, depth + 1);
    }
  };
  visit(value, 0);
  return variants;
}

function hasDynamicShellPayload(value) {
  const source = normalized(value);
  if (/\b(?:invoke-expression|iex)\b/u.test(source) || /(?:^|[\s;|])&\s*[$%`({]/u.test(source)) return true;
  if (hasOpaqueScriptPayload(value)) return true;
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

function isScriptPathToken(value) {
  const token = normalized(value).replace(/^['"]|['"]$/gu, "");
  return token.length > 0
    && (token.startsWith("/") || token.startsWith("./") || token.startsWith("../") || /^[a-z]:[\\/]/u.test(token)
      || /\.(?:sh|bash|zsh|fish|ps1|psm1|bat|cmd|py|rb|pl|js|mjs|cjs)$/iu.test(token));
}

function isScriptRunnerName(value) {
  const name = tokenName(value);
  return /^(?:python(?:3(?:\.\d+)?)?|python3\.\d+|node(?:js)?|ruby|perl|deno|bun)$/u.test(name)
    || SHELL_INTERPRETERS.has(name);
}

function isNonShellRunnerName(value) {
  return /^(?:python(?:3(?:\.\d+)?)?|python3\.\d+|node(?:js)?|ruby|perl|deno|bun)$/u.test(tokenName(value));
}

function isOpaqueShellInputOption(value) {
  const option = normalized(value);
  return option === "-s" || option === "-i" || option === "-" || option === "--"
    || option.startsWith("--split-string") || option.startsWith("-s=") || option.startsWith("-s:");
}

function launchWords(words) {
  const start = wrapperEnd(words);
  return { start, words: words.slice(start) };
}

function hasOpaqueScriptPayload(value) {
  const interpreterExecutionOption = (option) => {
    const candidate = normalized(option);
    return ["-c", "-e", "--eval", "--command", "-command"].includes(candidate)
      || /^-(?:c|e)[^\s]/u.test(candidate);
  };
  for (const segment of commandSegments(value)) {
    const words = lexicalWords(segment);
    if (words.length === 0) continue;
    const { words: launched } = launchWords(words);
    const first = tokenName(words[0]);
    const launchedFirst = tokenName(launched[0] || "");
    const second = words[1] || "";
    const runnerNames = new Set(["sh", "bash", "dash", "zsh", "ksh", "fish", "python", "python3", "node", "ruby", "perl", "pwsh", "powershell", "deno", "bun"]);
    if (["source", ".", "eval", "invoke-expression", "iex"].includes(first)) return true;
    if (first === "call" || first === "start") {
      if (second && (isScriptPathToken(second) || hasDynamicToken(second))) return true;
    }
    if (isScriptPathToken(words[0]) || hasDynamicToken(words[0]) && first === "&") return true;
    if (runnerNames.has(first) && second && !second.startsWith("-") && isScriptPathToken(second)) return true;
    if (isScriptRunnerName(launchedFirst)) {
      if (isNonShellRunnerName(launchedFirst) && interpreterExecutionOption(launched[1] || "")) return true;
      if (isOpaqueShellInputOption(launched[1] || "")) return true;
      const candidate = launched[1] || "";
      const windowsInterpreterOption = ["cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe"].includes(launchedFirst) && candidate.startsWith("/");
      if (candidate && !candidate.startsWith("-") && !windowsInterpreterOption && isScriptPathToken(candidate)) return true;
      if (isNonShellRunnerName(launchedFirst)
        && candidate && !candidate.startsWith("-") && (hasDynamicToken(candidate) || isScriptPathToken(candidate))) return true;
    }
    if (["python", "python3", "node", "ruby", "perl", "pwsh", "powershell"].includes(first)
      && /(?:\b(?:exec|eval|system|spawn|popen|open|require|require_relative|runpy[.]run_(?:module|path)|import\s*\(|do\s+["']|child[_-]?process|start-process|invoke-command|invoke-expression|subprocess|shutil|fileutils)\b|fs[.]rm(?:sync)?\b|process[.]env|os[.]environ)/iu.test(words.slice(1).join(" "))) return true;
    if (["invoke-command", "start-job"].includes(first) && /\bscriptblock\b/iu.test(words.slice(1).join(" "))) return true;
    if ((isNonShellRunnerName(launchedFirst) || ["pwsh", "powershell"].includes(launchedFirst))
      && /(?:\b(?:exec|eval|system|spawn|popen|open|require|child[_-]?process|start-process|invoke-command|invoke-expression|subprocess|shutil|fileutils)\b|fs[.]rm(?:sync)?\b|process[.]env|os[.]environ|deno[.]env|bun[.]env)/iu.test(launched.slice(1).join(" "))) return true;
    if (first === "env") {
      const splitIndex = words.findIndex((word) => {
        const option = normalized(word);
        return option === "-s" || option.startsWith("-s=") || option.startsWith("-s:")
          || option === "--split-string" || option.startsWith("--split-string=") || option.startsWith("--split-string:");
      });
      if (splitIndex >= 0) return true;
    }
    if (first === "find") {
      for (const [index, word] of words.entries()) {
        if (["-exec", "-execdir"].includes(normalized(word))) {
          const candidateWords = words.slice(index + 1);
          const candidate = candidateWords[0] || "";
          if (isScriptPathToken(candidate) || hasDynamicToken(candidate)) return true;
          if (isScriptRunnerName(candidate) && (isOpaqueShellInputOption(candidateWords[1] || "") || isScriptPathToken(candidateWords[1] || "") || hasDynamicToken(candidateWords[1] || ""))) return true;
        }
      }
    }
    if (first === "xargs") {
      const args = words.slice(1);
      if (args.some(isScriptPathToken) || args.some(hasDynamicToken)) return true;
      if (args.some((word, index) => isScriptRunnerName(word) && (interpreterExecutionOption(args[index + 1] || "") || isOpaqueShellInputOption(args[index + 1] || "") || isScriptPathToken(args[index + 1] || "") || hasDynamicToken(args[index + 1] || "")))) return true;
      if (args.some((word, index) => tokenName(word) === "env" && isOpaqueShellInputOption(args[index + 1] || ""))) return true;
    }
    if (words.some((word) => ["source", ".", "eval", "invoke-expression", "iex"].includes(tokenName(word)))) return true;
    if (words.some((word, index) => index > 0 && isScriptPathToken(word) && ["then", "do", "else", "call", "start"].includes(tokenName(words[index - 1] || "")))) return true;
  }
  return false;
}

function shellInvocationRecords(value) {
  const records = [];
  for (const segment of commandSegments(value)) {
    const words = lexicalWords(segment);
    const index = interpreterIndex(words);
    const interpreter = tokenName(words[index] || "");
    if (!SHELL_INTERPRETERS.has(interpreter)) continue;
    let optionIndex = index + 1;
    let foundCommand = false;
    while (optionIndex < words.length && optionIndex < index + 32) {
      const next = normalized(words[optionIndex]);
      if (isOpaqueShellInputOption(next)) {
        records.push({ opaque: true, dynamic: true, attached: false, payload: text(words.slice(optionIndex + 1).join(" ")).trim() });
        foundCommand = true;
        break;
      }
      const opaque = SHELL_OPAQUE_OPTIONS.has(next)
        || [...SHELL_OPAQUE_OPTIONS].some((option) => next.startsWith(option) && next.length > option.length);
      if (opaque) {
        const attached = !SHELL_OPAQUE_OPTIONS.has(next);
        const payload = attached ? next.replace(/^(?:-file|\/file|-encodedcommand|\/encodedcommand|-commandwithargs|\/commandwithargs)/u, "") : text(words[optionIndex + 1]).trim();
        records.push({ opaque: true, dynamic: true, attached, payload });
        foundCommand = true;
        break;
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
          if ((next.startsWith("--command=") || next.startsWith("-command") || next.startsWith("/command")) && words.length > optionIndex + 1) {
            payload = [payload, ...words.slice(optionIndex + 1)].join(" ").trim();
          }
        } else payload = words.slice(optionIndex + 1).join(" ").trim();
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
            || compactOpaque
            || hasOpaqueScriptPayload(payload),
          dynamic: hasDynamicShellSyntax(payload),
          attached: attachedOption,
          payload
        });
        foundCommand = true;
        break;
      }
      if (SHELL_VERSION_OPTIONS.has(next)) {
        optionIndex += 1;
        continue;
      }
      const slashOption = ["cmd", "cmd.exe", "powershell", "powershell.exe", "pwsh", "pwsh.exe"].includes(interpreter) && next.startsWith("/");
      if (next.startsWith("-") || slashOption) {
        const takesValue = next === "-o" || next === "--option" || next === "-executionpolicy" || next === "/executionpolicy";
        optionIndex += takesValue ? 2 : 1;
        continue;
      }
      const script = words.slice(optionIndex).join(" ").trim();
      records.push({ opaque: true, dynamic: hasDynamicShellSyntax(script), attached: false, payload: script });
      foundCommand = true;
      break;
    }
    if (!foundCommand && optionIndex === index + 1 && words.length === optionIndex) {
      records.push({ opaque: true, dynamic: false, attached: false, payload: "" });
    }
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
    return /(?:^|[:/])git(?:[.](?:exe|cmd|bat))?$/u.test(raw) || /^git[.$%{}!^\\(]/u.test(raw) ? "git" : tokenName(token);
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
  const rawArgs = tokens.slice(index + 1);
  return subcommand ? { subcommand, args: rawArgs.map(normalized), rawArgs } : null;
}

function structuredGitRecords(value) {
  const records = [];
  if (typeof value === "string") {
    const invocation = gitInvocation(value);
    records.push({
      label: normalized(value),
      command: value,
      subcommand: invocation?.subcommand || "",
      args: invocation ? invocation.args : commandTokens(value),
      rawArgs: invocation?.rawArgs || []
    });
    return records;
  }
  const visit = (node, key, depth) => {
    if (depth > 6) return;
    if (typeof node === "string") {
      const invocation = gitInvocation(node);
      records.push({
        label: normalized(`${key} ${node}`),
        command: node,
        subcommand: invocation?.subcommand || tokenName(node),
        args: invocation ? invocation.args : commandTokens(node).map(normalized)
      });
      return;
    }
    if (Array.isArray(node)) {
      for (const [index, child] of node.entries()) visit(child, `${key}[${index}]`, depth + 1);
      return;
    }
    if (!isPlainObject(node)) return;
    const structuredText = (value) => Array.isArray(value)
      ? value.filter((entry) => typeof entry === "string").join(" ")
      : text(value);
    const command = structuredText(node.command) || structuredText(node.operation) || structuredText(node.subcommand) || key;
    const parsed = typeof command === "string" && gitInvocation(command);
    const explicitArgs = Array.isArray(node.args)
      ? node.args.flatMap((entry) => typeof entry === "string" ? [normalized(entry)] : isPlainObject(entry) ? Object.values(entry).filter((value) => typeof value === "string").map(normalized) : [])
      : [];
    const args = parsed ? [...parsed.args, ...explicitArgs] : explicitArgs;
    records.push({
      label: normalized(`${key} ${command}`),
      command,
      subcommand: parsed?.subcommand || normalized(command),
      args: node.force === true ? [...args, "--force"] : args,
      rawArgs: parsed?.rawArgs || []
    });
    for (const [childKey, child] of Object.entries(node)) {
      if (isPlainObject(child) || Array.isArray(child)) visit(child, childKey, depth + 1);
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
  const values = [];
  const visit = (node, depth) => {
    if (depth > 6) return;
    if (typeof node === "string") {
      values.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry, depth + 1);
      return;
    }
    if (!isPlainObject(node)) return;
    for (const [key, child] of Object.entries(node)) {
      if (["operation", "action", "kind", "command", "path", "target", "resource", "resources", "uri", "url", "name", "filePath", "resolvedPath", "args", "rebase", "push", "clean", "restore", "checkout", "stash"].includes(key)) visit(child, depth + 1);
      else if (isPlainObject(child) || Array.isArray(child)) visit(child, depth + 1);
    }
  };
  visit(value, 0);
  return normalized(values.join(" "));
}

function operationPaths(value) {
  const extractOperationPaths = (source) => extractCandidatePaths(source).filter((candidate) => /[\\/]/u.test(candidate) || /^[.~]/u.test(candidate) || /^[A-Za-z]:/u.test(candidate));
  if (typeof value === "string") return extractOperationPaths(value);
  if (!isPlainObject(value)) return [];
  const paths = [];
  const pathKeys = new Set(["path", "resolvedPath", "filePath", "uri", "target", "url", "name", "resource", "resources"]);
  const visit = (node, key, depth) => {
    if (depth > 6) return;
    if (typeof node === "string") {
      if (pathKeys.has(key)) paths.push(node);
      else if (["command", "operation"].includes(key)) paths.push(...extractOperationPaths(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const entry of node) visit(entry, key, depth + 1);
      return;
    }
    if (!isPlainObject(node)) return;
    for (const [childKey, child] of Object.entries(node)) visit(child, childKey, depth + 1);
  };
  visit(value, "", 0);
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

function verifiedDisposableTargets(rootValue, pathEntries, command) {
  if (!isPlainObject(rootValue)) return false;
  const root = text(rootValue.resolvedPath) || text(rootValue.path);
  const resolved = rootValue.resolved === true || rootValue.status === "resolved";
  const attestation = rootValue.allTargetsContained === true
    || rootValue.containsAll === true
    || rootValue.targetsContained === true;
  if (isUnsafeNativeNamespace(root) || hasDynamicPathSyntax(root) || pathEntries.some((entry) => isUnsafeNativeNamespace(entry.path) || hasDynamicPathSyntax(entry.path))) return false;
  const commandPaths = extractCandidatePaths(command);
  if (commandPaths.length === 0 || commandPaths.some(hasDynamicPathSyntax)) return false;
  if (!commandPaths.every((candidate) => pathEntries.some((entry) => cleanPath(entry.path) === cleanPath(candidate)))) return false;
  if (!resolved || !attestation || !isAbsolute(root) || pathEntries.length === 0 || !isDesignatedNarrowRoot(rootValue, root)) return false;
  if (/(?:^|\/)\.\.(?:\/|$)/u.test(cleanPath(root))) return false;
  const declaredTargets = Array.isArray(rootValue.targets) ? rootValue.targets.map((entry) => cleanPath(typeof entry === "string" ? entry : entry?.resolvedPath || entry?.path)).filter(Boolean) : null;
  if (!declaredTargets || declaredTargets.some(hasDynamicPathSyntax) || declaredTargets.length !== pathEntries.length || declaredTargets.some((target) => !pathEntries.some((entry) => cleanPath(entry.path) === target))) return false;
  return pathEntries.every((entry) => {
    const target = cleanPath(entry.path);
    if (/(?:^|\/)\.\.(?:\/|$)/u.test(target)) return false;
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
  const recursiveCommands = new Set(["rm", "rmdir", "rd", "del", "erase", "shred", "remove-item", "ri", "clear-item", "srm"]);
  const dynamicToken = (token) => /(?:\$|%[A-Za-z_]|![A-Za-z_]|`|[{}^])/u.test(text(token));
  const recursiveCommand = variants.some((variant) => {
    const tokens = lexicalWords(variant);
    const recursiveIndex = tokens.findIndex((token) => recursiveCommands.has(commandName(token)));
    if (recursiveIndex >= 0) {
      const argumentsAfterCommand = tokens.slice(recursiveIndex + 1);
      const explicitRecursive = argumentsAfterCommand.some(isRecursiveFlag);
      const dynamicArgument = argumentsAfterCommand.some(dynamicToken);
      const rawDeviceTarget = /\/dev\//iu.test(variant) || /(?:\\\\\.\\|\\\\device\\|physicaldrive)/iu.test(variant);
      // A dynamic Remove-Item target on a raw device belongs to the raw-disk
      // family; let that check win instead of mislabelling it as filesystem
      // recursion. All other unresolved destructive targets fail closed.
      if (commandName(tokens[recursiveIndex]) === "remove-item" && rawDeviceTarget && !explicitRecursive) return false;
      return explicitRecursive || dynamicArgument;
    }
    const executableStart = wrapperEnd(tokens);
    const dynamicExecutable = dynamicToken(tokens[executableStart] || "") && !tokens[executableStart].startsWith("-") ? executableStart : -1;
    if (dynamicCallOperator && dynamicExecutable >= 0) return false;
    return dynamicExecutable >= 0 && tokens.slice(dynamicExecutable + 1).some((token) => isRecursiveFlag(token) || dynamicToken(token));
  });
  const findDelete = variants.some((variant) => {
    const tokens = lexicalWords(variant);
    const findIndex = tokens.findIndex((token) => tokenName(token) === "find");
    return findIndex >= 0 && tokens.slice(findIndex + 1).some((token) => normalized(token) === "-delete");
  });
  const dispatcherDelete = dispatcherRemovesFindTargets(command);
  const enumeratePipeline = commandSegments(command).some((segment, index, segments) => {
    if (index >= segments.length - 1) return false;
    const source = lexicalWords(segment);
    const target = lexicalWords(segments[index + 1]);
    const enumerator = ["get-child-item", "get-childitem", "gci", "dir", "ls", "find", "ri", "del"].includes(tokenName(source[0] || ""));
    const remover = ["remove-item", "ri", "clear-item", "srm", "rm", "del", "erase"].includes(commandName(target[0] || ""));
    return enumerator && source.some(isRecursiveFlag) && remover;
  });
  return recursiveCommand || findDelete || dispatcherDelete || enumeratePipeline || /(?:recursive|erase|wipe|delete[-_ ]all|filesystem[-_ ]root)/u.test(capabilityText) || /(?:^|\s)filesystem[-_ ]root(?:\s|$)/u.test(commandText);
}

function hasRawDiskDestruction(command, capability, operation) {
  const rawDevicePath = /(?:\/dev\/[^\s"']+|[\\/]{1,2}(?:\?\?|[.?]|device)[\\/][^\s"']+)/u;
  const destructiveUtility = /(?:\b(?:fdisk|diskpart|mkfs|dd|wipefs|shred|sgdisk|parted|sfdisk|cfdisk|partprobe|clear[-_ ]disk|remove[-_ ]disk|remove[-_ ]partition|remove-volume|blkdiscard|cryptsetup|pvremove|truncate)\b|\b(?:nvme)\b[^;|&]*\bsanitize\b|\bdiskutil\s+(?:erase(?:disk|volume)|partitiondisk|apfs\s+(?:deletevolume|resizecontainer))\b|\b(?:hdparm)\b[^;|&]*\bsecurity[-_ ]?erase\b|\b(?:mdadm)\b[^;|&]*\bzero[-_ ]?superblock\b|(?:raw|physical)[-_ ]?(?:disk|device)|(?:partition|volume)[-_ ]?(?:delete|destroy|format)|\\\\\.\\[a-z]:)/u;
  const formatCommand = (segment) => {
    const tokens = commandTokens(segment);
    const executable = tokenName(tokens[0] || "");
    if (executable !== "format" && executable !== "format.exe" && executable !== "format.com") return false;
    return !(tokens.length === 2 && ["text", "json", "date", "number"].includes(normalized(tokens[1])));
  };
  const isUnsafeSegment = (segment) => {
    const value = normalized(segment).trim();
    const rawDeviceOperation = rawDevicePath.test(value) && /(?:>{1,2}|\b(?:set-content|add-content|clear-content|set-item|out-file|copy-item|move-item|rename-item|remove-item|format|fdisk|diskpart|mkfs|dd|wipefs|shred|sgdisk|parted|sfdisk|cfdisk|partprobe|clear[-_ ]disk|remove[-_ ]disk|remove[-_ ]partition|remove-volume|writeall(?:text|bytes|lines)|writebyte|filestream|file[.]open|file[.]copy|file[.]create|file[.]append|appendalltext|appendallbytes|createtext|appendtext|openwrite|truncate|cryptsetup|pvremove|nvme|cp|mv)\b|\bfile\]::(?:open|openwrite|copy|create|createtext|appendtext|writebyte|appendalltext|writealltext)\b)/u.test(value);
    const rawWriteHelper = /(?:\b(?:set-content|add-content|clear-content|set-item|out-file|copy-item|move-item|rename-item|remove-item|writeall(?:text|bytes|lines)|writebyte|filestream|file[.]open|file[.]openwrite|file[.]copy|file[.]create|file[.]append|createtext|appendtext|appendall(?:text|bytes)|openwrite|truncate|cryptsetup|pvremove|nvme|dd|cp|mv|tee(?:-object)?)\b|\bfile\]::(?:open|openwrite|copy|create|createtext|appendtext|writebyte|appendalltext|writealltext)\b)/u;
    const dynamicRawToken = hasDynamicToken(value) || /(?:^|\s)@[A-Za-z_][A-Za-z0-9_]*/u.test(value) || /\bget-variable\b/u.test(value);
    const dynamicRawOperation = dynamicRawToken && rawWriteHelper.test(value);
    const dynamicRawRedirection = /(?:>{1,2}|<)\s*[$%!`@({]/u.test(value);
    return formatCommand(value) || rawDeviceOperation || dynamicRawOperation || dynamicRawRedirection || destructiveUtility.test(value);
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
    return invocation?.subcommand === "push" && (invocation.args.some(forceArgument) || invocation.args.some(hasDynamicToken));
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
    return invocation.subcommand === "push" && (invocation.args.some(forceArgument) || invocation.args.some(hasDynamicToken))
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
      || invocation?.subcommand === "push" && (invocation.args.includes("--delete") || invocation.args.includes("-d") || invocation.args.some((argument) => argument.startsWith(":")))
      || invocation?.subcommand === "remote" && invocation.args.includes("-d")
      || invocation?.subcommand === "branch" && invocation.args.some((argument) => ["-d", "-D", "--delete"].includes(argument) || ["-f", "--force"].includes(argument))
      || invocation?.subcommand === "update-ref" && (invocation.args.some((argument) => ["-d", "--delete", "--stdin"].includes(argument)) || invocation.args.filter((argument) => !argument.startsWith("-")).length >= 2)
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
      || subcommand === "push" && (args.includes("--delete") || args.includes("-d") || args.some((argument) => argument.startsWith(":")))
      || subcommand === "remote" && args.includes("-d")
      || subcommand === "branch" && args.some((argument) => ["-d", "-D", "--delete"].includes(argument) || ["-f", "--force"].includes(argument))
      || subcommand === "update-ref" && (args.some((argument) => ["-d", "--delete", "--stdin"].includes(argument)) || args.filter((argument) => !argument.startsWith("-")).length >= 2)
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
  const destructiveAlias = /\balias\.[a-z0-9_.-]+\s+[^;|&]*(?:\bclean\b[^;|&]*-[^\s;|&]*f|\breset\b[^;|&]*--hard|\b(?:restore|checkout)\b[^;|&]*\.|\bstash\b[^;|&]*(?:clear|drop))/u.test(all);
  const discard = commandVariants(command).some((variant) => {
    const invocation = gitInvocation(variant);
    const nonOptions = invocation?.args.filter((argument) => !argument.startsWith("-")) || [];
    const dynamicDiscardArgument = invocation && ["clean", "stash", "restore", "checkout", "checkout-index", "read-tree", "switch", "reset"].includes(invocation.subcommand)
      && invocation.args.some(hasDynamicToken);
    return invocation?.subcommand === "clean" && invocation.args.some(forceFlag)
      || invocation?.subcommand === "clean" && invocation.args.some((argument) => argument === "." || argument === "..")
      || invocation?.subcommand === "clean" && /clean[.]requireforce\s*[=:]\s*false/u.test(normalized(variant))
      || invocation?.subcommand === "checkout" && (invocation.args.some((argument) => argument === "--" || forceFlag(argument) || argument === "--discard-changes" || argument === "." || argument === ".." || argument.startsWith("--pathspec-from-file")) || invocation.rawArgs?.some((argument) => argument === "-B"))
      || invocation?.subcommand === "restore" && invocation.args.some((argument) => argument === "--" || forceFlag(argument) || argument === "--discard-changes" || argument === "." || argument === ".." || argument.startsWith("--pathspec-from-file"))
      || invocation?.subcommand === "restore" && (invocation.args.some((argument) => argument === "--staged" || argument === "--worktree" || argument.startsWith("--source")) || invocation.args.some((argument) => !argument.startsWith("-")))
      || invocation?.subcommand === "checkout" && (nonOptions.length > 1 || nonOptions.some(checkoutPathArgument) || invocation.args.some((argument) => argument.startsWith("--pathspec-from-file")))
      || invocation?.subcommand === "checkout-index" && invocation.args.some(forceFlag)
      || invocation?.subcommand === "read-tree" && invocation.args.includes("-u") && (invocation.args.includes("-m") || invocation.args.includes("--reset"))
      || invocation?.subcommand === "switch" && (invocation.args.some((argument) => forceFlag(argument) || argument === "--discard-changes") || invocation.rawArgs?.some((argument) => argument === "-C"))
      || invocation?.subcommand === "reset" && invocation.args.includes("--hard")
      || invocation?.subcommand === "stash" && ["drop", "clear"].includes(invocation.args[0])
      || dynamicDiscardArgument;
  });
  const structuredDiscard = structuredGitRecords(operation).some((record) => {
    const invocation = structuredGitInvocation(record);
    const args = invocation.args;
    const subcommand = invocation.subcommand;
    const label = record.label;
    const nonOptions = args.filter((argument) => !argument.startsWith("-"));
    const dynamicDiscardArgument = ["clean", "stash", "restore", "checkout", "checkout-index", "read-tree", "switch", "reset"].includes(subcommand)
      && args.some(hasDynamicToken);
    return subcommand === "checkout" && (nonOptions.length > 1 || nonOptions.some(checkoutPathArgument) || args.some((argument) => argument.startsWith("--pathspec-from-file")) || record.rawArgs?.some((argument) => argument === "-B"))
      || subcommand === "restore" && (nonOptions.length > 1 || nonOptions.some(pathArgument) || args.some((argument) => argument.startsWith("--pathspec-from-file") || argument === "--staged" || argument === "--worktree" || argument.startsWith("--source")))
      || subcommand === "checkout-index" && args.some(forceFlag)
      || subcommand === "read-tree" && args.includes("-u") && (args.includes("-m") || args.includes("--reset"))
      || subcommand === "switch" && (args.some((argument) => forceFlag(argument) || argument === "--discard-changes") || record.rawArgs?.some((argument) => argument === "-C"))
      || subcommand === "clean" && (args.some(forceFlag) || args.includes(".") || args.includes(".."))
      || subcommand === "clean" && /clean[.]requireforce\s*[=:]\s*false/u.test(label)
      || subcommand === "reset" && args.includes("--hard")
      || subcommand === "stash" && args.some((argument) => ["drop", "clear"].includes(argument))
      || dynamicDiscardArgument;
  });
  const cleanConfiguredWithoutForce = /clean[.]requireforce\s*(?:=|:|\s)\s*false/u.test(all)
    && commandVariants(command).some((variant) => gitInvocation(variant)?.subcommand === "clean");
  return discard || structuredDiscard || cleanConfiguredWithoutForce || destructiveAlias
    || /\b(?:discard[-_ ]uncommitted|drop[-_ ]changes|delete[-_ ]uncommitted)\b/u.test(all);
}

function hasCredentialAccess(command, capability, operation, pathEntries) {
  const all = `${normalized(command)} ${normalized(capability)} ${operationText(operation)}`;
  const pathHit = pathEntries.some((entry) => {
    const path = cleanPath(entry.path);
    const traversal = /(?:^|\/)\.\.(?:\/|$)/u.test(path);
    return traversal || SECRET_PATH.test(path) && !isPublicExampleArtifact(path);
  });
  return pathHit || /(?:credential|secret|token|private[_-]?key|id_(?:rsa|dsa|ecdsa|ed25519)|secret[-_ ]store|password[-_ ]store)/u.test(all)
    && /(?:read|cat|type|head|tail|open|load|access|export|list|inspect|view|grep|find)/u.test(all);
}

function hasSecretOutput(command, capability, operation, pathEntries) {
  const all = `${normalized(command)} ${normalized(capability)} ${operationText(operation)}`;
  const secretPath = pathEntries.some((entry) => {
    const path = cleanPath(entry.path);
    const traversal = /(?:^|\/)\.\.(?:\/|$)/u.test(path);
    return traversal || SECRET_PATH.test(path) && !isPublicExampleArtifact(path);
  });
  const secretMarker = /(?:\$[a-z_][a-z0-9_]*|%[a-z_][a-z0-9_]*%|![a-z_][a-z0-9_]*!|token|secret|password|private[_-]?key|credential|env:|process[.]env|environment[.]getenvironmentvariable|environment\]::getenvironmentvariable)/u.test(all);
  const commandAfterWrappers = (tokens) => {
    const index = wrapperEnd(tokens);
    return { name: tokenName(tokens[index] || ""), args: tokens.slice(index + 1).map(normalized) };
  };
  const environmentDump = commandVariants(command).some((segment) => {
    const tokens = commandTokens(segment);
    const commandInfo = commandAfterWrappers(tokens);
    const envIndex = tokens.findIndex((token) => tokenName(token) === "env");
    const envArgs = envIndex >= 0 ? tokens.slice(envIndex + 1) : [];
    const wrappedEnvNoCommand = envIndex >= 0 && envArgs.every((argument) => isAssignmentToken(argument) || normalized(argument).startsWith("-"));
    const cmdSet = tokenName(tokens[0] || "") === "cmd"
      && tokens.some((token, index) => tokenName(token) === "set" && tokens.slice(index + 1).every((argument) => !argument.includes("=")));
    const directNullEnv = envIndex >= 0 && envArgs.some((token) => ["-0", "--null"].includes(normalized(token)));
    return directNullEnv
      || wrappedEnvNoCommand
      || ["printenv", "env", "declare", "typeset"].includes(commandInfo.name)
      || commandInfo.name === "export" && (commandInfo.args.length === 0 || commandInfo.args.includes("-p"))
      || commandInfo.name === "set" && (commandInfo.args.length === 0 || commandInfo.args.every((argument) => !argument.includes("=")))
      || cmdSet;
  })
    || commandSegments(operationText(operation)).some((segment) => ["printenv", "env", "declare", "typeset"].includes(tokenName(commandTokens(segment)[0])))
    || /(?:\$\(|`)\s*(?:printenv|env)\b/u.test(normalized(command))
    || /\benv\s+(?:-s|--split-string)(?:=|\s+)(?:printenv|env)\b/u.test(normalized(command));
  const environmentProvider = /(?:\benv\s*:|\/proc\/[^\s/]+\/environ\b)/u.test(all) && /(?:get-content|get-item|cat|type|read|print|echo|write|copy|export|head|tail|strings|xargs)/u.test(all);
  const processEnvironment = /(?:process\s*[.]\s*env|process\s*[\[({][^\]]*\]|os\s*[.]\s*(?:environ|getenv)|environment[.]getenvironmentvariable|environment\]::getenvironmentvariable|\b(?:python(?:3(?:[.]\d+)?)?|node(?:js)?|ruby|perl|deno|bun)\b[^;|&]*(?:\benv\b|\benviron(?:ment)?\b|%env\b|deno[.]env|bun[.]env))/u.test(all);
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
  const dynamicOptionName = all.split(/\s+/u).some((token) => /^--[^\s;|]*[$%`!{}^\\(]/u.test(token)
    || /^-(?:approval|sandbox|bypass|permission|guard|policy)[^\s;|]*[$%`!{}^\\(]/u.test(token));
  const dynamicHarnessArgument = commandSegments(command).some((segment) => {
    const words = lexicalWords(segment);
    const { words: launched } = launchWords(words);
    return ["codex", "codex.exe", "agy", "agy.exe", "claude", "claude.exe"].includes(tokenName(launched[0] || "")) && launched.slice(1).some(hasDynamicToken);
  });
  const dynamicProcessLaunch = commandSegments(command).some((segment) => {
    const words = lexicalWords(segment);
    return ["start-process", "invoke-command"].includes(tokenName(words[0] || "")) && words.slice(1).some(hasDynamicToken);
  });
  const dynamicGuardrailValue = /--(?:approval[-_ ]?policy|sandbox|bypass(?:[-_ ]?permissions)?)(?:\s*(?:=|:)\s*|\s+)([^\s;|]+)/gu;
  for (const match of scan.matchAll(dynamicGuardrailValue)) {
    if (/[\$%!]\w|\$\{|\$\(|`|\^|\\|\(|\)|\{|\}/u.test(match[1])) return true;
  }
  return hasDynamicShellPayload(command)
    || dynamicOptionName
    || dynamicHarnessArgument
    || dynamicProcessLaunch
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
  if (parserBoundsExceeded(input)) return decision(PARSER_OVERFLOW_RULE);
  const { capability = "", command = "", paths = [], gitOperation = null, secretOperation = null, verifiedDisposableRoot = null, policy = null } = isPlainObject(input) ? input : {};
  const pathEntries = [...valuesFromPaths(paths), ...valuesFromPaths(extractCandidatePaths(command)), ...valuesFromPaths(operationPaths(secretOperation))]
    .filter((entry, index, entries) => entries.findIndex((candidate) => cleanPath(candidate.path) === cleanPath(entry.path)) === index);
  const checks = {
    "filesystem-root-erasure": () => {
      if (!recursiveErase(command, capability)) return false;
      return !verifiedDisposableTargets(verifiedDisposableRoot, pathEntries, command);
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
