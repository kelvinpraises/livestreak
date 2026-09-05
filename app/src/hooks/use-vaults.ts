import { useState, useEffect } from 'react'
import { mockVaults } from '#/utils/mock'
import type { OptionsVault } from '@livestreak/options'
import { isOptionsModeEnabled } from '#/utils/env'
import { useOptionsContext } from '#/providers/options-provider'
import { panelToVaults } from '#/utils/options'

export function useVaults(streamId?: string) {
  const optionsEnabled = isOptionsModeEnabled()
  const { board, isConnected } = useOptionsContext()
  const [vaults, setVaults] = useState<OptionsVault[]>(mockVaults)

  useEffect(() => {
    if (optionsEnabled) return

    const interval = setInterval(() => {
      setVaults(prev => prev.map(v => {
        if (v.status !== 'open' && v.status !== 'hot') return v
        return {
          ...v,
          pools: {
            no: BigInt(Math.round(Math.max(10, Number(v.pools.no) + Math.random() * 4))),
            yes: BigInt(Math.round(Math.max(10, Number(v.pools.yes) + Math.random() * 2.5))),
          },
        }
      }))
    }, 2200)
    return () => clearInterval(interval)
  }, [optionsEnabled])

  if (optionsEnabled && isConnected && board) {
    return panelToVaults(board.panel, streamId)
  }

  if (optionsEnabled) {
    return []
  }

  return vaults
}
