const CATEGORIES = Object.freeze(["skills", "roles", "subagents", "hooks", "profiles"]);
const CANONICAL_CATEGORIES = Object.freeze(["skills", "roles", "hooks", "profiles"]);
const KINDS = Object.freeze({ skill: "skills", role: "roles", subagent: "subagents", hook: "hooks", profile: "profiles" });
const FIXED_SUBAGENT_EMOJI = "🤖";
const APPROVED_EMOJI = Object.freeze({
  skills: Object.freeze({
    "brainstorming": "🧠",
    "codebase-design": "🧱",
    "dispatching-parallel-agents": "⚡",
    "executing-plans": "🚀",
    "finishing-a-development-branch": "🏁",
    "handoff": "🤝",
    "improve-codebase-architecture": "🏛️",
    "interviewing": "🎤",
    "loop-me": "🔁",
    "nano-image-generator": "🖼️",
    "performance-profiling-and-benchmarking": "⏱️",
    "receiving-code-review": "📥",
    "requesting-code-review": "📤",
    "research": "🔎",
    "resolving-merge-conflicts": "🧩",
    "session-compaction-resilience": "🗜️",
    "subagent-driven-development": "👥",
    "systematic-debugging": "🐛",
    "test-driven-development": "🧪",
    "threat-modeling-and-security": "🛡️",
    "using-all-about-agents": "🧰",
    "using-git-worktrees": "🌳",
    "verification-before-completion": "✅",
    "wait-what": "❓",
    "wayfinder": "🧭",
    "writing-plans": "📝",
    "writing-skills": "✍️",
    "zero-downtime-migrations": "🔄"
  }),
  roles: Object.freeze({ architect: "🏛️", implementer: "🛠️", investigator: "🕵️", researcher: "🔎", reviewer: "👀", "security-reviewer": "🛡️", verifier: "✅" }),
  subagents: Object.freeze({ default: FIXED_SUBAGENT_EMOJI }),
  hooks: Object.freeze({ bootstrap: "🚀", "activity-audit": "🧾", checkpoint: "💾" }),
  profiles: Object.freeze({ portable: "🧳", template: "⚙️" })
});
const APPROVED_PROGRESS_EMOJI = Object.freeze({ pending: "⬜", "in-progress": "🔄", completed: "✅", blocked: "🚧", failed: "❌", "not-run": "⏸️", skipped: "⏭️" });
const MACHINE_ID = /^[a-z0-9][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)?$/u;
const ANSI = /\u001b/u;
const HTML = /<[^>]*>/u;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function issue(code, path, message) { return { code, path, message }; }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function graphemeCount(value) { return [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(value)].length; }
function containsUnsafeText(value) { return typeof value === "string" && (ANSI.test(value) || HTML.test(value) || CONTROL_OR_FORMAT.test(value)); }
function expectedIds(canonical, category) { return Array.isArray(canonical?.[category]) ? canonical[category] : []; }
const PROGRESS_STATE_IDS = Object.freeze(["pending", "in-progress", "completed", "blocked", "failed", "not-run", "skipped"]);
const PROGRESS_KEYS = new Set(["schemaVersion", "states", "minItems", "maxItems", "maxSequentialInProgress", "updateOnlyOnStateChange", "terminalCompletionRequired"]);
const PROGRESS_STATE_KEYS = new Set(["emoji", "terminal", "reasonRequired"]);

