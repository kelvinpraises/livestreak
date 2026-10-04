import { useOptionsContext } from '#/providers/options-provider'
import { panelToVaults } from '#/utils/options'

export function useVaults(streamId?: string) {
  const { board } = useOptionsContext()
  return board ? panelToVaults(board.panel, streamId) : []
}
