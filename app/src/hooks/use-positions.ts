import type { Position } from '#/types/demo'
import { useOptionsContext } from '#/providers/options-provider'
import { panelToPositions } from '#/utils/options'
import { usePreferFixture, useParsedFixture } from '#/hooks/use-fixture-mode'

export function usePositions(streamId?: string): Position[] {
  const preferFixture = usePreferFixture()
  const parsed = useParsedFixture()
  const { board } = useOptionsContext()

  if (!preferFixture && board) {
    return panelToPositions(board.panel, streamId)
  }

  if (!preferFixture) return []

  return streamId
    ? parsed.positions.filter(p => {
        const vault = parsed.vaults.find(v => v.vaultId === p.vaultId)
        return vault?.marketId === streamId
      })
    : parsed.positions
}
