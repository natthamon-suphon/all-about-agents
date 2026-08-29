import { CANONICAL_ROLE_IDS } from "./contract.mjs";

const CANONICAL_ROLE_SET = new Set(CANONICAL_ROLE_IDS);

function tokens(value) {
  return new Set(String(value ?? "").toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/gu) || []);
}

/**
 * Deterministically select a canonical role from metadata routing keywords.
 * Unknown role records are ignored here as a second safety boundary; loadCore
 * rejects them before a normal production call can reach this seam.
 */
export function routeRole({ prompt, roles } = {}) {
  if (!Array.isArray(roles)) throw new TypeError("roles must be an array");
  const promptTokens = tokens(prompt);
  const scored = roles
    .filter((role) => CANONICAL_ROLE_SET.has(role?.id) && Array.isArray(role?.routingKeywords))
    .map((role) => {
      const keywords = [...new Set(role.routingKeywords.map((keyword) => String(keyword).toLowerCase()))];
      const score = keywords.filter((keyword) => promptTokens.has(keyword)).length;
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
