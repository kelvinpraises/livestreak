// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
const ports = vi.hoisted(() => ({ fetch: vi.fn(), project: vi.fn((data: unknown) => data) }))
vi.mock('../src/utils/env', () => ({ env: { hostBaseUrl: 'https://host.example' } }))
vi.mock('../src/utils/host', () => ({ fetchHomepage: ports.fetch, hostHomepageToCards: ports.project }))
import { useHomepageData } from '../src/hooks/use-homepage-data'
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks() })
it('retains cached records as stale instead of claiming they remain live during an outage', async () => {
  vi.useFakeTimers()
  ports.fetch.mockResolvedValueOnce({ streams: [{ id: 'm', isLive: true }], liveVaults: [{ vaultId: 'v' }], lifetimeVaults: [] })
    .mockRejectedValue(new Error('Host offline'))
  const { result } = renderHook(() => useHomepageData())
  await act(async () => { await Promise.resolve() })
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(result.current.streams).toEqual([{ id: 'm', isLive: false, stale: true }])
  expect(result.current.liveVaults).toEqual([{ vaultId: 'v', stale: true }])
});
it('discovers every chain without wallet context and refreshes finished broadcasts', async () => {
  vi.useFakeTimers()
  const live = { streams: [{ id: 'sol-show', chain: 'solana', isLive: true }, { id: 'sui-show', chain: 'sui', isLive: true }], lifetimeVaults: [] }
  const ended = { ...live, streams: [{ id: 'sol-show', chain: 'solana', isLive: false, streamStatus: 'ended' }], lifetimeVaults: [{ streamId: 'sol-show', vaultId: 'result' }] }
  ports.fetch.mockResolvedValueOnce(live).mockResolvedValue(ended)
  const { result, unmount } = renderHook(() => useHomepageData())
  await act(async () => { await Promise.resolve() })
  expect(ports.fetch).toHaveBeenCalledWith('https://host.example')
  expect(result.current).toMatchObject(live)
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(result.current).toMatchObject(ended)
  unmount()
  const calls = ports.fetch.mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
  expect(ports.fetch).toHaveBeenCalledTimes(calls)
})
it('ignores obsolete demo storage, reports Host failure, and recovers with real data', async () => {
  vi.useFakeTimers()
  sessionStorage.setItem('livestreak_demo_edge', '1')
  sessionStorage.setItem('livestreak_edge_fixture', JSON.stringify({ homepage: { streams: [{ id: 'fake' }] } }))
  ports.fetch.mockRejectedValueOnce(new Error('Host offline')).mockResolvedValue({ streams: [], liveVaults: [], lifetimeVaults: [], protocolStats: {} })
  const { result } = renderHook(() => useHomepageData())
  await act(async () => { await Promise.resolve() })
  expect(result.current.streams).toEqual([])
  expect(result.current.ready).toBe(true)
  expect(result.current.error).toBe('Host offline')
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(result.current.error).toBeNull()
  expect(result.current.streams).toEqual([])
  sessionStorage.clear()
})
