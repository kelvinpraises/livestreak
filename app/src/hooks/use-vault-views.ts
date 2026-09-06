import { useMemo } from 'react'
import type { VaultView } from '#/types/demo'
import { useOptionsContext } from '#/providers/options-provider'
import { panelToVaultViews } from '#/utils/options'
import { usePreferFixture, useParsedFixture } from '#/hooks/use-fixture-mode'

const EMPTY: VaultView = {}

export function useVaultViews(): Record<string, VaultView> {
  const preferFixture = usePreferFixture()
  const parsed = useParsedFixture()
  const { board } = useOptionsContext()

  return useMemo(() => {
    if (!preferFixture && board) return panelToVaultViews(board.panel)
    if (!preferFixture) return {}
    return parsed.vaultViews
  }, [preferFixture, board, parsed])
}

export function useVaultView(vaultId: string): VaultView {
  const views = useVaultViews()
  return views[vaultId] ?? EMPTY
}
