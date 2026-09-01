import { loadCore } from "./load-core.mjs";
import { hashBytes, equalBytes } from "./hash.mjs";
import { SURFACES, validateRenderResult } from "../../adapters/shared/adapter-contract.mjs";
import { renderSurface as renderClaude } from "../../adapters/claude/adapter.mjs";
import { renderSurface as renderCodex } from "../../adapters/codex/adapter.mjs";
import { renderSurface as renderAntigravity } from "../../adapters/antigravity-2/adapter.mjs";
import { renderSurface as renderAgy } from "../../adapters/agy/adapter.mjs";

export const SURFACE_RENDERERS = Object.freeze({
  claude: renderClaude,
  codex: renderCodex,
  "antigravity-2": renderAntigravity,
  agy: renderAgy
});
const SURFACE_ORDER = new Map(SURFACES.map((surface, index) => [surface, index]));

function validateSurface(surface) {
  if (!Object.hasOwn(SURFACE_RENDERERS, surface)) throw new TypeError(`unsupported render surface: ${String(surface)}`);
  return surface;
}

function portablePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("\0") || value.startsWith("/") || /^[A-Za-z]:/u.test(value)) {
    throw new TypeError(`${label} must be a safe portable relative path`);
  }
  const parts = value.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) throw new TypeError(`${label} must be a safe portable relative path`);
  return value;
}

function mappedFiles(payload) {
  if (!payload || !Array.isArray(payload.files)) throw new TypeError("payload.files must be an array");
  const sourceFiles = new Map();
  for (const file of payload.files) {
    portablePath(file?.relativePath, "file.relativePath");
    if (!(file.content instanceof Uint8Array)) throw new TypeError(`file ${file.relativePath} must contain Uint8Array bytes`);
    if (sourceFiles.has(file.relativePath)) throw new TypeError(`duplicate source file ${file.relativePath}`);
    sourceFiles.set(file.relativePath, file);
  }
  const output = new Map(sourceFiles);
  const identitySources = new Set();
  for (const registration of Array.isArray(payload.registrations) ? payload.registrations : []) {
    const sourcePath = registration?.relativePath ?? registration?.relativeDirectory;
    const destination = registration?.destination;
    if (destination === undefined) continue;
    if (sourcePath === undefined) throw new TypeError("mapped registration requires a source and destination");
    portablePath(sourcePath, "registration source");
    portablePath(destination, "registration destination");
    const directory = registration.relativeDirectory !== undefined;
    const matches = directory
      ? [...sourceFiles.entries()].filter(([relativePath]) => relativePath === sourcePath || relativePath.startsWith(`${sourcePath}/`))
      : [[sourcePath, sourceFiles.get(sourcePath)]];
    if (matches.length === 0 || matches.some(([, file]) => !file)) throw new TypeError(`mapped registration source is missing: ${sourcePath}`);
    for (const [relativePath, file] of matches) {
      const suffix = directory ? relativePath.slice(sourcePath.length).replace(/^\//u, "") : "";
      const targetPath = directory ? `${destination}${suffix ? `/${suffix}` : ""}` : destination;
      portablePath(targetPath, "mapped destination");
      const existing = output.get(targetPath);
      if (existing && (existing.mode !== file.mode || !equalBytes(existing.content, file.content))) throw new TypeError(`conflicting mapped destination: ${targetPath}`);
      output.set(targetPath, { ...file, relativePath: targetPath });
      if (relativePath === targetPath) identitySources.add(relativePath);
      else if (!identitySources.has(relativePath)) output.delete(relativePath);
    }
  }
  return [...output.values()].sort((left, right) => left.relativePath === right.relativePath ? 0 : left.relativePath < right.relativePath ? -1 : 1);
}

/** Materialize adapter registration destinations without mutating adapter output. */
export function materializeRenderResult(payload) {
  const files = mappedFiles(payload);
  const result = {
    ...payload,
    files,
    ownership: files.map((file) => ({ relativePath: file.relativePath, sha256: hashBytes(file.content) }))
  };
  const validation = validateRenderResult(result);
  if (!validation.valid) throw new TypeError(`materialized render result is invalid: ${JSON.stringify(validation.errors)}`);
  return result;
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
  unique.sort((left, right) => (SURFACE_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) - (SURFACE_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER));
  const loadedCore = core ?? await loadCore(repositoryRoot);
  const results = [];
  for (const selectedSurface of unique) {
    results.push(await renderForSurface({ repositoryRoot, core: loadedCore, surface: selectedSurface, profile, statuslineName, platform, targetRuntime, ...rest }));
  }
  return results.length === 1 ? results[0] : results;
}

export const render = renderForSurface;
