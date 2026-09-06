import { useState, useEffect } from 'react'
import type { OptionsVault } from '@livestreak/options'
import { isOptionsModeEnabled } from '#/utils/env'
import { useOptionsContext } from '#/providers/options-provider'
import { panelToVaults } from '#/utils/options'
import { usePreferFixture, useParsedFixture } from '#/hooks/use-fixture-mode'

export function useVaults(streamId?: string) {
  const preferFixture = usePreferFixture()
  const parsed = useParsedFixture()
  const { board } = useOptionsContext()
  const optionsEnabled = isOptionsModeEnabled()
  const [vaults, setVaults] = useState<OptionsVault[]>(parsed.vaults)

  useEffect(() => {
    setVaults(parsed.vaults)
  }, [parsed])

  useEffect(() => {
    if (!preferFixture || optionsEnabled) return

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
  }, [preferFixture, optionsEnabled])

  if (!preferFixture && board) {
    return panelToVaults(board.panel, streamId)
  }

  if (!preferFixture) {
    return []
  }

  const list = streamId
    ? vaults.filter(v => v.marketId === streamId)
    : vaults
  return list
}
