import { access, lstat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { assertSafeDestinationRoot } from "./roots.mjs";
import { SURFACES as SUPPORTED_SURFACES } from "../../adapters/shared/surfaces.mjs";

const SURFACES = SUPPORTED_SURFACES;
const PROFILES = new Set(["portable", "template"]);
const STATUSES = new Set(["pass", "fail", "not run"]);

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function check(id, surface, status, evidence) {
  if (!STATUSES.has(status) || typeof id !== "string" || typeof evidence !== "string") {
    throw new TypeError("doctor checks require stable id, status, and evidence strings");
  }
  return { id, surface, status, evidence };
}

function runtimeValue(runtimes, key) {
  const value = runtimes[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function nearestExistingDirectory(path) {
  let candidate = resolve(path);
  while (true) {
    try {
      const details = await lstat(candidate);
      if (!details.isDirectory() || details.isSymbolicLink()) return null;
      return candidate;
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
      const parent = dirname(candidate);
      if (parent === candidate) return null;
      candidate = parent;
    }
  }
}

async function writableCheck(root) {
  const parent = await nearestExistingDirectory(root);
  if (!parent) return { status: "fail", evidence: "no safe existing directory is available for a write-access check" };
  try {
    await access(parent, 2);
    return {
      status: "pass",
      evidence: root === parent
        ? `destination root is writable: ${root}`
        : `destination root does not exist; nearest existing parent is writable: ${parent}`
    };
  } catch (error) {
    return { status: "fail", evidence: `destination root is not writable: ${error.message}` };
  }
}

function overallStatus(checks) {
  if (checks.some((entry) => entry.status === "fail")) return "fail";
  if (checks.some((entry) => entry.status === "not run")) return "not run";
  return "pass";
}

/**
 * Report repository/runtime readiness without invoking product commands or
 * reading credentials.  Every root, runtime, capability, and manual step is
 * represented independently, and unknown availability remains `not run`.
 */
export async function diagnose({ surfaces, profile, destinationRoot, runtimes = {} } = {}) {
  if (!Array.isArray(surfaces) || surfaces.length === 0 || surfaces.some((surface) => !SURFACES.includes(surface)) || new Set(surfaces).size !== surfaces.length) {
    throw new TypeError("surfaces must be a unique non-empty list of supported surfaces");
  }
  if (!PROFILES.has(profile)) throw new TypeError("profile must be portable or template");
  if (typeof destinationRoot !== "string" || destinationRoot.trim() === "" || !isAbsolute(destinationRoot)) {
    throw new TypeError("destinationRoot must be an absolute path");
  }
  if (!object(runtimes)) throw new TypeError("runtimes must be an object");

  const checks = [];
  const nodeVersion = runtimeValue(runtimes, "node");
  checks.push(nodeVersion
    ? check("runtime:node", null, "pass", `Node runtime reported as ${nodeVersion}`)
    : check("runtime:node", null, "not run", "Node runtime availability was not supplied; no runtime probe was attempted"));

  for (const surface of surfaces) {
    const productVersion = runtimeValue(runtimes, surface);
    checks.push(productVersion
      ? check(`runtime:${surface}`, surface, "pass", `${surface} runtime reported as ${productVersion}`)
      : check(`runtime:${surface}`, surface, "not run", `${surface} runtime availability is unknown; no product command or credential probe was attempted`));

    try {
      const normalized = assertSafeDestinationRoot(destinationRoot, { allowedProductRoots: [destinationRoot] });
      checks.push(check(`root:${surface}`, surface, "pass", `resolved destination root: ${normalized}`));
      const writable = await writableCheck(normalized);
      checks.push(check(`writable:${surface}`, surface, writable.status, writable.evidence));
    } catch (error) {
      checks.push(check(`root:${surface}`, surface, "fail", `destination root rejected: ${error.message}`));
      checks.push(check(`writable:${surface}`, surface, "not run", "writable check was not attempted because the destination root is unsafe"));
    }

    const capabilityVersion = runtimeValue(runtimes, `capability:${surface}`);
    checks.push(capabilityVersion
      ? check(`capability:${surface}`, surface, "pass", `${surface} capability record reported as ${capabilityVersion}`)
      : check(`capability:${surface}`, surface, "not run", `${surface} capability version is not verified; no native capability probe was attempted`));

    checks.push(check(`manual:${surface}`, surface, "not run", `${surface} manual acceptance steps remain outstanding; no product session was opened`));
  }

  return { status: overallStatus(checks), checks };
}

export { SURFACES };
