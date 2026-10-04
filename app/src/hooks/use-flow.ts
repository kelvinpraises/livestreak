import { useOptionsContext } from '#/providers/options-provider'
import { panelToFlow } from '#/utils/options'
export function useFlow() {
  const options = useOptionsContext()
  const flow = options.board ? panelToFlow(options.board.panel) : { balance: 0, staked: 0, pendingDividends: 0, totalEarned: 0, apy: 0 }
  return { flow, stake: options.stake, unstake: options.unstake, claimDividends: options.claimDividends, claiming: options.claiming }
}
