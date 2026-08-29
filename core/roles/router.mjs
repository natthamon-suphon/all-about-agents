import { assertCanonicalRoleRecords, CANONICAL_ROLE_IDS } from "./contract.mjs";

const CANONICAL_ROLE_SET = new Set(CANONICAL_ROLE_IDS);

// Intent phrases avoid routing on generic single words such as "review",
// "risk", "write", or "run". The role IDs still come from the loaded core;
// this table only defines the deterministic production scoring policy.
const INTENT_SIGNALS = Object.freeze({
  researcher: Object.freeze([/\b(?:current|latest)\s+(?:official|first-party|regulation|api|security)\b/iu, /\b(?:first-party|official|external)\s+(?:source|specification|regulation|advisory)\b/iu, /\b(?:cite|link)\s+(?:the\s+)?(?:source|url)\b/iu, /\bfind\s+the\s+current\b/iu]),
  investigator: Object.freeze([/\b(?:trace|reproduce)\s+(?:(?:this|the)\s+)?(?:failing|internal|regression|stack)\b/iu, /\b(?:bad\s+value|root\s+cause|configuration)\s+(?:fails|failure|originated|problem)\b/iu, /\bexplain\s+why\s+.*\b(?:fails|failure)\b/iu, /\bcurrent\s+configuration\b/iu]),
  architect: Object.freeze([/\b(?:smallest|public)\s+(?:interface|seam)\b/iu, /\b(?:deep\s+module|module)\s+design(?:s)?\b/iu, /\bdesign\s+.*\binvariants?\b/iu, /\bschema\s+validation\s+(?:interface|seam)\b/iu]),
  implementer: Object.freeze([/\bwrite\s+the\s+failing\s+test\b/iu, /\bimplement\s+the\s+(?:approved|scoped)\b/iu, /\btest-first\s+vertical\s+slice\b/iu, /\bapply\s+the\s+(?:approved\s+)?(?:scoped\s+)?(?:change|fix)\b/iu]),
  verifier: Object.freeze([/\bfresh\s+black-box\s+(?:check|test)\b/iu, /\bparser\s+output\b.*\bdeterministic\b/iu, /\blive\s+check\s+as\s+not\s+run\b/iu, /\brendered\s+behavior\b/iu]),
  reviewer: Object.freeze([/\bdiff\b.*\b(?:task\s+brief|specification|findings)\b/iu, /\btest\s+hygiene\b.*\bmaintainability\b/iu, /\b(?:review|meets)\b.*\b(?:requested\s+)?specification\b/iu, /\breview\s+diff\b.*\b(?:quality|coverage|maintainability)\b/iu]),
  "security-reviewer": Object.freeze([/\b(?:threat|secret)\b.*\buntrusted\s+input\b/iu, /\bprivilege\s+(?:elevation|risk)\b.*\b(?:destructive|containment)\b/iu, /\bstride\s+threats?\b/iu, /\bsecurity\s+containment\b.*\bprivilege\b/iu])
});

const NEGATION_BEFORE_SIGNAL = /\b(?:do\s+not|don't|dont|never|without|not|no)\b(?:\s+[a-z0-9'-]+){0,4}\s*$/iu;

function hasUnnegatedSignal(text, signal) {
  const match = signal.exec(text);
  if (!match) return false;
  return !NEGATION_BEFORE_SIGNAL.test(text.slice(0, match.index));
}

function containsKeyword(text, keyword) {
  const normalized = String(keyword).trim().toLowerCase();
  if (normalized.length === 0) return false;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "iu").test(text);
}

/**
 * Deterministically select a canonical role from metadata routing keywords.
 * Unknown role records are ignored here as a second safety boundary; loadCore
 * rejects them before a normal production call can reach this seam.
 */
export function routeRole({ prompt, roles } = {}) {
  if (!Array.isArray(roles)) throw new TypeError("roles must be an array");
  assertCanonicalRoleRecords(roles);
  const text = String(prompt ?? "");
  const normalizedText = text.toLowerCase();
  const scored = roles
    .filter((role) => CANONICAL_ROLE_SET.has(role?.id) && INTENT_SIGNALS[role.id] && Array.isArray(role.routingKeywords))
    .map((role) => {
      const metadataKeywords = role.routingKeywords.map((keyword) => String(keyword).toLowerCase());
      const score = INTENT_SIGNALS[role.id].filter((signal) => hasUnnegatedSignal(text, signal) && metadataKeywords.some((keyword) => containsKeyword(normalizedText, keyword))).length;
      return { id: role.id, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  if (scored.length === 0) return Object.freeze({ status: "no-route", roleId: null, candidates: [], reason: "no canonical routing keyword matched" });
  const highest = scored[0].score;
  const candidates = scored.filter((entry) => entry.score === highest).map((entry) => entry.id).sort();
  if (candidates.length > 1) return Object.freeze({ status: "ambiguous", roleId: null, candidates, reason: "multiple canonical roles have the same highest score" });
  return Object.freeze({ status: "matched", roleId: candidates[0], candidates, score: highest });
}
