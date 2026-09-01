import { useState, useEffect } from 'react'
import { mockFlow, type FlowState } from '#/data/mock'
import { isDeployed, publicClient, contracts, FLOW_TOKEN_ABI } from '#/config/contracts'
import { useWalletContext } from '#/contexts/WalletContext'

export function useFlow() {
  const [flow, setFlow] = useState<FlowState>(mockFlow)
  const [claiming, setClaiming] = useState(false)
  const { address, isConnected } = useWalletContext()

  useEffect(() => {
    if (!isDeployed() || !isConnected || !address) return

    async function fetchBalance() {
      try {
        const balance = await publicClient.readContract({
          address: contracts.flowToken,
          abi: FLOW_TOKEN_ABI,
          functionName: 'balanceOf',
          args: [address!],
        }) as bigint

        setFlow(prev => ({
          ...prev,
          balance: Number(balance) / 1e18,
        }))
      } catch {
        // Contract not responding — stay on mock
      }
    }

    fetchBalance()
    const interval = setInterval(fetchBalance, 10000)
    return () => clearInterval(interval)
  }, [address, isConnected])

  function stake(amount: number) {
    if (amount <= 0 || amount > flow.balance - flow.staked) return
    setFlow(prev => ({ ...prev, staked: prev.staked + amount }))
  }
  function unstake(amount: number) {
    if (amount <= 0 || amount > flow.staked) return
    setFlow(prev => ({ ...prev, staked: prev.staked - amount }))
  }
  function claimDividends() {
    if (flow.pendingDividends <= 0) return
    setClaiming(true)
    setTimeout(() => { setFlow(prev => ({ ...prev, totalEarned: prev.totalEarned + prev.pendingDividends, pendingDividends: 0 })); setClaiming(false) }, 1200)
  }

  return { flow, stake, unstake, claimDividends, claiming }
}
