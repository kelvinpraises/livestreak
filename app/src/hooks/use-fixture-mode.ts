
import { useMemo } from 'react'

import { useHostContext } from '#/providers/host-provider'
import { isOptionsModeEnabled } from '#/utils/env'
import { parseFixture, type ParsedFixture } from '#/utils/parse-fixture'

/**
 * The SINGLE demo/live switch for the whole app (A: one switch, every page).
 *
 * `demoEdge` is the master toggle surfaced by `<DemoEdgeToggle>`:
 *   - demoEdge ON  ⇒ every page reads the bundled/injected fixture (rich demo catalog).
 *   - demoEdge OFF ⇒ every page reads LIVE data; when there is genuinely no live data the
 *                    live-backed hooks render an honest empty/loading state — they MUST NEVER
 *                    silently fall back to the fixture (that masquerade was the original bug).
 *
 * When options mode is compiled off there is no live board at all, so the fixture is the only
 * possible source and we always prefer it.
 */
export function usePreferFixture(): boolean {
  const { demoEdge } = useHostContext()
  if (!isOptionsModeEnabled()) return true
  return demoEdge
}

export function useParsedFixture(): ParsedFixture {
  const { fixture } = useHostContext()
  return useMemo(() => parseFixture(fixture), [fixture])
}
