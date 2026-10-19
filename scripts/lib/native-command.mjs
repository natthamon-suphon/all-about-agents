import { statSync } from "node:fs";
import { win32 } from "node:path";

const NPM_ENTRIES = Object.freeze({
  codex: ["node_modules", "@openai", "codex", "bin", "codex.js"],
  claude: ["node_modules", "@anthropic-ai", "claude-code", "cli.js"]
});
const isFile = (path) => { try { return statSync(path).isFile(); } catch { return false; } };

/** Resolve supported Windows npm entry points without evaluating a cmd wrapper. */
export function resolveNativeCommand(executable, { platform = process.platform, env = process.env } = {}) {
  if (platform !== "win32") return { executable, argsPrefix: [] };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path");
  const directories = (env[pathKey] ?? "").split(";").filter((directory) => win32.isAbsolute(directory));
  const explicit = win32.isAbsolute(executable) || /[\\/]/u.test(executable);
  const hasExtension = /\.(?:exe|com|cmd|bat)$/iu.test(executable);
  const candidates = explicit ? [executable] : directories.flatMap((directory) => (hasExtension ? [executable] : [`${executable}.exe`, `${executable}.com`, `${executable}.cmd`]).map((name) => win32.join(directory, name)));
  for (const candidate of candidates) {
    if (!isFile(candidate)) continue;
    if (!/\.(?:cmd|bat)$/iu.test(candidate)) return { executable: candidate, argsPrefix: [] };
    const name = win32.basename(candidate).replace(/\.(?:cmd|bat)$/iu, "").toLowerCase();
    const parts = NPM_ENTRIES[name];
    const entry = parts && win32.join(win32.dirname(candidate), ...parts);
    if (entry && isFile(entry)) return { executable: process.execPath, argsPrefix: [entry] };
    const error = new Error("unsupported native Windows shim; use a native executable or the official installed npm package");
    error.code = "UNSUPPORTED_NATIVE_SHIM";
    throw error;
  }
  return { executable, argsPrefix: [] };
}
