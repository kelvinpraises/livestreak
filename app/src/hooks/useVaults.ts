import { useState, useEffect } from 'react'
import { mockVaults, type Vault } from '#/data/mock'
import { isDeployed, publicClient, contracts, VAULT_ABI } from '#/config/contracts'

export function useVaults() {
  const [vaults, setVaults] = useState<Vault[]>(mockVaults)

  useEffect(() => {
    if (!isDeployed()) {
      // Mock mode — simulate live drift
      const interval = setInterval(() => {
        setVaults(prev => prev.map(v => {
          if (v.status !== 'open' && v.status !== 'hot') return v
          const drift = (Math.random() - 0.48) * 0.04
          return { ...v, noTotal: Math.max(10, v.noTotal + Math.random() * 4), yesTotal: Math.max(10, v.yesTotal + Math.random() * 2.5), multiplier: Math.max(1.05, +(v.multiplier + drift).toFixed(3)) }
        }))
      }, 2200)
      return () => clearInterval(interval)
    }

    // Live mode — poll contract every 3s
    async function fetchVaults() {
      try {
        const total = await publicClient.readContract({
          address: contracts.vault,
          abi: VAULT_ABI,
          functionName: 'totalVaults',
        }) as bigint

        // For hackathon, read last 20 vaults max
        const count = Math.min(Number(total), 20)
        // Would need vaultIds[] accessor — for now fall back to mock
        if (count === 0) return
      } catch {
        // Contract not responding — stay on mock
      }
    }

    fetchVaults()
    const interval = setInterval(fetchVaults, 3000)
    return () => clearInterval(interval)
  }, [])

  return vaults
}
