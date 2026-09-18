import portableProfile from "./portable/profile.json" with { type: "json" };
import templateProfile from "./template/profile.json" with { type: "json" };
import profileSchema from "../core/schemas/profile.schema.json" with { type: "json" };
import { validateSchema } from "../installers/lib/validate-schema.mjs";

export const PROFILE_MODEL_POLICY_REFS = Object.freeze({
  claude: Object.freeze(["surface-default", "approved-opus-sonnet"]),
  codex: Object.freeze(["surface-default", "approved-sol-terra"]),


});

const PROFILE_IDS = Object.freeze(["portable", "template"]);

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

const BUILTIN_PROFILES = Object.freeze({
  portable: deepFreeze(portableProfile),
  template: deepFreeze(templateProfile)
});

function profileId(input) {
  const id = typeof input === "string" ? input : input?.id;
  if (!PROFILE_IDS.includes(id)) throw new TypeError("profile.id must be portable or template");
  return id;
}

function assertSemanticPairing(profile) {
  const expected = profile.id === "template"
    ? {
        authority: "full",
        reasoning: "maximum-supported",
        advisor: "fable",
        modelPolicies: Object.fromEntries(Object.entries(PROFILE_MODEL_POLICY_REFS).map(([surface, refs]) => [surface, refs[1]]))
      }
    : {
        authority: "controlled",
        reasoning: "surface-default",
        advisor: "disabled",
        modelPolicies: Object.fromEntries(Object.keys(PROFILE_MODEL_POLICY_REFS).map((surface) => [surface, "surface-default"]))
      };
  const modelPairingValid = Object.entries(expected.modelPolicies).every(([surface, reference]) => profile.modelPolicies[surface] === reference);
  if (profile.authority !== expected.authority || profile.reasoning !== expected.reasoning || profile.advisor !== expected.advisor || !modelPairingValid) {
    throw new TypeError(`profile ${profile.id} has an invalid authority/advisor/model pairing`);
  }
}

function validateProfile(profile) {
  const validation = validateSchema({
    schema: profileSchema,
    value: profile,
    sourcePath: `profiles/${String(profile?.id ?? "unknown")}/profile.json`
  });
  if (!validation.valid) {
    const detail = validation.errors.map((error) => `${error.jsonPointer || "/"} ${error.message}`).join("; ");
    throw new TypeError(`profile failed schema validation: ${detail}`);
  }
  assertSemanticPairing(profile);
  return profile;
}

/** Resolve a built-in or complete portable profile and prove one native policy seam. */
export function resolveProfile(input = "portable", { surface, modelPolicyRefs } = {}) {
  if (!Object.hasOwn(PROFILE_MODEL_POLICY_REFS, surface)) throw new TypeError(`unsupported profile surface ${String(surface)}`);
  const id = profileId(input);
  const candidate = typeof input === "object" && input !== null && Object.keys(input).length > 1
    ? input
    : BUILTIN_PROFILES[id];
  const profile = validateProfile(candidate);
  const requestedRef = profile.modelPolicies[surface];
  const expectedRefs = PROFILE_MODEL_POLICY_REFS[surface];
  const evidenceRefs = Array.isArray(modelPolicyRefs) ? modelPolicyRefs : [];
  if (!expectedRefs.includes(requestedRef) || !evidenceRefs.includes(requestedRef)) {
    throw new TypeError(`profile ${id} has no verified native capability evidence for ${surface} model policy ${String(requestedRef)}`);
  }
  return profile;
}

export function profileTranslation(profile, surface) {
  return Object.freeze({
    kind: "profile-translation",
    surface,
    profile: profile.id,
    authority: profile.authority,
    reasoning: profile.reasoning,
    advisor: profile.advisor,
    modelPolicyRef: profile.modelPolicies[surface],
    skillSelection: "all-implicit"
  });
}

for (const profile of Object.values(BUILTIN_PROFILES)) validateProfile(profile);
