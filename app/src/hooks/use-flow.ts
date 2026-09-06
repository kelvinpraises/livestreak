import { useState, useEffect } from 'react'
import type { FlowState } from '#/types/demo'
import { useOptionsContext } from '#/providers/options-provider'
import { panelToFlow } from '#/utils/options'
import { usePreferFixture, useParsedFixture } from '#/hooks/use-fixture-mode'

export function useFlow() {
  const preferFixture = usePreferFixture()
  const parsed = useParsedFixture()
  const { board, chain } = useOptionsContext()
  const [flow, setFlow] = useState<FlowState>(parsed.flow)
  const [claiming, setClaiming] = useState(false)

  useEffect(() => {
    setFlow(parsed.flow)
  }, [parsed])

  const liveFlow = !preferFixture && board
    ? panelToFlow(board.panel, chain)
    : preferFixture
      ? flow
      : { balance: 0, staked: 0, pendingDividends: 0, totalEarned: 0, apy: 0 }

  function stake(amount: number) {
    if (!preferFixture) return
    if (amount <= 0 || amount > flow.balance - flow.staked) return
    setFlow(prev => ({ ...prev, staked: prev.staked + amount }))
  }

  function unstake(amount: number) {
    if (!preferFixture) return
    if (amount <= 0 || amount > flow.staked) return
    setFlow(prev => ({ ...prev, staked: prev.staked - amount }))
  }

  function claimDividends() {
    if (!preferFixture) return
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
