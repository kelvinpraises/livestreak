import { useCallback, useSyncExternalStore } from 'react'
import { useVaultView } from '#/hooks/use-vault-views'

type Side = 'yes' | 'no'
type Draft = { side: Side | null; rate: number }
const drafts = new Map<string, Draft>()
const listeners = new Map<string, Set<() => void>>()
function writeDraft(vaultId: string, next: Draft | null) {
  if (next) drafts.set(vaultId, next); else drafts.delete(vaultId)
  listeners.get(vaultId)?.forEach(notify => notify())
}

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

  const subscribe = useCallback((notify: () => void) => {
    const subscribers = listeners.get(vaultId) ?? new Set<() => void>()
    listeners.set(vaultId, subscribers); subscribers.add(notify)
    return () => { subscribers.delete(notify); if (!subscribers.size) listeners.delete(vaultId) }
  }, [vaultId])
  const snapshot = useCallback(() => drafts.get(vaultId) ?? null, [vaultId])
  const draft = useSyncExternalStore(subscribe, snapshot, () => null)

  // Dead-centre (null side) from a pausable slider = PAUSE: overlay rate 0 on the committed side so the
  // card's action resolves to `stop` (≡ pause). With no committed stream it's just a cancel (clear). A
  // real side+rate overlays as the live edit.
  const change = useCallback(
    (side: Side | null, rate: number) =>
      writeDraft(vaultId, side === null ? (globalSide ? { side: globalSide, rate: 0 } : null) : { side, rate }),
    [globalSide, vaultId]
  )
  const setSide = useCallback((side: Side) => writeDraft(vaultId, { side, rate: drafts.get(vaultId)?.rate ?? globalRate }), [globalRate, vaultId])
  const setRate = useCallback((rate: number) => writeDraft(vaultId, { side: drafts.get(vaultId)?.side ?? globalSide, rate }), [globalSide, vaultId])
  const clear = useCallback(() => writeDraft(vaultId, null), [vaultId])

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
