const CONTROL_CHARACTER = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;

function assertString(value, name) {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  if (CONTROL_CHARACTER.test(value)) throw new TypeError(`${name} contains a control character`);
}

export function normalizeLf(value) {
  assertString(value, "value");
  return value.replace(/\r\n?/gu, "\n");
}

export function ensureTrailingNewline(value) {
  const normalized = normalizeLf(value).replace(/\n+$/gu, "");
  return `${normalized}\n`;
}

export function renderText(value) {
  if (Array.isArray(value)) value = value.join("\n");
  return ensureTrailingNewline(value);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

export function renderJson(value) {
  const serialized = JSON.stringify(stableValue(value), null, 2);
  if (serialized === undefined) throw new TypeError("JSON value cannot be serialized");
  return ensureTrailingNewline(serialized);
}

function tomlKey(value) {
  return /^[A-Za-z0-9_-]+$/u.test(value) ? value : JSON.stringify(value);
}

function tomlString(value) {
  return JSON.stringify(value);
}

function tomlScalar(value) {
  if (typeof value === "string") return tomlString(value);
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("TOML numbers must be finite");
    return Object.is(value, -0) ? "-0" : String(value);
  }
  throw new TypeError("TOML supports only strings, finite numbers, and booleans");
}

function tomlValue(value) {
  if (Array.isArray(value)) {
    if (!value.every((item) => item !== null && (typeof item === "string" || typeof item === "boolean" || typeof item === "number"))) {
      throw new TypeError("TOML arrays must contain scalar values");
    }
    return `[${value.map(tomlScalar).join(", ")}]`;
  }
  return tomlScalar(value);
}

function isTable(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function tableLines(value, path, output) {
  const scalarKeys = Object.keys(value).filter((key) => !isTable(value[key])).sort();
  const tableKeys = Object.keys(value).filter((key) => isTable(value[key])).sort();
  for (const key of scalarKeys) output.push(`${tomlKey(key)} = ${tomlValue(value[key])}`);
  for (const key of tableKeys) {
    const table = value[key];
    if (output.length > 0 && output.at(-1) !== "") output.push("");
    const tablePath = [...path, key].map(tomlKey).join(".");
    output.push(`[${tablePath}]`);
    tableLines(table, [...path, key], output);
  }
}

export function renderToml(value) {
  if (!isTable(value)) throw new TypeError("TOML root must be an object");
  const lines = [];
  tableLines(value, [], lines);
  return ensureTrailingNewline(lines.join("\n"));
}

// Upper-case aliases make the format names match common API spelling without
// introducing a second implementation.
export const renderJSON = renderJson;
export const renderTOML = renderToml;
export const renderTextDocument = renderText;
export const renderJsonDocument = renderJson;
export const renderTomlDocument = renderToml;