function validateStateContract(progressContract, errors) {
  if (!isObject(progressContract)) { errors.push(issue("malformed-progress-contract", "/progressContract", "progressContract must be an object")); return; }
  for (const key of Object.keys(progressContract)) if (!PROGRESS_KEYS.has(key)) errors.push(issue("malformed-progress-contract", `/progressContract/${key}`, `unknown progress contract property ${key}`));
  const states = progressContract.states;
  const required = PROGRESS_STATE_IDS;
  if (!isObject(states)) errors.push(issue("malformed-progress-states", "/progressContract/states", "states must be an object"));
  else {
    for (const id of required) if (!Object.hasOwn(states, id)) errors.push(issue("missing-checklist-state", `/progressContract/states/${id}`, `missing checklist state ${id}`));
    for (const id of Object.keys(states)) {
      const state = states[id];
      if (!required.includes(id)) errors.push(issue("unknown-checklist-state", `/progressContract/states/${id}`, `unknown checklist state ${id}`));
      if (!isObject(state)) { errors.push(issue("malformed-checklist-state", `/progressContract/states/${id}`, "checklist state must be an object")); continue; }
      for (const key of Object.keys(state)) if (!PROGRESS_STATE_KEYS.has(key)) errors.push(issue("malformed-checklist-state", `/progressContract/states/${id}/${key}`, `unknown checklist state property ${key}`));
      if (typeof state.emoji !== "string" || state.emoji.trim() === "") errors.push(issue("missing-checklist-emoji", `/progressContract/states/${id}/emoji`, "checklist state emoji is required"));
      else if (graphemeCount(state.emoji) !== 1 || containsUnsafeText(state.emoji)) errors.push(issue("invalid-checklist-emoji", `/progressContract/states/${id}/emoji`, "checklist state emoji must be one safe grapheme"));
      else if (Object.hasOwn(APPROVED_PROGRESS_EMOJI, id) && state.emoji !== APPROVED_PROGRESS_EMOJI[id]) errors.push(issue("unapproved-checklist-emoji", `/progressContract/states/${id}/emoji`, `${id} checklist emoji must be ${APPROVED_PROGRESS_EMOJI[id]}`));
      if (typeof state.terminal !== "boolean") errors.push(issue("malformed-checklist-terminal", `/progressContract/states/${id}/terminal`, "terminal must be boolean"));
      else if ((["completed", "blocked", "failed", "not-run", "skipped"].includes(id) && state.terminal !== true) || (["pending", "in-progress"].includes(id) && state.terminal !== false)) errors.push(issue("malformed-checklist-terminal", `/progressContract/states/${id}/terminal`, `${id} has an invalid terminal value`));
      if (state.reasonRequired !== undefined && typeof state.reasonRequired !== "boolean") errors.push(issue("malformed-checklist-reason", `/progressContract/states/${id}/reasonRequired`, "reasonRequired must be boolean"));
      if (["blocked", "failed", "not-run", "skipped"].includes(id) && state.reasonRequired !== true) errors.push(issue("checklist-reason-required", `/progressContract/states/${id}/reasonRequired`, `${id} requires a reason`));
    }
  }
  if (progressContract.schemaVersion !== 1) errors.push(issue("invalid-schema-version", "/progressContract/schemaVersion", "schemaVersion must be 1"));
  if (progressContract.minItems !== 2 || progressContract.maxItems !== 7 || progressContract.maxSequentialInProgress !== 1 || progressContract.updateOnlyOnStateChange !== true || progressContract.terminalCompletionRequired !== true) errors.push(issue("invalid-progress-limits", "/progressContract", "progress limits and transition rules do not match the contract"));
}

function assertValidProgressContract(progressContract) {
  const errors = [];
  validateStateContract(progressContract, errors);
  if (errors.length > 0) throw new TypeError(`invalid progress contract: ${errors.map((entry) => entry.message).join("; ")}`);
  return progressContract;
}

function validateRegistry(emojiRegistry, canonical, errors) {
  if (!isObject(emojiRegistry)) { errors.push(issue("malformed-registry", "/emojiRegistry", "emojiRegistry must be an object")); return; }
  if (emojiRegistry.schemaVersion !== 1) errors.push(issue("invalid-schema-version", "/emojiRegistry/schemaVersion", "schemaVersion must be 1"));
  for (const category of Object.keys(emojiRegistry)) if (category !== "schemaVersion" && !CATEGORIES.includes(category)) errors.push(issue("unknown-category", `/emojiRegistry/${category}`, `unknown presentation category ${category}`));
  const seen = new Map();
  for (const category of CATEGORIES) {
    const values = emojiRegistry[category];
    if (!isObject(values)) { errors.push(issue("missing-category", `/emojiRegistry/${category}`, `${category} must be an object`)); continue; }
    const expected = category === "subagents" ? ["default"] : expectedIds(canonical, category);
    const expectedSet = new Set(expected);
    for (const id of Object.keys(values)) {
      const path = `/emojiRegistry/${category}/${id}`;
      if (!MACHINE_ID.test(id)) errors.push(issue("invalid-ID", `${path}`, `${category} ID ${id} must be a plain machine identifier`));
      if (seen.has(id) && seen.get(id) !== category) errors.push(issue("duplicate-equivalent", path, `${id} is mapped in both ${seen.get(id)} and ${category}`));
      else seen.set(id, category);
      const knownCategory = CANONICAL_CATEGORIES.find((candidate) => expectedIds(canonical, candidate).includes(id));
      if (knownCategory && knownCategory !== category) errors.push(issue("wrong-category", path, `${id} belongs to ${knownCategory}`));
      if (!expectedSet.has(id)) errors.push(issue("extra-entry", path, `${category} contains unknown presentation entry ${id}`));
      const entry = values[id];
      if (!isObject(entry) || Object.keys(entry).some((key) => key !== "emoji")) errors.push(issue("malformed-entry", path, "presentation entry must contain only emoji metadata"));
      const emoji = entry?.emoji;
      if (typeof emoji !== "string" || emoji.trim() === "") errors.push(issue("missing-emoji", `${path}/emoji`, "presentation emoji is required"));
      else {
        if (graphemeCount(emoji) !== 1) errors.push(issue("multi-emoji", `${path}/emoji`, "presentation emoji must contain one grapheme"));
        if (containsUnsafeText(emoji)) errors.push(issue("unsafe-presentation", `${path}/emoji`, "presentation emoji must not contain HTML or ANSI"));
        const approvedEmoji = APPROVED_EMOJI[category]?.[id];
        if (approvedEmoji !== undefined && emoji !== approvedEmoji) {
          errors.push(issue(category === "subagents" && id === "default" ? "fixed-subagent-emoji" : "unapproved-emoji", `${path}/emoji`, `${category}.${id} emoji must be ${approvedEmoji}`));
        }
      }
    }
    for (const id of expected) if (!Object.hasOwn(values, id)) errors.push(issue("missing-entry", `/emojiRegistry/${category}/${id}`, `missing presentation mapping for ${id}`));
  }
}

