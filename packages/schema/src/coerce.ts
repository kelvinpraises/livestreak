// Schema-driven arg coercion. JSON transports have no bigint, so descriptors mark such fields with
// format:"bigint" and every bridge coerces THROUGH ITS OWN DESCRIPTOR — the descriptor is the single
// source of which fields are chain integers. Unknown/extra fields pass through untouched; the
// package's own validation stays the authority on shape.

import type { JsonSchema } from "./descriptor.js";

export class SchemaCoercionError extends Error {
  constructor(path: string, value: unknown) {
    super(`${path} must be a bigint-compatible value, got ${describe(value)}`);
    this.name = "SchemaCoercionError";
  }
}

const describe = (value: unknown): string =>
  value === null ? "null" : Array.isArray(value) ? "array" : typeof value;

export const coerceValueBySchema = (schema: JsonSchema, value: unknown, path = "$"): unknown => {
  if (value === undefined || value === null) {
    return value;
  }

  if (schema.format === "bigint") {
    if (typeof value === "bigint") {
      return value;
    }
    if (typeof value === "string" || typeof value === "number") {
      try {
        return BigInt(value);
      } catch {
        throw new SchemaCoercionError(path, value);
      }
    }
    throw new SchemaCoercionError(path, value);
  }

  if (schema.type === "object" && schema.properties !== undefined) {
    if (typeof value !== "object" || Array.isArray(value)) {
      return value;
    }
    const record = { ...(value as Record<string, unknown>) };
    for (const property of schema.properties) {
      if (record[property.name] !== undefined) {
        record[property.name] = coerceValueBySchema(
          property.value,
          record[property.name],
          `${path}.${property.name}`
        );
      }
    }
    return record;
  }

  if (schema.type === "array" && schema.items !== undefined && Array.isArray(value)) {
    return value.map((item, index) => coerceValueBySchema(schema.items!, item, `${path}[${index}]`));
  }

  return value;
};

/** Coerce a console action's args through its input schema; no schema (or non-object args) = passthrough. */
export const coerceArgsBySchema = (schema: JsonSchema | undefined, args: unknown): unknown =>
  schema === undefined ? args : coerceValueBySchema(schema, args);
