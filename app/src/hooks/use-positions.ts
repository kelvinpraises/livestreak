import { mockPositions, type Position } from '#/utils/mock'
import { isOptionsModeEnabled } from '#/utils/env'
import { useOptionsContext } from '#/providers/options-provider'
import { panelToPositions } from '#/utils/options'

export function usePositions(streamId?: string): Position[] {
  const optionsEnabled = isOptionsModeEnabled()
  const { board, isConnected } = useOptionsContext()

  if (optionsEnabled && isConnected && board) {
    return panelToPositions(board.panel, streamId)
  }

  if (optionsEnabled) return []

  return mockPositions
}
