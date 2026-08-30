import { loadCore } from "./load-core.mjs";
import { render as renderClaude } from "../../adapters/claude/adapter.mjs";
import { render as renderCodex } from "../../adapters/codex/adapter.mjs";
import { render as renderAntigravity } from "../../adapters/antigravity-2/adapter.mjs";
import { render as renderAgy } from "../../adapters/agy/adapter.mjs";

export const SURFACE_RENDERERS = Object.freeze({
  claude: renderClaude,
  codex: renderCodex,
  "antigravity-2": renderAntigravity,
  agy: renderAgy
});

function validateSurface(surface) {
  if (!Object.hasOwn(SURFACE_RENDERERS, surface)) throw new TypeError(`unsupported render surface: ${String(surface)}`);
  return surface;
}

/** Render one selected surface from a loaded or repository-resolved core. */
export async function renderForSurface({ repositoryRoot = process.cwd(), core = null, surface, profile = "portable", statuslineName = "", platform = process.platform, targetRuntime, ...rest } = {}) {
  validateSurface(surface);
  const loadedCore = core ?? await loadCore(repositoryRoot);
  const profileValue = typeof profile === "string" ? { id: profile } : profile;
  return SURFACE_RENDERERS[surface]({
    core: loadedCore,
    profile: profileValue,
    statuslineName,
    platform,
    ...(targetRuntime === undefined ? {} : { targetRuntime }),
    ...rest
  });
}

/** Render all selected surfaces in deterministic surface order. */
export async function renderPayload({ repositoryRoot = process.cwd(), core = null, surfaces, surface, profile = "portable", statuslineName = "", platform = process.platform, targetRuntime, ...rest } = {}) {
  const selected = surfaces ?? (surface === "all" ? ["claude", "codex", "antigravity-2", "agy"] : surface ? [surface] : null);
  if (!Array.isArray(selected) || selected.length === 0) throw new TypeError("surfaces must contain at least one supported surface");
  const unique = [...new Set(selected)];
  if (unique.length !== selected.length) throw new TypeError("surfaces must not contain duplicates");
  const loadedCore = core ?? await loadCore(repositoryRoot);
  const results = [];
  for (const selectedSurface of unique) {
    results.push(await renderForSurface({ repositoryRoot, core: loadedCore, surface: selectedSurface, profile, statuslineName, platform, targetRuntime, ...rest }));
  }
  return results.length === 1 ? results[0] : results;
}

export const render = renderForSurface;
