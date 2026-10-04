// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { HomepageData } from '../src/types/homepage'
const state = vi.hoisted(() => ({ data: {} as HomepageData & { ready: boolean; error: string | null } }))
vi.mock('../src/hooks/use-homepage-data', () => ({ useHomepageData: () => state.data }))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
import { HomePage, StreamCard } from '../src/components/organisms/homepage'
import { hostHomepageToCards } from '../src/utils/host'
import type { HomepageData as HostHomepageData } from '@livestreak/host'
afterEach(cleanup)
function data(): typeof state.data {
  return {
    ready: true, error: null, streams: [], liveVaults: [],
    protocolStats: { totalVaults: 1, totalVolume: 3, activeStreams: 0, resolvedVaults: 1, yesWinRatePct: 100 },
    lifetimeVaults: [
      { vaultId: 'e', streamId: 'show', option: 'Verified EVM result', streamTitle: 'EVM show', outcome: 'yes', totalPool: 3, resolvedAtMs: 1, chain: 'evm', stale: false },
      { vaultId: 's', streamId: 'show', option: 'Unverified Sui result', streamTitle: 'Sui show', outcome: 'no', totalPool: 99, resolvedAtMs: 1, chain: 'sui', stale: true },
    ],
    indexing: { status: 'partial', generatedAtMs: 1, staleMarkets: 1, failedMarkets: 1, availableChains: ['evm', 'sui'], failedChains: [], verifiedChains: ['evm'], statsScope: 'verified-subset', chains: [{ chain: 'evm', status: 'fresh', verifiedMarkets: 1, staleMarkets: 0 }, { chain: 'sui', status: 'unavailable', verifiedMarkets: 0, staleMarkets: 1 }] },
  }
}
it('shows only verified resolutions and scoped totals during a second-chain outage', () => {
  state.data = data()
  const { container } = render(<HomePage />)
  expect(screen.getAllByRole('status').map(n => n.textContent).join(' ')).toContain('only verified records from evm')
  expect(screen.getAllByRole('status').map(n => n.textContent).join(' ')).toContain('Coverage incomplete: sui')
  expect(screen.getByText('Verified EVM result')).toBeTruthy()
  expect(screen.queryByText('Unverified Sui result')).toBeNull()
  expect(screen.getAllByText('$3.00').length).toBeGreaterThan(0)
  expect(container.textContent).not.toContain('$99.00')
  expect(container.textContent).toContain('No live streams in the verified records')
})
it('withholds totals and resolutions when nothing can be verified', () => {
  state.data = data()
  state.data.indexing = { ...state.data.indexing!, status: 'unavailable', statsScope: 'unavailable', verifiedChains: [] }
  render(<HomePage />)
  expect(screen.getAllByRole('status').map(n => n.textContent).join(' ')).toContain('Totals and results are unavailable')
  expect(screen.queryByText('Verified EVM result')).toBeNull()
  expect(screen.queryByText('$3.00')).toBeNull()
})
it('does not turn stale resolutions into resolved counts or YES outcome rates', () => {
  const rows: HostHomepageData["lifetimeVaults"] = data().lifetimeVaults.map(v => ({ id: v.vaultId, streamId: v.streamId, option: v.option, streamTitle: v.streamTitle, outcome: v.outcome, totalPool: v.totalPool, resolvedAgoMs: 0, chain: v.chain ?? 'evm', stale: v.stale, yesTotal: v.totalPool, noTotal: 0 }))
  const projected = hostHomepageToCards({ streams: [], liveVaults: [], lifetimeVaults: rows, protocolStats: { totalVaults: 1, totalVolume: 3, activeStreams: 0 } })
  expect(projected.protocolStats).toMatchObject({ resolvedVaults: 1, yesWinRatePct: 100 })
})

it('labels ended-stream vault counts as active rather than claiming there were no vaults', () => {
  render(<StreamCard stream={{ id: 'm', marketId: 'm', title: 'Ended broadcast', category: 'Uncategorized', activeVaults: 0, totalPooled: 1.71, elapsed: '', isLive: false, streamStatus: 'ended', chain: 'evm' }} index={0} />)
  expect(screen.getByText('0 active vaults')).toBeTruthy()
  expect(screen.getByText('ENDED')).toBeTruthy()
  expect(screen.getByText('$1.71')).toBeTruthy()
})
