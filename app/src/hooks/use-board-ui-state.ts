import { useCallback, useState } from 'react'

/**
 * A1/S5 — UI interaction state that SURVIVES the board's periodic data refresh (and even a remount
 * of the panel subtree). The live board polls every few seconds; previously the active tab and a
 * card's expanded/selected-side/amount lived in component-local `useState`, so any refresh that
 * remounted the right-panel threw a mid-fund user back to step 0 (tab → STREAMS, panel collapsed).
 *
 * This is a tiny module-level store (per session, keyed by streamId / vaultId). React state is
 * seeded FROM the store and written THROUGH to it, so a remount re-seeds from the last value instead
 * of the default. The refresh only ever updates numbers — it can never collapse the control the user
 * is interacting with.
 */

export type BoardTab = 'feed' | 'mine' | 'vaults'

interface VaultCardUi {
  expanded: boolean
  side: 'yes' | 'no' | null
  rate: number
}

const DEFAULT_VAULT_UI: VaultCardUi = { expanded: false, side: null, rate: 0 }

const tabByStream = new Map<string, BoardTab>()
const uiByVault = new Map<string, VaultCardUi>()

/** Active right-panel tab for a stream — persists across data refreshes. */
export function useStreamTab(
  streamId: string,
  fallback: BoardTab = 'mine',
): readonly [BoardTab, (next: BoardTab) => void] {
  const [tab, setTabState] = useState<BoardTab>(() => tabByStream.get(streamId) ?? fallback)
  const setTab = useCallback((next: BoardTab) => {
    tabByStream.set(streamId, next)
    setTabState(next)
  }, [streamId])
  return [tab, setTab] as const
}

/** A vault card's expanded/side/amount — persists across data refreshes. */
export function useVaultCardUi(vaultId: string) {
  const seed = uiByVault.get(vaultId) ?? DEFAULT_VAULT_UI
  const [expanded, setExpandedRaw] = useState(seed.expanded)
  const [side, setSideRaw] = useState<'yes' | 'no' | null>(seed.side)
  const [rate, setRateRaw] = useState(seed.rate)

  const persist = useCallback((patch: Partial<VaultCardUi>) => {
    const prev = uiByVault.get(vaultId) ?? DEFAULT_VAULT_UI
    uiByVault.set(vaultId, { ...prev, ...patch })
  }, [vaultId])

  const setExpanded = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setExpandedRaw(prev => {
      const value = typeof next === 'function' ? next(prev) : next
      persist({ expanded: value })
      return value
    })
  }, [persist])

  const setSide = useCallback((next: 'yes' | 'no' | null) => {
    persist({ side: next })
    setSideRaw(next)
  }, [persist])

  const setRate = useCallback((next: number) => {
    persist({ rate: next })
    setRateRaw(next)
  }, [persist])

  return { expanded, setExpanded, side, setSide, rate, setRate } as const
}
