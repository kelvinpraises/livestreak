import { useCallback, useEffect, useState } from 'react'
import type { VerifiedVaultMandate } from '@livestreak/schema'
import { useOptionsContext } from '#/providers/options-provider'
export function useFundingRules(vaultId: string, enabled: boolean) {
  const { readFundingRules, bridge } = useOptionsContext()
  const [state, setState] = useState<{ verified?: VerifiedVaultMandate; closed: boolean; loading: boolean; error?: string }>({ closed: false, loading: true })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let cancelled = false
    let reading = false
    if (!enabled) return
    setState({ closed: false, loading: true })
    const read = async () => {
      if (reading) return
      reading = true
      try {
        const result = await readFundingRules(vaultId)
        if (!cancelled) setState({ verified: result.verified, closed: result.chainNow >= result.verified.mandate.fundingClose, loading: false })
      } catch (err) {
        if (!cancelled) setState({ closed: false, loading: false, error: err instanceof Error ? err.message : 'Rules could not be verified.' })
      } finally { reading = false }
    }
    void read()
    const timer = setInterval(() => void read(), 15_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [vaultId, enabled, bridge, readFundingRules, retry])
  return { ...state, reload: useCallback(() => setRetry(n => n + 1), []) }
}
