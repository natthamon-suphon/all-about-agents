import { Buffer } from "node:buffer";

export const GLOBAL_INSTRUCTION_LIMITS = Object.freeze({
  maxLinesExclusive: 160,
  maxCharactersExclusive: 8000,
  claudeMaxLinesExclusive: 200,
  geminiMaxCharactersExclusive: 12000,
  codexMaxBytesExclusive: 32768
});

export const GLOBAL_INSTRUCTION_SOURCE_PATH = "core/instructions/global-operating-rules.md";
const HTML_TAG_PATTERN = /<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s+[^<>]*?)?\/?\s*>|<!--[\s\S]*?-->|<!DOCTYPE\b[^>]*>/iu;
const CSS_AT_RULE_PATTERN = /@(?:-webkit-)?(?:keyframes|media|supports|font-face|import)\b/iu;
const CSS_RULE_PATTERN = /\{[^{}\r\n]*-{0,2}[A-Za-z][\w-]*\s*:\s*[^{}\r\n]+\}/u;
const CSS_DECLARATION_PATTERN = /(?:^|[\n;])\s*(?!https?\b)-{0,2}[A-Za-z][\w-]*\s*:\s*[^{}\r\n;]+;/imu;
const CSS_GRADIENT_PATTERN = /\b(?:linear|radial|conic)-gradient\s*\(/iu;
const POSITIVE_PRESENTATION_PATTERN = /\b(?:use|add|apply|enable|include|insert|inject|style|animate)\b[^\n;,:.!?]{0,80}?\b(?:html|css|animation|animated|styles?|transitions?|gradients?)\b/giu;
const PRESENTATION_NEGATION_PATTERN = /\b(?:do\s+not|don't|never|must\s+not|without|not)\b/iu;
const CLAUSE_BOUNDARY_PATTERN = /[;,\n:.!?]|\b(?:but|however|except|instead)\b/giu;
const ANSI_PATTERN = /\u001b/u;

function issue(code, path, message) {
  return { code, path, message };
}

function normalizedSourcePath(sourcePath) {
  return typeof sourcePath === "string" && sourcePath.trim().length > 0 ? sourcePath : GLOBAL_INSTRUCTION_SOURCE_PATH;
}

function metricsFor(content) {
  return {
    characters: [...content].length,
    lines: content.split("\n").length,
    bytes: Buffer.byteLength(content, "utf8")
  };
}

function hasUnsafeMarkup(content) {
  const visibleContent = content.replace(/`+[^`\r\n]+`+/gu, "");
  const positiveInstruction = [...visibleContent.matchAll(POSITIVE_PRESENTATION_PATTERN)].some((match) => {
    let clauseStart = 0;
    for (const boundary of visibleContent.matchAll(CLAUSE_BOUNDARY_PATTERN)) {
      if (boundary.index >= match.index) break;
      clauseStart = boundary.index + boundary[0].length;
    }
    const clausePrefix = visibleContent.slice(clauseStart, match.index).slice(-64);
    return !PRESENTATION_NEGATION_PATTERN.test(clausePrefix) && !PRESENTATION_NEGATION_PATTERN.test(match[0]);
  });
  return HTML_TAG_PATTERN.test(visibleContent)
    || CSS_AT_RULE_PATTERN.test(visibleContent)
    || CSS_RULE_PATTERN.test(visibleContent)
    || CSS_DECLARATION_PATTERN.test(visibleContent)
    || CSS_GRADIENT_PATTERN.test(visibleContent)
    || positiveInstruction;
}

/** Validate one canonical, portable global instruction document. */
export function validateGlobalInstructionBody({ sourcePath, content } = {}) {
  const path = normalizedSourcePath(sourcePath);
  if (typeof content !== "string") {
    return { valid: false, errors: [issue("invalid-global-instructions", path, "global instructions content must be a string")], metrics: { characters: 0, lines: 0, bytes: 0 } };
  }

  const metrics = metricsFor(content);
  const errors = [];
  if (content.trim().length === 0) errors.push(issue("invalid-global-instructions", path, "global instructions must contain a non-empty body"));
  if (content.startsWith("\uFEFF")) errors.push(issue("global-instructions-bom", path, "global instructions must not start with a UTF-8 BOM"));
  if (content.includes("\r")) errors.push(issue("global-instructions-line-endings", path, "global instructions must use LF line endings"));
  if (metrics.lines >= GLOBAL_INSTRUCTION_LIMITS.maxLinesExclusive || metrics.characters >= GLOBAL_INSTRUCTION_LIMITS.maxCharactersExclusive) {
    errors.push(issue("global-instructions-too-long", path, `global instructions exceed the ${GLOBAL_INSTRUCTION_LIMITS.maxLinesExclusive}-line or ${GLOBAL_INSTRUCTION_LIMITS.maxCharactersExclusive}-character limit`));
  }
  if (hasUnsafeMarkup(content)) {
    errors.push(issue("global-instructions-html", path, "global instructions must not contain HTML, CSS, or animation markup"));
  }
  if (ANSI_PATTERN.test(content)) errors.push(issue("global-instructions-ansi", path, "global instructions must not contain raw ANSI escape bytes"));
  return { valid: errors.length === 0, errors, metrics };
}

/** Return a validated global body from a loaded core object. */
export function globalInstructionContent(core) {
  if (!core || typeof core !== "object" || Array.isArray(core)) throw new TypeError("core must be an object");
  const globalInstructions = core.globalInstructions;
  if (!globalInstructions || typeof globalInstructions !== "object" || Array.isArray(globalInstructions)) throw new TypeError("core.globalInstructions must be an object");
  if (globalInstructions.sourcePath !== GLOBAL_INSTRUCTION_SOURCE_PATH) throw new TypeError(`core.globalInstructions.sourcePath must equal ${GLOBAL_INSTRUCTION_SOURCE_PATH}`);
  if (typeof globalInstructions.content !== "string") throw new TypeError("core.globalInstructions.content must be a string");
  const result = validateGlobalInstructionBody({ sourcePath: globalInstructions.sourcePath, content: globalInstructions.content });
  if (!result.valid) throw new TypeError(`core.globalInstructions is invalid: ${result.errors.map((error) => error.message).join("; ")}`);
  return globalInstructions.content;
}
