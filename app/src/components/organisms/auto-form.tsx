// The generic JsonSchema → form renderer (the heart of P5). Given a function's
// `inputSchema` it renders one control per free top-level property; ids that come from
// the function's `target` / connected account are passed in `prefilled` and are NOT
// asked for (they are merged into the submitted args). On submit it coerces every
// field via the pure helpers and reports either typed args or per-field errors.

import { useCallback, useMemo, useState } from 'react'
import type { JsonSchema, JsonSchemaProperty } from '@livestreak/schema'
import { coerceArgs, defaultFieldValue } from '#/utils/auto-form-schema'

interface Props {
  readonly inputSchema?: JsonSchema
  readonly prefilled?: Record<string, unknown>
  readonly onSubmit: (args: Record<string, unknown>) => void | Promise<unknown>
  readonly submitLabel: string
  readonly disabled?: boolean
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  color: 'rgba(255,255,255,0.5)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  fontSize: 12,
  padding: '6px 8px',
  borderRadius: 6,
  border: '1px solid rgba(255,255,255,0.12)',
  background: 'rgba(255,255,255,0.04)',
  color: 'rgba(255,255,255,0.9)',
  fontFamily: 'var(--font-sans)',
}

export function AutoForm({ inputSchema, prefilled = {}, onSubmit, submitLabel, disabled }: Props) {
  const properties = useMemo<readonly JsonSchemaProperty[]>(
    () => (inputSchema && inputSchema.type === 'object' ? inputSchema.properties ?? [] : []),
    [inputSchema]
  )
  const freeProps = useMemo(
    () => properties.filter((p) => !(p.name in prefilled)),
    [properties, prefilled]
  )

  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const init: Record<string, unknown> = {}
    for (const p of freeProps) init[p.name] = defaultFieldValue(p.value)
    return init
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const setField = useCallback((name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }))
  }, [])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      const result = coerceArgs(inputSchema, values, prefilled)
      if (!result.ok) {
        setErrors(result.errors)
        return
      }
      setErrors({})
      setBusy(true)
      try {
        await onSubmit(result.values)
      } finally {
        setBusy(false)
      }
    },
    [inputSchema, values, prefilled, onSubmit]
  )

  return (
    <form data-testid="auto-form" onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {freeProps.map((prop) => (
        <Field
          key={prop.name}
          prop={prop}
          value={values[prop.name]}
          error={errors[prop.name]}
          onChange={(v) => setField(prop.name, v)}
        />
      ))}
      <button
        data-testid="auto-form-submit"
        type="submit"
        disabled={disabled || busy}
        style={{
          marginTop: 2,
          fontSize: 11,
          padding: '6px 12px',
          borderRadius: 6,
          border: '1px solid rgba(0,255,135,0.35)',
          background: 'rgba(0,255,135,0.12)',
          color: '#00ff87',
          fontWeight: 600,
          cursor: disabled || busy ? 'not-allowed' : 'pointer',
          opacity: disabled || busy ? 0.45 : 1,
          fontFamily: 'var(--font-sans)',
        }}
      >
        {busy ? '...' : submitLabel}
      </button>
    </form>
  )
}

interface FieldProps {
  readonly prop: JsonSchemaProperty
  readonly value: unknown
  readonly error?: string
  readonly onChange: (value: unknown) => void
}

function Field({ prop, value, error, onChange }: FieldProps) {
  const { value: schema, name, help } = prop
  const labelText = schema.description ?? name

  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }} title={help}>
      <span style={labelStyle}>
        {labelText}
        {schema.required ? <span style={{ color: '#ff2d78' }}> *</span> : null}
      </span>
      <Control schema={schema} value={value} onChange={onChange} name={name} />
      {error ? (
        <span style={{ fontSize: 10, color: '#ff2d78', fontFamily: 'var(--font-mono)' }}>{error}</span>
      ) : null}
    </label>
  )
}

function Control({
  schema,
  value,
  onChange,
  name,
}: {
  schema: JsonSchema
  value: unknown
  onChange: (value: unknown) => void
  name: string
}) {
  const testId = `auto-form-field-${name}`
  switch (schema.type) {
    case 'boolean':
      return (
        <input
          data-testid={testId}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          style={{ width: 16, height: 16, accentColor: '#00ff87' }}
        />
      )
    case 'enum':
      return (
        <select
          data-testid={testId}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        >
          {!schema.required ? <option value="">—</option> : null}
          {(schema.values ?? []).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      )
    case 'number':
    case 'integer':
      return (
        <input
          data-testid={testId}
          type="number"
          step={schema.type === 'integer' ? 1 : 'any'}
          value={value === undefined || value === null ? '' : String(value)}
          placeholder={schema.description}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      )
    case 'object':
    case 'array':
    case 'union':
    case 'unknown':
      return (
        <textarea
          data-testid={testId}
          rows={3}
          value={typeof value === 'string' ? value : value ? JSON.stringify(value, null, 2) : ''}
          placeholder="JSON"
          onChange={(e) => onChange(e.target.value)}
          style={{ ...inputStyle, fontFamily: 'var(--font-mono)', resize: 'vertical' }}
        />
      )
    case 'string':
    default:
      return (
        <input
          data-testid={testId}
          type="text"
          value={String(value ?? '')}
          placeholder={schema.description}
          onChange={(e) => onChange(e.target.value)}
          style={inputStyle}
        />
      )
  }
}
