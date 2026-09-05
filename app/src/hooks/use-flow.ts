import { useState } from 'react'
import { mockFlow, type FlowState } from '#/utils/mock'
import { isOptionsModeEnabled } from '#/utils/env'
import { useOptionsContext } from '#/providers/options-provider'
import { panelToFlow } from '#/utils/options'

export function useFlow() {
  const optionsEnabled = isOptionsModeEnabled()
  const { board, isConnected, chain } = useOptionsContext()
  const [flow, setFlow] = useState<FlowState>(mockFlow)
  const [claiming, setClaiming] = useState(false)

  const liveFlow = optionsEnabled && isConnected && board
    ? panelToFlow(board.panel, chain)
    : optionsEnabled
      ? { balance: 0, staked: 0, pendingDividends: 0, totalEarned: 0, apy: 0 }
      : flow

  function stake(amount: number) {
    if (optionsEnabled) return
    if (amount <= 0 || amount > flow.balance - flow.staked) return
    setFlow(prev => ({ ...prev, staked: prev.staked + amount }))
  }

  function unstake(amount: number) {
    if (optionsEnabled) return
    if (amount <= 0 || amount > flow.staked) return
    setFlow(prev => ({ ...prev, staked: prev.staked - amount }))
  }

  function claimDividends() {
    if (optionsEnabled) return
    if (flow.pendingDividends <= 0) return
    setClaiming(true)
    setTimeout(() => {
      setFlow(prev => ({
        ...prev,
        totalEarned: prev.totalEarned + prev.pendingDividends,
        pendingDividends: 0,
      }))
      setClaiming(false)
    }, 1200)
  }

  return { flow: liveFlow, stake, unstake, claimDividends, claiming }
}
