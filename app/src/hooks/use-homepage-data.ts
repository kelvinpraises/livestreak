import { useMemo } from 'react'

import { panelToHomepage } from '#/utils/options'
import { useOptionsContext } from '#/providers/options-provider'
import { usePreferFixture, useParsedFixture } from '#/hooks/use-fixture-mode'

export function useHomepageData() {
  const preferFixture = usePreferFixture()
  const fixture = useParsedFixture()
  const { board } = useOptionsContext()

  return useMemo(() => {
    if (!preferFixture && board) {
      return panelToHomepage(board.panel)
    }
    return fixture.homepage
  }, [preferFixture, board, fixture])
}
