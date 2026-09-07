import { useMemo } from 'react'

import { panelToHomepage } from '#/utils/options'
import type { HomepageData } from '#/types/homepage'
import { useOptionsContext } from '#/providers/options-provider'
import { usePreferFixture, useParsedFixture } from '#/hooks/use-fixture-mode'

/** Honest empty state for live mode before/without a board — never the fixture (A). */
const EMPTY_HOMEPAGE: HomepageData = {
  streams: [],
  liveVaults: [],
  lifetimeVaults: [],
  protocolStats: {
    totalVaults: 0,
    totalVolume: 0,
    activeStreams: 0,
    resolvedVaults: 0,
    yesWinRatePct: null,
  },
}

export function useHomepageData(): HomepageData {
  const preferFixture = usePreferFixture()
  const fixture = useParsedFixture()
  const { board } = useOptionsContext()

  return useMemo(() => {
    if (!preferFixture) {
      // Live mode: project the on-chain board, or show an honest empty catalog while it loads /
      // when there is no live data. We deliberately do NOT fall back to the fixture here.
      return board ? panelToHomepage(board.panel) : EMPTY_HOMEPAGE
    }
    return fixture.homepage
  }, [preferFixture, board, fixture])
}
