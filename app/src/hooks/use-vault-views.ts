import { useMemo } from 'react'
import type { VaultView } from '#/types/ui'
import { useOptionsContext } from '#/providers/options-provider'
import { panelToVaultViews } from '#/utils/options'

const EMPTY: VaultView = {}

export function useVaultViews(): Record<string, VaultView> {
  const { board } = useOptionsContext()
  return useMemo(() => board ? panelToVaultViews(board.panel) : {}, [board])
}

export function useVaultView(vaultId: string): VaultView {
  const views = useVaultViews()
  return views[vaultId] ?? EMPTY
}
