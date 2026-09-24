// Attention: the stack of pointers — your next move, arriving trouble, and named waits on other
// parties. Never hosts a control; every click only moves Focus.

import type { AttentionCard } from '#/types/console'
import { ConsoleAttentionCard } from '#/components/molecules/console-attention-card'

export function ConsoleAttention({
  cards,
  onJump,
}: {
  readonly cards: readonly AttentionCard[]
  readonly onJump: (targetId: string) => void
}) {
  if (cards.length === 0) {
    return (
      <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', fontFamily: 'var(--font-mono)' }}>
        nothing needs you
      </p>
    )
  }
  return (
    <div data-testid="console-attention" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {cards.map((card) => (
        <ConsoleAttentionCard key={`${card.targetId}-${card.title}`} card={card} onJump={onJump} />
      ))}
    </div>
  )
}
