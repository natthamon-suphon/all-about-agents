const TYPE_NAMES = new Set(["array", "boolean", "integer", "null", "number", "object", "string"]);

function typeMatches(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function pointerSegment(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}

function deepEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length && left.every((item, index) => deepEqual(item, right[index]));
  if (typeof left === "object") {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length && leftKeys.every((key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]));
  }
  return false;
}

function resolvePointer(root, reference) {
  if (!reference.startsWith("#/") && reference !== "#") return null;
  if (reference === "#") return root;
  let current = root;
  for (const rawSegment of reference.slice(2).split("/")) {
    const segment = rawSegment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, segment)) return null;
    current = current[segment];
  }
  return current;
}

function validateValue(schema, value, path, errors, root) {
  if (schema === true) return;
  if (schema === false) {
    errors.push({ sourcePath: root.sourcePath, jsonPointer: path, keyword: "falseSchema", message: "value is rejected by a false schema" });
    return;
  }
  if (schema === null || typeof schema !== "object") {
    errors.push({ sourcePath: root.sourcePath, jsonPointer: path, keyword: "schema", message: "schema must be an object, true, or false" });
    return;
  }
  if (typeof schema.$ref === "string") {
    const target = resolvePointer(root.schema, schema.$ref);
    if (target === null) {
      errors.push({ sourcePath: root.sourcePath, jsonPointer: path, keyword: "$ref", message: `unresolved schema reference ${schema.$ref}` });
    } else {
      validateValue(target, value, path, errors, root);
    }
    return;
  }
  if (Array.isArray(schema.allOf)) {
    schema.allOf.forEach((branch) => validateValue(branch, value, path, errors, root));
  }
  for (const keyword of ["anyOf", "oneOf"]) {
    if (!Array.isArray(schema[keyword])) continue;
    const branchResults = schema[keyword].map((branch) => {
      const branchErrors = [];
      validateValue(branch, value, path, branchErrors, root);
      return branchErrors;
    });
    const matches = branchResults.filter((branchErrors) => branchErrors.length === 0).length;
    const valid = keyword === "anyOf" ? matches >= 1 : matches === 1;
    if (!valid) {
      errors.push({ sourcePath: root.sourcePath, jsonPointer: path, keyword, message: keyword === "anyOf" ? "value must match at least one schema" : "value must match exactly one schema" });
    }
  }
  if (schema.const !== undefined && !deepEqual(value, schema.const)) {
    errors.push({ sourcePath: root.sourcePath, jsonPointer: path, keyword: "const", message: `must equal ${JSON.stringify(schema.const)}` });
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => deepEqual(item, value))) {
    errors.push({ sourcePath: root.sourcePath, jsonPointer: path, keyword: "enum", message: "must be one of the allowed values" });
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const validType = types.every((type) => typeof type === "string" && TYPE_NAMES.has(type)) && types.some((type) => typeMatches(value, type));
    if (!validType) {
      errors.push({ sourcePath: root.sourcePath, jsonPointer: path, keyword: "type", message: `must be ${types.join(" or ")}` });
      return;
    }
  }
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (Number.isInteger(schema.minLength) && [...value].length < schema.minLength) errors.push({ sourcePath: root.sourcePath, jsonPointer: path, keyword: "minLength", message: `must contain at least ${schema.minLength} characters` });
    if (Number.isInteger(schema.maxLength) && [...value].length > schema.maxLength) errors.push({ sourcePath: root.sourcePath, jsonPointer: path, keyword: "maxLength", message: `must contain at most ${schema.maxLength} characters` });
    if (typeof schema.pattern === "string") {
      let matches = false;
      try { matches = new RegExp(schema.pattern, "u").test(value); } catch { /* malformed patterns are reported below */ }
      if (!matches) errors.push({ sourcePath: root.sourcePath, jsonPointer: path, keyword: "pattern", message: `must match ${schema.pattern}` });
    }
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) errors.push({ sourcePath: root.sourcePath, jsonPointer: path, keyword: "minimum", message: `must be at least ${schema.minimum}` });
    if (typeof schema.maximum === "number" && value > schema.maximum) errors.push({ sourcePath: root.sourcePath, jsonPointer: path, keyword: "maximum", message: `must be at most ${schema.maximum}` });
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) errors.push({ sourcePath: root.sourcePath, jsonPointer: path, keyword: "minItems", message: `must contain at least ${schema.minItems} items` });
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) errors.push({ sourcePath: root.sourcePath, jsonPointer: path, keyword: "maxItems", message: `must contain at most ${schema.maxItems} items` });
    if (schema.uniqueItems === true) {
      for (let index = 0; index < value.length; index += 1) {
        if (value.slice(0, index).some((item) => deepEqual(item, value[index]))) errors.push({ sourcePath: root.sourcePath, jsonPointer: path, keyword: "uniqueItems", message: "items must be unique" });
      }
    }
    if (schema.items !== undefined) value.forEach((item, index) => validateValue(schema.items, item, `${path}/${index}`, errors, root));
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!Object.hasOwn(value, key)) errors.push({ sourcePath: root.sourcePath, jsonPointer: `${path}/${pointerSegment(key)}`, keyword: "required", message: `required property ${key} is missing` });
      }
    }
    if (schema.additionalProperties === false) {
      const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(properties, key)) errors.push({ sourcePath: root.sourcePath, jsonPointer: `${path}/${pointerSegment(key)}`, keyword: "additionalProperties", message: `property ${key} is not declared` });
      }
    }
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
      for (const [key, child] of Object.entries(value)) {
        if (!Object.hasOwn(properties, key)) validateValue(schema.additionalProperties, child, `${path}/${pointerSegment(key)}`, errors, root);
      }
    }
    if (schema.properties && typeof schema.properties === "object") {
      for (const [key, childSchema] of Object.entries(schema.properties)) {
        if (Object.hasOwn(value, key)) validateValue(childSchema, value[key], `${path}/${pointerSegment(key)}`, errors, root);
      }
    }
  }
}

export function validateSchema({ schema, value, sourcePath }) {
  const errors = [];
  const normalizedSourcePath = typeof sourcePath === "string" && sourcePath.length > 0 ? sourcePath : "<unknown>";
  validateValue(schema, value, "", errors, { schema, sourcePath: normalizedSourcePath });
  return { valid: errors.length === 0, errors };
}
