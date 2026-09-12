import { useCallback, useState } from 'react'

/**
 * UI interaction state that survives the board's periodic data refresh (and a remount of the panel
 * subtree): the active tab and a card's expanded state. A tiny module-level store, keyed by
 * streamId / vaultId, seeds React state and is written through — so a refresh only ever updates the
 * numbers, never collapses the control the user is interacting with. Side + rate are NOT here: they
 * live in useStreamDraft as a draft over the on-chain position.
 */

export type BoardTab = 'feed' | 'mine' | 'vaults'

const tabByStream = new Map<string, BoardTab>()
const expandedByVault = new Map<string, boolean>()

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

export function useVaultCardUi(vaultId: string) {
  const [expanded, setExpandedRaw] = useState(() => expandedByVault.get(vaultId) ?? false)
  const setExpanded = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setExpandedRaw(prev => {
      const value = typeof next === 'function' ? next(prev) : next
      expandedByVault.set(vaultId, value)
      return value
    })
  }, [vaultId])
  return { expanded, setExpanded } as const
}
