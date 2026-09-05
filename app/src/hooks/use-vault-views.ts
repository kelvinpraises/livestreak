import { useMemo } from 'react'
import type { VaultView } from '#/types/demo'
import { isOptionsModeEnabled } from '#/utils/env'
import { useOptionsContext } from '#/providers/options-provider'
import { panelToVaultViews } from '#/utils/options'
import { mockVaultViews } from '#/utils/mock'

const EMPTY: VaultView = {}

/**
 * Per-vault display views, projected purely from the board (options mode) or the static fixture
 * (mock mode). Replaces the old render-time mutation of the `mockVaultViews` module global (A7):
 * the projection is memoized, never written to a shared global during render.
 */
export function useVaultViews(): Record<string, VaultView> {
  const optionsEnabled = isOptionsModeEnabled()
  const { board, isConnected } = useOptionsContext()
  return useMemo(() => {
    if (optionsEnabled && isConnected && board) return panelToVaultViews(board.panel)
    if (optionsEnabled) return {}
    return mockVaultViews
  }, [optionsEnabled, isConnected, board])
}

export function useVaultView(vaultId: string): VaultView {
  const views = useVaultViews()
  return views[vaultId] ?? EMPTY
}
