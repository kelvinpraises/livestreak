import { useCallback, useState } from 'react'
import { useVaultView } from '#/hooks/use-vault-views'

type Side = 'yes' | 'no'

export interface StreamDraft {
  side: Side | null
  rate: number
  /** True while an uncommitted local edit is overlaying the on-chain value. */
  editing: boolean
  setSide: (side: Side) => void
  setRate: (rate: number) => void
  change: (side: Side | null, rate: number) => void
  clear: () => void
}

/**
 * The side + rate a funding card shows. The committed on-chain position is the shared global truth;
 * a local draft overlays it only while you edit this card, and clears on commit so the card snaps back
 * to global. Every card reads the same global, so they stay in sync — the same shape as use-lane-editor.
 */
export function useStreamDraft(vaultId: string): StreamDraft {
  const { userPosition } = useVaultView(vaultId)
  const globalSide = userPosition?.side ?? null
  const globalRate = userPosition?.rate ?? 0

  const [draft, setDraft] = useState<{ side: Side | null; rate: number } | null>(null)

  // Dead-centre (null side) from a pausable slider = PAUSE: overlay rate 0 on the committed side so the
  // card's action resolves to `stop` (≡ pause). With no committed stream it's just a cancel (clear). A
  // real side+rate overlays as the live edit.
  const change = useCallback(
    (side: Side | null, rate: number) =>
      setDraft(side === null ? (globalSide ? { side: globalSide, rate: 0 } : null) : { side, rate }),
    [globalSide]
  )
  const setSide = useCallback((side: Side) => setDraft(d => ({ side, rate: d?.rate ?? globalRate })), [globalRate])
  const setRate = useCallback((rate: number) => setDraft(d => ({ side: d?.side ?? globalSide, rate })), [globalSide])
  const clear = useCallback(() => setDraft(null), [])

  return {
    side: draft?.side ?? globalSide,
    rate: draft?.rate ?? globalRate,
    editing: draft !== null,
    setSide,
    setRate,
    change,
    clear,
  }
}
