// The single source of truth for the supported surface list. Every module that
// needs to know the surfaces imports it from here. Keep this module free of
// imports so both `adapters/` and `installers/` can depend on it without a cycle.

export const SURFACES = Object.freeze(["antigravity", "claude", "codex"]);
export const SURFACE_SET = new Set(SURFACES);

/**
 * The environment variable each surface reads for its configuration root.
 *
 * Claude and Codex publish theirs. Antigravity publishes none, so this
 * repository defines a clearly repository-scoped name: without an override
 * every qualification run would resolve to the operator's live directory.
 */
export const SURFACE_ROOT_ENV = Object.freeze({
  antigravity: "AAA_ANTIGRAVITY_ROOT",
  claude: "CLAUDE_CONFIG_DIR",
  codex: "CODEX_HOME"
});

/** The directory each surface uses under the home directory. */
export const SURFACE_HOME_DIRECTORY = Object.freeze({
  antigravity: ".gemini",
  claude: ".claude",
  codex: ".codex"
});

/** True when the value is one of the supported surfaces. */
export function isSurface(value) {
  return typeof value === "string" && SURFACE_SET.has(value);
}
