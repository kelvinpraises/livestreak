import { useOptionsContext } from '#/providers/options-provider'
import { panelToPositions } from '#/utils/options'

export function usePositions(streamId?: string) {
  const { board } = useOptionsContext()
  return board ? panelToPositions(board.panel, streamId) : []
}
