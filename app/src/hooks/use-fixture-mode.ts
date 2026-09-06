import { useMemo } from 'react'

import { useHostContext } from '#/providers/host-provider'
import { useOptionsContext } from '#/providers/options-provider'
import { isOptionsModeEnabled } from '#/utils/env'
import { parseFixture, type ParsedFixture } from '#/utils/parse-fixture'

/** When true, UI reads from the injectable host fixture instead of live host/options. */
export function usePreferFixture(): boolean {
  const { demoEdge } = useHostContext()
  const optionsEnabled = isOptionsModeEnabled()
  const { isConnected, board } = useOptionsContext()
  const useLiveBoard = optionsEnabled && isConnected && board && !demoEdge
  return !useLiveBoard
}

export function useParsedFixture(): ParsedFixture {
  const { fixture } = useHostContext()
  return useMemo(() => parseFixture(fixture), [fixture])
}
