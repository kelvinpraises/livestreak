// Pure JsonSchema → form coercion/validation helpers for the Remote Bridge Console
// auto-form renderer (P5). No React/DOM here so the coercion rules are unit-testable
// in isolation. Mirrors the schema→field table in audit/scope-app.md §P5.2 against the
// canonical `JsonSchema` shape shipped in @livestreak/schema.

import type { JsonSchema, JsonSchemaProperty } from '@livestreak/schema'

export interface CoerceResult {
  readonly value?: unknown
  readonly error?: string
}

const isBlank = (raw: unknown): boolean =>
  raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')

// The initial form value for a schema node (drives controlled inputs).
export function defaultFieldValue(schema: JsonSchema): unknown {
  if (schema.default !== undefined) return schema.default
  switch (schema.type) {
    case 'boolean':
      return false
    case 'object':
      return {}
    case 'array':
      return []
    case 'enum':
      return schema.values?.[0] ?? ''
    default:
      return ''
  }
}

// Coerce one raw field value (typically a string from an <input>) into the typed
// value the bridge envelope expects, or return a human-readable error. Recurses for
// object/array/union nodes.
export function coerceField(schema: JsonSchema, raw: unknown): CoerceResult {
  switch (schema.type) {
    case 'string': {
      const value = typeof raw === 'string' ? raw.trim() : raw == null ? '' : String(raw)
      if (schema.required && value === '') return { error: 'Required' }
      return { value }
    }
    case 'number':
    case 'integer': {
      if (isBlank(raw)) {
        return schema.required ? { error: 'Required' } : { value: undefined }
      }
      const n = Number(raw)
      if (Number.isNaN(n)) return { error: 'Must be a number' }
      if (schema.type === 'integer' && !Number.isInteger(n)) return { error: 'Must be a whole number' }
      return { value: n }
    }
    case 'boolean':
      return { value: Boolean(raw) }
    case 'enum': {
      const value = raw == null ? '' : String(raw)
      if (schema.required && value === '') return { error: 'Required' }
      if (value !== '' && schema.values && !schema.values.includes(value)) {
        return { error: 'Not an allowed value' }
      }
      return { value }
    }
    case 'object': {
      const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const prop of schema.properties ?? []) {
        const res = coerceField(prop.value, record[prop.name])
        if (res.error) return { error: `${prop.name}: ${res.error}` }
        if (res.value !== undefined) out[prop.name] = res.value
      }
      return { value: out }
    }
    case 'array': {
      const arr = Array.isArray(raw) ? raw : []
      if (schema.required && arr.length === 0) return { error: 'At least one item required' }
      const out: unknown[] = []
      for (const item of arr) {
        if (!schema.items) {
          out.push(item)
          continue
        }
        const res = coerceField(schema.items, item)
        if (res.error) return { error: res.error }
        if (res.value !== undefined) out.push(res.value)
      }
      return { value: out }
    }
    case 'union':
    case 'unknown':
    default: {
      // Free-form JSON fallback (a <textarea>). Empty optional → omitted.
      if (isBlank(raw)) return schema.required ? { error: 'Required' } : { value: undefined }
      if (typeof raw !== 'string') return { value: raw }
      try {
        return { value: JSON.parse(raw) }
      } catch {
        return { error: 'Invalid JSON' }
      }
    }
  }
}

export interface CoerceArgsResult {
  readonly ok: boolean
  readonly values: Record<string, unknown>
  readonly errors: Record<string, string>
}

// Coerce a flat record of the free top-level inputs of a function's object inputSchema.
// `prefilled` (target ids, connected account) are merged in verbatim and never validated
// against the form — they come from context, not the user (scope-app §P5.2).
export function coerceArgs(
  inputSchema: JsonSchema | undefined,
  record: Record<string, unknown>,
  prefilled: Record<string, unknown> = {}
): CoerceArgsResult {
  const errors: Record<string, string> = {}
  const values: Record<string, unknown> = { ...prefilled }

  const properties: readonly JsonSchemaProperty[] =
    inputSchema && inputSchema.type === 'object' ? inputSchema.properties ?? [] : []

  for (const prop of properties) {
    if (prop.name in prefilled) continue // supplied from context; hidden from the form
    const res = coerceField(prop.value, record[prop.name])
    if (res.error) {
      errors[prop.name] = res.error
    } else if (res.value !== undefined) {
      values[prop.name] = res.value
    }
  }

  // A non-object inputSchema (rare) is carried as a single `value` field.
  if (inputSchema && inputSchema.type !== 'object') {
    const res = coerceField(inputSchema, record.value)
    if (res.error) errors.value = res.error
    else if (res.value !== undefined) values.value = res.value
  }

  return { ok: Object.keys(errors).length === 0, values, errors }
}

// Which top-level property names are satisfied from context (and therefore hidden).
export function contextKeys(prefilled: Record<string, unknown>): ReadonlySet<string> {
  return new Set(Object.keys(prefilled))
}
