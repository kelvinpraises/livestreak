import { useEffect, useState } from 'react'
import type { OptionsAccrualPreview } from '@livestreak/options'

import { isOptionsModeEnabled } from '#/utils/env'
import { useOptionsContext } from '#/providers/options-provider'

export function useAccrualPreview(
  vaultId: string,
  side: 'yes' | 'no' | null,
  rateUsdPerMin: number,
) {
  const optionsEnabled = isOptionsModeEnabled()
  const { isConnected, previewAccrual } = useOptionsContext()
  const enabled = optionsEnabled && isConnected
  const [preview, setPreview] = useState<OptionsAccrualPreview | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled || !side || rateUsdPerMin <= 0.01) {
      setPreview(null)
      setLoading(false)
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      setLoading(true)
      void previewAccrual(vaultId, side, rateUsdPerMin)
        .then(result => { if (!cancelled) setPreview(result) })
        .catch(() => { if (!cancelled) setPreview(null) })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [enabled, vaultId, side, rateUsdPerMin, previewAccrual])

  return { preview, loading, enabled }
}