/** Validate the registry and checklist against loaded canonical core entities. */
export function validatePresentationContract({ emojiRegistry, progressContract, canonical } = {}) {
  const errors = [];
  if (!isObject(canonical)) errors.push(issue("malformed-canonical", "/canonical", "canonical must be an object"));
  for (const category of CANONICAL_CATEGORIES) {
    const values = canonical?.[category];
    if (!Array.isArray(values)) errors.push(issue("malformed-canonical", `/canonical/${category}`, `${category} must be an array`));
    else {
      const seen = new Set();
      for (const [index, id] of values.entries()) {
        if (typeof id !== "string" || !MACHINE_ID.test(id) || containsUnsafeText(id)) errors.push(issue("invalid-ID", `/canonical/${category}/${index}`, `${category} canonical IDs must be plain identifiers`));
        if (seen.has(id)) errors.push(issue("duplicate-canonical", `/canonical/${category}/${index}`, `duplicate canonical ${category} ID ${id}`));
        seen.add(id);
      }
    }
  }
  validateRegistry(emojiRegistry, canonical, errors);
  validateStateContract(progressContract, errors);
  return { valid: errors.length === 0, errors };
}

function lookup(presentation, kind, id) {
  const category = KINDS[kind];
  if (!category) throw new TypeError(`unknown presentation kind ${String(kind)}`);
  if (typeof id !== "string" || !MACHINE_ID.test(id)) throw new TypeError(`invalid presentation identifier ${String(id)}`);
  const registry = presentation?.emojiRegistry;
  if (kind === "subagent" && registry?.subagents?.default?.emoji !== FIXED_SUBAGENT_EMOJI) {
    throw new TypeError(`unknown or invalid fixed subagent presentation mapping for ${id}`);
  }
  const entry = registry?.[category]?.[id] ?? (kind === "subagent" ? registry?.subagents?.default : undefined);
  if (!entry || typeof entry.emoji !== "string" || entry.emoji.trim() === "" || graphemeCount(entry.emoji) !== 1 || containsUnsafeText(entry.emoji)) throw new TypeError(`unknown or invalid presentation mapping for ${kind} ${id}`);
  const approvedEmoji = kind === "subagent" ? FIXED_SUBAGENT_EMOJI : APPROVED_EMOJI[category]?.[id];
  if (approvedEmoji === undefined || entry.emoji !== approvedEmoji) throw new TypeError(`unknown or invalid approved presentation mapping for ${kind} ${id}`);
  return { category, emoji: entry.emoji };
}

/** Return the canonical machine identifier followed by its registered emoji. */
export function displayLabel(presentation, kind, id) {
  return `${id} ${lookup(presentation, kind, id).emoji}`;
}

/** Render all labels once with the state legend and silent-hook rule. */
export function renderPresentationCatalog(presentation) {
  const progressContract = assertValidProgressContract(presentation?.progressContract);
  const registry = presentation?.emojiRegistry;
  if (!isObject(registry)) throw new TypeError("presentation.emojiRegistry must be an object");
  const lines = ["Presentation catalog"];
  for (const category of CATEGORIES) {
    const values = registry[category];
    if (!isObject(values)) throw new TypeError(`presentation.${category} must be an object`);
    lines.push(`\n${category}`);
    for (const id of Object.keys(values).sort()) lines.push(`- ${displayLabel(presentation, category === "subagents" ? "subagent" : category.slice(0, -1), id)}`);
  }
  const states = progressContract.states;
  lines.push("\nState legend");
  for (const id of Object.keys(states).sort()) lines.push(`- ${states[id].emoji} ${id}`);
  // The checklist contract is rendered once, here, from progress-contract.json;
  // skills and roles carry no copy of it.
  lines.push(
    "\nChecklist contract",
    "- Announce each visible invocation with its label and one short, task-specific reason.",
    `- Derive ${progressContract.minItems}-${progressContract.maxItems} material steps from the selected skill, role, or task.`,
    "- Update only when a state changes; never repeat an unchanged checklist.",
    `- Keep ${progressContract.maxSequentialInProgress === 1 ? "one in-progress item" : `at most ${progressContract.maxSequentialInProgress} in-progress items`} per sequential checklist and one per parallel owner.`,
    "- Give every item a terminal state before claiming completion."
  );
  lines.push("\nSilent-hook rule: automatic hooks are report-only and do not announce every event.");
  return lines.join("\n");
}
