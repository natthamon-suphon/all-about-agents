import { SURFACES, SURFACE_SET } from "../../adapters/shared/surfaces.mjs";
const ACTIONS = new Set(["install", "doctor", "validate", "diff", "eval", "register"]);
const PROFILES = new Set(["portable", "template"]);
const FORMATS = new Set(["text", "json"]);

/** A user-facing argument error with a stable machine-readable code. */
export class ArgumentError extends TypeError {
  constructor(code, message) {
    super(message);
    this.name = "ArgumentError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ArgumentError(code, message);
}

function optionValue(token, argv, index) {
  const equals = token.indexOf("=");
  if (equals >= 0) {
    const name = token.slice(0, equals);
    const value = token.slice(equals + 1);
    if (value.length === 0 && name !== "--statusline-name") fail("missing-value", `Missing value for ${name}`);
    return { name, value, consumed: 0 };
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) fail("missing-value", `Missing value for ${token}`);
  return { name: token, value, consumed: 1 };
}

function isAnsiOrControl(value) {
  // C0/C1 controls include newline, tab, ESC, and terminal CSI bytes. ESC is
  // checked explicitly so malformed/incomplete ANSI sequences are rejected.
  return /\p{Cc}/u.test(value) || value.includes("\u001b") || /\u009b/u.test(value);
}

/** Validate and normalize the install-time statusline display name. */
export function validateStatuslineName(value) {
  if (typeof value !== "string") fail("invalid-statusline-name", "Statusline display name must be a string");
  // Inspect the raw value first: String#trim would otherwise hide a control
  // character placed at either edge of the user-supplied name.
  if (isAnsiOrControl(value)) fail("invalid-statusline-name", "Statusline display name may not contain control or ANSI characters");
  const normalized = value.trim();
  const codePoints = Array.from(normalized).length;
  if (codePoints > 64) fail("statusline-name-too-long", "Statusline display name must contain at most 64 Unicode code points");
  return normalized;
}

/**
 * Parse the repository CLI's shared install arguments.
 *
 * Parsing is pure and never reads stdin. Callers that deliberately want the
 * interactive omitted-name behavior may inject `interactive: true` and a
 * synchronous `prompt` callback; the default remains non-blocking.
 */
export function parseArgs(argv, options = {}) {
  if (!Array.isArray(argv) || argv.some((value) => typeof value !== "string")) fail("invalid-argv", "argv must be an array of strings");
  if (!options || typeof options !== "object" || Array.isArray(options)) fail("invalid-options", "parse options must be an object");

  let action = "install";
  let actionSeen = false;
  let surfaces = null;
  let surfaceSeen = false;
  let profile = "portable";
  let profileSeen = false;
  let mode = "dry-run";
  let modeSeen = false;
  let destinationRoot = null;
  let destinationSeen = false;
  let packageRoot = null;
  let packageRootSeen = false;
  let statuslineName = null;
  let statuslineSeen = false;
  let format = "text";
  let formatSeen = false;

  const seen = (name, already) => {
    if (already) fail("duplicate-option", `Duplicate option: ${name}`);
    return true;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("-")) {
      if (actionSeen) fail("unexpected-argument", `Unexpected argument: ${token}`);
      if (!ACTIONS.has(token)) fail("invalid-action", `Unknown action: ${token}`);
      action = token;
      actionSeen = true;
      continue;
    }
    if (token === "-h" || token === "--help") {
      fail("help-requested", "Help requested");
    }
    if (token === "--dry-run" || token === "--apply") {
      modeSeen = seen(token, modeSeen);
      mode = token === "--apply" ? "apply" : "dry-run";
      continue;
    }
    const parsed = optionValue(token, argv, index);
    index += parsed.consumed;
    const { name, value } = parsed;
    switch (name) {
      case "--surface": {
        surfaceSeen = seen(name, surfaceSeen);
        if (value === "all") {
          surfaces = [...SURFACES];
          break;
        }
        if (!SURFACE_SET.has(value)) fail("invalid-surface", `--surface must be one of ${[...SURFACES, "all"].join(", ")}`);
        surfaces = [value];
        break;
      }
      case "--profile":
        profileSeen = seen(name, profileSeen);
        if (!PROFILES.has(value)) fail("invalid-profile", "--profile must be portable or template");
        profile = value;
        break;
      case "--destination-root":
        destinationSeen = seen(name, destinationSeen);
        if (value.includes("\0")) fail("invalid-destination-root", "--destination-root may not contain NUL bytes");
        destinationRoot = value;
        break;
      case "--package-root":
        packageRootSeen = seen(name, packageRootSeen);
        if (value.includes("\0") || value.trim() === "") fail("invalid-package-root", "--package-root must be a non-empty path");
        packageRoot = value;
        break;
      case "--statusline-name":
        statuslineSeen = seen(name, statuslineSeen);
        statuslineName = validateStatuslineName(value);
        break;
      case "--format":
        formatSeen = seen(name, formatSeen);
        if (!FORMATS.has(value)) fail("invalid-format", "--format must be text or json");
        format = value;
        break;
      default:
        fail("unknown-option", `Unknown option: ${name}`);
    }
  }

  if (surfaces === null) surfaces = [...SURFACES];
  if (packageRoot !== null && action !== "register") fail("inapplicable-package-root", "--package-root is only valid for register");
  if (action === "register") {
    if (surfaces.length !== 1) fail("invalid-registration-surface", "register requires exactly one --surface; --surface all is not supported");
    if (packageRoot === null) fail("missing-package-root", "register requires --package-root");
    if (destinationRoot !== null) fail("inapplicable-destination-root", "--destination-root is only valid for install, doctor, or diff");
    if (statuslineSeen) fail("inapplicable-statusline-name", "--statusline-name is only valid for install");
  }
  if (action === "install" && mode === "apply" && destinationRoot === null) {
    fail("destination-root-required", "install --apply requires an explicit --destination-root; automatic root discovery is available only to --dry-run, doctor, and diff");
  }
  const hasStatuslineSurface = surfaces.includes("claude");
  if (statuslineSeen && !hasStatuslineSurface) {
    fail("inapplicable-statusline-name", "inapplicable --statusline-name: select Claude");
  }
  if (statuslineName === null) {
    if (options.interactive === true && hasStatuslineSurface) {
      if (typeof options.prompt !== "function") fail("interactive-prompt-required", "Interactive statusline input requires an injected prompt callback");
      statuslineName = validateStatuslineName(options.prompt("Statusline display name"));
    } else {
      statuslineName = "";
    }
  }

  return Object.freeze({ action, surfaces: Object.freeze(surfaces), profile, mode, destinationRoot, packageRoot, statuslineName, format });
}

export { SURFACES };
