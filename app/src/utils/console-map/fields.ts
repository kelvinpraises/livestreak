// Mechanical JsonSchema → VerbField derivation for mappers: string → text, number/integer →
// number, enum → select. Object/array/union/unknown properties are skipped (schema defaults
// apply at dispatch; a JSON field can come later), and booleans are skipped because the
// coercion layer's Boolean(raw) would read the string "false" as true — no lying controls.

import type { JsonSchema } from '@livestreak/schema'
import type { VerbField } from '#/types/console'

export const schemaToFields = (
  schema: JsonSchema | undefined,
  overrides: Readonly<Record<string, string>> = {},
  skip: ReadonlySet<string> = new Set()
): VerbField[] => {
  if (schema?.type !== 'object') return []
  return (schema.properties ?? []).flatMap((p): VerbField[] => {
    if (skip.has(p.name)) return []
    const v = p.value
    const preset = overrides[p.name]
    switch (v.type) {
      case 'enum':
        return [
          {
            name: p.name,
            value: preset ?? String(v.default ?? v.values?.[0] ?? ''),
            kind: 'select',
            options: (v.values ?? []).map((label) => ({ label })),
          },
        ]
      case 'number':
      case 'integer':
        return [{ name: p.name, value: preset ?? (v.default !== undefined ? String(v.default) : ''), kind: 'number' }]
      case 'string':
        return [{ name: p.name, value: preset ?? (typeof v.default === 'string' ? v.default : '') }]
      default:
        return []
    }
  })
}
