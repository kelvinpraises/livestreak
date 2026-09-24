// The picker field: choose from what the system already knows instead of typing an id. Fuzzy
// search on top, ~5 rows visible before scroll, radio by default or checkboxes with `multi`.
// Disabled options stay VISIBLE, struck through — "already used" is information, not absence.

import { useMemo, useState } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'
import type { VerbField } from '#/types/console'

/** Subsequence fuzzy match: every query char appears in order. Cheap and forgiving. */
export const fuzzyMatches = (query: string, label: string): boolean => {
  const q = query.toLowerCase()
  const l = label.toLowerCase()
  if (q.length === 0) return true
  let qi = 0
  for (let li = 0; li < l.length && qi < q.length; li++) {
    if (l[li] === q[qi]) qi++
  }
  return qi === q.length
}

const ROW_HEIGHT = 30

export function ConsolePicker({ field }: { readonly field: VerbField }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<readonly string[]>(() =>
    field.value.length > 0 ? field.value.split(' · ') : []
  )

  const options = field.options ?? []
  const visible = useMemo(() => options.filter((o) => fuzzyMatches(query, o.label)), [options, query])

  const toggle = (label: string) => {
    setSelected((prev) => {
      if (field.multi) {
        return prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]
      }
      return [label]
    })
  }

  return (
    <div
      data-testid={`picker-${field.name}`}
      style={{
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 8,
        background: 'rgba(0,0,0,0.2)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 8px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <MagnifyingGlass size={12} color="rgba(255,255,255,0.35)" />
        <input
          data-testid={`picker-search-${field.name}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`search ${field.name}…`}
          style={{
            flex: 1,
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'rgba(255,255,255,0.85)',
          }}
        />
        {selected.length > 0 ? (
          <span style={{ fontSize: 10, color: '#00ff87', fontFamily: 'var(--font-mono)' }}>
            {selected.length} picked
          </span>
        ) : null}
      </div>

      <div style={{ maxHeight: ROW_HEIGHT * 5, overflowY: 'auto' }}>
        {visible.length === 0 ? (
          <p
            style={{
              fontSize: 11,
              color: 'rgba(255,255,255,0.35)',
              fontFamily: 'var(--font-mono)',
              padding: '8px 10px',
              margin: 0,
            }}
          >
            no match
          </p>
        ) : (
          visible.map((option) => {
            const checked = selected.includes(option.label)
            return (
              <label
                key={option.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  height: ROW_HEIGHT,
                  padding: '0 10px',
                  cursor: option.disabled ? 'not-allowed' : 'pointer',
                  opacity: option.disabled ? 0.45 : 1,
                  fontSize: 11.5,
                  fontFamily: 'var(--font-sans)',
                }}
              >
                <input
                  type={field.multi ? 'checkbox' : 'radio'}
                  name={`picker-${field.name}`}
                  value={option.value ?? option.label}
                  checked={checked}
                  disabled={option.disabled}
                  onChange={() => toggle(option.label)}
                  style={{ accentColor: '#00ff87', width: 13, height: 13 }}
                />
                <span
                  style={{
                    flex: 1,
                    color: 'rgba(255,255,255,0.85)',
                    textDecoration: option.disabled ? 'line-through' : 'none',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {option.label}
                </span>
                {option.note ? (
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontFamily: 'var(--font-mono)' }}>
                    {option.note}
                  </span>
                ) : null}
              </label>
            )
          })
        )}
      </div>
    </div>
  )
}
