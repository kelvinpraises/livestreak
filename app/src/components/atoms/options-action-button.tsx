import { useState, useCallback } from 'react'
import type { OptionsFunctionView } from '@livestreak/options'

interface Props {
  label: string
  fn?: OptionsFunctionView
  onAction: () => void | Promise<unknown>
  variant?: 'green' | 'red' | 'ghost'
  compact?: boolean
}

export function OptionsActionButton({ label, fn, onAction, variant = 'green', compact = false }: Props) {
  const [busy, setBusy] = useState(false)
  const disabled = fn === undefined || fn.disabled || busy
  const title = fn?.disabledReason

  const handleClick = useCallback(async () => {
    if (disabled) return
    setBusy(true)
    try {
      await onAction()
    } finally {
      setBusy(false)
    }
  }, [disabled, onAction])

  const colors = variant === 'green'
    ? { bg: 'rgba(0,255,135,0.12)', border: 'rgba(0,255,135,0.35)', text: '#00ff87' }
    : variant === 'red'
      ? { bg: 'rgba(255,45,120,0.12)', border: 'rgba(255,45,120,0.35)', text: '#ff2d78' }
      : { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.12)', text: 'rgba(255,255,255,0.7)' }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      title={title}
      className={variant === 'ghost' ? 'btn-ghost' : undefined}
      style={{
        fontSize: compact ? 10 : 11,
        padding: compact ? '4px 10px' : '6px 12px',
        borderRadius: 6,
        border: `1px solid ${colors.border}`,
        background: colors.bg,
        color: colors.text,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        fontFamily: 'var(--font-sans)',
      }}
    >
      {busy ? '...' : label}
    </button>
  )
}
