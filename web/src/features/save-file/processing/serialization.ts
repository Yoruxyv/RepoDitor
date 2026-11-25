import { isLosslessNumber, LosslessNumber, parse } from "lossless-json";

export type SaveObject = Record<string, unknown>;

export class SaveSerializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaveSerializationError";
  }
}

export function isSaveObject(value: unknown): value is SaveObject {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && !isSaveNumber(value)
  );
}

export function isSaveNumber(value: unknown): value is LosslessNumber {
  return isLosslessNumber(value) && value instanceof LosslessNumber;
}

function checkObjectKey(token: string, keys: Set<string>): void {
  // Decode only the quoted key, never an object whose duplicate entries could disappear.
  const key = JSON.parse(token) as string;
  if (key === "__proto__") {
    throw new SaveSerializationError(
      "The decrypted save contains an unsafe '__proto__' field and was not loaded.",
    );
  }
  if (keys.has(key)) {
    throw new SaveSerializationError(`The decrypted save contains a duplicate '${key}' field.`);
  }
  keys.add(key);
}

function rejectUnsafeKeys(source: string): void {
  const scopes: (Set<string> | null)[] = [];
  let previous = "";
  // Strings are indivisible tokens, so punctuation inside their contents cannot change scope.
  for (const [token] of source.matchAll(/"(?:[^"\\]|\\[\s\S])*"|[{}[\],]/gu)) {
    if (token === "{") {
      scopes.push(new Set());
    } else if (token === "[") {
      scopes.push(null);
    } else if (token === "}" || token === "]") {
      scopes.pop();
    } else {
      const keys = scopes.at(-1);
      if (keys && token.startsWith('"') && (previous === "{" || previous === ",")) {
        checkObjectKey(token, keys);
      }
    }
    previous = token;
  }
  // The scan only inspects keys; the platform still validates the complete JSON grammar.
  JSON.parse(source);
}

export function parseSaveJson(source: string): SaveObject {
  try {
    rejectUnsafeKeys(source);
    const value = parse(source, null, {
      onDuplicateKey: ({ key }) => {
        throw new SaveSerializationError(`The decrypted save contains a duplicate '${key}' field.`);
      },
    });
    if (!isSaveObject(value)) {
      throw new SaveSerializationError("The decrypted save root is not a JSON object.");
    }
    return value;
  } catch (error) {
    if (error instanceof SaveSerializationError) {
      throw error;
    }
    throw new SaveSerializationError("The decrypted save does not contain valid JSON.");
  }
}

function serializeValue(value: unknown, indent: string, ancestors: Set<object>): string {
  if (isSaveNumber(value)) {
    return value.value;
  }
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return serializeArray(value, indent, ancestors);
  }
  if (isSaveObject(value)) {
    return serializeObject(value, indent, ancestors);
  }
  throw new SaveSerializationError("The in-memory save contains a value that is not valid JSON.");
}

function serializeArray(value: unknown[], indent: string, ancestors: Set<object>): string {
  return serializeContainer(value, ancestors, () => {
    if (value.length === 0) {
      return "[]";
    }
    const childIndent = `${indent}    `;
    const separator = `,\n${childIndent}`;
    const entries = value.map((entry) => serializeValue(entry, childIndent, ancestors));
    return `[\n${childIndent}${entries.join(separator)}\n${indent}]`;
  });
}

function serializeObject(value: SaveObject, indent: string, ancestors: Set<object>): string {
  return serializeContainer(value, ancestors, () => {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return "{}";
    }
    const childIndent = `${indent}    `;
    const separator = `,\n${childIndent}`;
    const entries = keys.map(
      (key) => `${JSON.stringify(key)}: ${serializeValue(value[key], childIndent, ancestors)}`,
    );
    return `{\n${childIndent}${entries.join(separator)}\n${indent}}`;
  });
}

function serializeContainer(
  value: object,
  ancestors: Set<object>,
  serialize: () => string,
): string {
  if (ancestors.has(value)) {
    throw new SaveSerializationError("The in-memory save contains a circular reference.");
  }
  ancestors.add(value);
  try {
    return serialize();
  } finally {
    ancestors.delete(value);
  }
}

export function serializeSaveJson(data: SaveObject): string {
  const source = serializeValue(data, "", new Set());
  parseSaveJson(source);
  return source;
}
