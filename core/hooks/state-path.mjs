import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_VARIABLES = Object.freeze({ claude: "CLAUDE_PLUGIN_DATA", codex: "PLUGIN_DATA" });
const DEFAULT_PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function contained(root, target) {
  const part = relative(root, target);
  return part === "" || (part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part));
}

/** Check every existing component, including Windows redirecting reparse points. */
export function assertStatePath(target, { allowFile = false } = {}) {
  if (typeof target !== "string" || !isAbsolute(target) || /[\u0000-\u001f\u007f]/u.test(target) || target.split(/[\\/]/u).includes("..")) {
    throw new TypeError("state path must be absolute without traversal or controls");
  }
  const normalized = resolve(target);
  for (let current = normalized; ; current = dirname(current)) {
    try {
      const info = lstatSync(current);
      if (info.isSymbolicLink() || (!info.isDirectory() && !(allowFile && current === normalized && info.isFile() && info.nlink === 1))) {
        throw new Error("state path must not cross a link or non-directory");
      }
      const canonical = realpathSync.native(current);
      const actual = lstatSync(canonical);
      if (info.dev !== actual.dev || info.ino !== actual.ino) throw new Error("state path crosses a redirect");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (dirname(current) === current) break;
  }
  return normalized;
}

/** Resolve only native writable plugin data; never fall back to package or cwd. */
export function resolveHookDataRoot(surface, { env = process.env, packageRoot = DEFAULT_PACKAGE_ROOT, segments = [] } = {}) {
  try {
    const variable = DATA_VARIABLES[surface];
    const value = variable && env[variable];
    if (typeof value !== "string" || !value.trim() || !Array.isArray(segments) || segments.some((part) => typeof part !== "string" || !/^[a-zA-Z0-9._-]+$/u.test(part) || part === "." || part === "..")) return null;
    const root = assertStatePath(value);
    if (root === parse(root).root || contained(root, homedir()) || contained(resolve(packageRoot), root)) return null;
    return assertStatePath(resolve(root, ...segments), { allowFile: segments.length > 0 });
  } catch {
    return null;
  }
}
