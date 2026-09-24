// One Attention card: a POINTER, never a control. Clicking only moves Focus to its target.
// Four tones: do (your move), wait (someone else's move — dashed, named party in the copy),
// err (a thing needs you), good (a quiet all-clear).

import { HourglassMedium } from '@phosphor-icons/react'
import type { AttentionCard } from '#/types/console'

const TONE_BORDER: Record<AttentionCard['tone'], string> = {
  do: '1px solid rgba(255,255,255,0.12)',
  wait: '1px dashed rgba(255,255,255,0.2)',
  err: '1px solid rgba(255,45,120,0.4)',
  good: '1px solid rgba(0,255,135,0.3)',
}

const TONE_TITLE: Record<AttentionCard['tone'], string> = {
  do: 'rgba(255,255,255,0.9)',
  wait: 'rgba(255,255,255,0.45)',
  err: '#ff2d78',
  good: '#00ff87',
}

export function ConsoleAttentionCard({
  card,
  onJump,
}: {
  readonly card: AttentionCard
  readonly onJump: (targetId: string) => void
}) {
  return (
    <button
      type="button"
      data-testid={`attention-${card.targetId}`}
      onClick={() => onJump(card.targetId)}
      style={{
        textAlign: 'left',
        width: '100%',
        background: 'rgba(255,255,255,0.02)',
        border: TONE_BORDER[card.tone],
        borderRadius: 10,
        padding: '9px 10px',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
      }}
    >
      <p
        style={{
          fontSize: 12,
          fontWeight: 600,
          margin: 0,
          color: TONE_TITLE[card.tone],
          display: 'flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        {card.tone === 'wait' ? <HourglassMedium size={11} /> : null}
        {card.title}
      </p>
      <p style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)', margin: '2px 0 0' }}>{card.detail}</p>
    </button>
  )
}
