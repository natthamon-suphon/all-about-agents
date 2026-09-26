import { lstat, readdir, readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import * as zlib from "node:zlib";

if (typeof zlib.crc32 !== "function") throw new Error("node:zlib crc32 is required (Node >= 22.2)");

export const CONVENTIONS_PATH = "references/conventions.md";

const ALLOWED_KEYS = new Set(["name", "description"]);
const NAME_PATTERN = /^aaa-[a-z0-9]+(-[a-z0-9]+)*$/u;
const MAX_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_BODY_LINES = 500;
const RESERVED_WORDS = ["claude", "anthropic"];
const UNSAFE_FIRST_CHARACTERS = new Set(["[", "]", "{", "}", "&", "*", "!", "|", ">", "'", "\"", "%", "@", "`"]);
const COLON_PREFIX = /\baaa:/u;
const ABSOLUTE_PATH = /(^|[\s("'`])(\/Users\/|\/home\/|[A-Za-z]:\\|~\/)/mu;
const MARKDOWN_LINK = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu;
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;

const decoder = new TextDecoder("utf-8");

function problem(code, path, message) {
  return { code, path, message };
}

function unquote(raw) {
  const quote = raw[0];
  if ((quote === "\"" || quote === "'") && raw.length >= 2 && raw.at(-1) === quote) {
    const inner = raw.slice(1, -1);
    const unsafe = quote === "\"" ? /["\\]/u.test(inner) : inner.includes("'");
    return { value: inner, unsafe };
  }
  const unsafe = raw.includes(": ") || raw.includes(" #") || raw.endsWith(":") || UNSAFE_FIRST_CHARACTERS.has(raw[0]);
  return { value: raw, unsafe };
}

export function parseSkillFile(text) {
  const lines = text.split(/\r?\n/u);
  if (lines[0] !== "---") {
    return { frontmatter: {}, body: text, errors: [problem("frontmatter-missing", "SKILL.md", "frontmatter must open on line 1 with ---")] };
  }
  const end = lines.indexOf("---", 1);
  if (end < 0) {
    return { frontmatter: {}, body: text, errors: [problem("frontmatter-missing", "SKILL.md", "frontmatter is not closed with ---")] };
  }
  const frontmatter = {};
  const errors = [];
  for (const line of lines.slice(1, end)) {
    if (line.trim() === "") continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*): (\S.*)$/u.exec(line);
    if (!match) {
      errors.push(problem("frontmatter-line", "SKILL.md", `frontmatter line must be one-line key: value: ${line}`));
      continue;
    }
    const [, key, raw] = match;
    const { value, unsafe } = unquote(raw.trimEnd());
    if (unsafe) errors.push(problem("yaml-unsafe", "SKILL.md", `${key} needs quotes or must avoid YAML syntax characters`));
    frontmatter[key] = value;
  }
  return { frontmatter, body: lines.slice(end + 1).join("\n"), errors };
}

function linkErrors(filePath, text, filePaths) {
  const errors = [];
  for (const [, target] of text.matchAll(MARKDOWN_LINK)) {
    if (target.startsWith("#") || URL_SCHEME.test(target)) continue;
    const resolved = posix.normalize(posix.join(posix.dirname(filePath), target.split("#")[0]));
    if (resolved === CONVENTIONS_PATH || filePaths.has(resolved)) continue;
    errors.push(problem("broken-link", filePath, `link target does not resolve inside the skill: ${target}`));
  }
  return errors;
}

export function validateSkill(skill) {
  const errors = [];
  const filePaths = new Set(skill.files.map((file) => file.path));
  const texts = skill.files.map((file) => ({ path: file.path, text: decoder.decode(file.bytes) }));

  if (filePaths.has(CONVENTIONS_PATH)) {
    errors.push(problem("reserved-file", CONVENTIONS_PATH, "export adds this file; the skill must not ship its own copy"));
  }
  for (const { path, text } of texts) {
    if (COLON_PREFIX.test(text)) errors.push(problem("colon-prefix", path, "use the aaa- hyphen form; the colon form is a removed command name"));
    if (ABSOLUTE_PATH.test(text)) errors.push(problem("absolute-path", path, "absolute local paths do not exist on claude.ai"));
    if (path.endsWith(".md")) errors.push(...linkErrors(path, text, filePaths));
  }

  const skillFile = texts.find((file) => file.path === "SKILL.md");
  if (!skillFile) return [problem("skill-md-missing", "SKILL.md", "the skill folder has no SKILL.md"), ...errors];

  const parsed = parseSkillFile(skillFile.text);
  errors.push(...parsed.errors);
  const { name, description } = parsed.frontmatter;
  for (const key of Object.keys(parsed.frontmatter)) {
    if (!ALLOWED_KEYS.has(key)) errors.push(problem("frontmatter-key", "SKILL.md", `claude.ai skills in this pack use only name and description, not ${key}`));
  }
  if (typeof name !== "string" || !NAME_PATTERN.test(name) || name.length > MAX_NAME_LENGTH) {
    errors.push(problem("name-format", "SKILL.md", `name must match ${NAME_PATTERN} and have at most ${MAX_NAME_LENGTH} characters`));
  }
  if (typeof name === "string" && RESERVED_WORDS.some((word) => name.includes(word))) {
    errors.push(problem("name-reserved", "SKILL.md", "name must not contain claude or anthropic"));
  }
  if (name !== skill.name) errors.push(problem("name-mismatch", "SKILL.md", `name ${String(name)} must equal folder ${skill.name}`));
  if (typeof description !== "string" || description.length < 1 || description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(problem("description-length", "SKILL.md", `description must have 1-${MAX_DESCRIPTION_LENGTH} characters`));
  }
  if (typeof description === "string" && /[<>]/u.test(description)) {
    errors.push(problem("description-angle", "SKILL.md", "description must not contain < or >"));
  }
  if (parsed.body.replace(/\n$/u, "").split("\n").length >= MAX_BODY_LINES) {
    errors.push(problem("body-lines", "SKILL.md", `SKILL.md body must stay under ${MAX_BODY_LINES} lines`));
  }
  return errors;
}

const DOS_TIME = 0x0000;
const DOS_DATE = 0x0021;
const UTF8_FLAG = 0x0800;
const VERSION_NEEDED = 20;
const VERSION_MADE_BY = 0x0314;
const FILE_ATTRIBUTES = (0o100644 << 16) >>> 0;
const DIRECTORY_ATTRIBUTES = ((0o040755 << 16) | 0x10) >>> 0;
const MAX_ENTRIES = 0xffff;
const MAX_OFFSET = 0xffffffff;

function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertEntryPath(path, seen) {
  if (typeof path !== "string" || path === "" || path === "/") throw new TypeError("zip entry path must be a non-empty string");
  if (path.startsWith("/") || path.includes("\\")) throw new TypeError(`zip entry path must be relative with forward slashes: ${path}`);
  if (path.split("/").some((segment) => segment === "..")) throw new TypeError(`zip entry path must not contain ..: ${path}`);
  if (seen.has(path)) throw new TypeError(`duplicate zip entry path: ${path}`);
  seen.add(path);
}

export function createZip(entries) {
  if (!Array.isArray(entries)) throw new TypeError("entries must be an array");
  if (entries.length > MAX_ENTRIES) throw new RangeError("zip entry count exceeds the ZIP32 limit");
  const seen = new Set();
  const sorted = [...entries].sort((left, right) => compareCodeUnits(left.path, right.path));
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of sorted) {
    assertEntryPath(entry.path, seen);
    const directory = entry.path.endsWith("/");
    if (directory && entry.bytes !== undefined) throw new TypeError(`directory entry must not carry bytes: ${entry.path}`);
    if (!directory && !(entry.bytes instanceof Uint8Array)) throw new TypeError(`file entry needs Uint8Array bytes: ${entry.path}`);
    const name = Buffer.from(entry.path, "utf8");
    const data = directory ? Buffer.alloc(0) : zlib.deflateRawSync(entry.bytes, { level: 9 });
    const checksum = directory ? 0 : zlib.crc32(entry.bytes);
    const size = directory ? 0 : entry.bytes.byteLength;
    const method = directory ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(VERSION_MADE_BY, 4);
    central.writeUInt16LE(VERSION_NEEDED, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(directory ? DIRECTORY_ATTRIBUTES : FILE_ATTRIBUTES, 38);
    central.writeUInt32LE(offset, 42);

    localParts.push(local, name, data);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
    if (offset > MAX_OFFSET) throw new RangeError("zip size exceeds the ZIP32 limit");
  }
  const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
  if (offset + centralSize > MAX_OFFSET) throw new RangeError("zip size exceeds the ZIP32 limit");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return new Uint8Array(Buffer.concat([...localParts, ...centralParts, end]));
}

export function buildSkillArchive(skill, conventions) {
  if (skill.files.some((file) => file.path === CONVENTIONS_PATH)) {
    throw new TypeError(`${skill.name} already ships ${CONVENTIONS_PATH}; export adds it`);
  }
  const files = [...skill.files, { path: CONVENTIONS_PATH, bytes: conventions }];
  const directories = new Set([`${skill.name}/`]);
  for (const file of files) {
    const segments = file.path.split("/");
    for (let index = 1; index < segments.length; index += 1) directories.add(`${skill.name}/${segments.slice(0, index).join("/")}/`);
  }
  const entries = [
    ...[...directories].map((path) => ({ path })),
    ...files.map((file) => ({ path: `${skill.name}/${file.path}`, bytes: file.bytes }))
  ];
  return { name: skill.name, fileName: `${skill.name}.zip`, bytes: createZip(entries) };
}

export class PackValidationError extends Error {
  constructor(errors) {
    super(`${errors.length} claude.ai pack validation error(s)`);
    this.name = "PackValidationError";
    this.errors = errors;
  }
}

async function assertNoLink(path, expected) {
  let details;
  try {
    details = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`claude.ai pack is missing a required path: ${path}`);
    throw error;
  }
  if (details.isSymbolicLink()) throw new Error(`claude.ai pack must not contain a symlink: ${path}`);
  if (expected === "file" && !details.isFile()) throw new Error(`claude.ai pack expects a regular file: ${path}`);
  if (expected === "directory" && !details.isDirectory()) throw new Error(`claude.ai pack expects a directory: ${path}`);
}

async function collectFiles(root, relative = "") {
  const files = [];
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    // Finder and editors drop hidden files such as .DS_Store; they must not ship in an upload.
    if (entry.name.startsWith(".")) continue;
    const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`claude.ai pack must not contain a symlink: ${join(root, path)}`);
    if (entry.isDirectory()) files.push(...await collectFiles(root, path));
    else if (entry.isFile()) files.push({ path, bytes: new Uint8Array(await readFile(join(root, path))) });
    else throw new Error(`claude.ai pack expects regular files only: ${join(root, path)}`);
  }
  return files;
}

export async function loadPack(packRoot) {
  const conventionsPath = join(packRoot, "shared", "conventions.md");
  const skillsRoot = join(packRoot, "skills");
  await assertNoLink(conventionsPath, "file");
  await assertNoLink(skillsRoot, "directory");
  const skills = [];
  for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error(`claude.ai pack skills/ holds only skill folders: ${entry.name}`);
    const files = await collectFiles(join(skillsRoot, entry.name));
    files.sort((left, right) => compareCodeUnits(left.path, right.path));
    skills.push({ name: entry.name, files });
  }
  skills.sort((left, right) => compareCodeUnits(left.name, right.name));
  return { conventions: new Uint8Array(await readFile(conventionsPath)), skills };
}
