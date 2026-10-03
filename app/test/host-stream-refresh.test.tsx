// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
const ports = vi.hoisted(() => ({ resolve: vi.fn(), context: { demoEdge: false, fixture: { catalog: { streams: [] } } } }))
vi.mock('../src/providers/host-provider', () => ({ useHostContext: () => ports.context }))
vi.mock('../src/utils/host', () => ({ resolveStream: ports.resolve }))
import { useHostStream } from '../src/hooks/use-host-stream'
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks() })
it('public viewers refresh lifecycle without a wallet and release the refresh on unmount', async () => {
  vi.useFakeTimers()
  ports.resolve.mockResolvedValueOnce({ isLive: true, streamStatus: 'live' })
    .mockResolvedValue({ isLive: false, streamStatus: 'ended' })
  const { result, unmount } = renderHook(() => useHostStream('owned-market'))
  await act(async () => { await Promise.resolve() })
  expect(result.current.stream?.streamStatus).toBe('live')
  await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
  expect(result.current.ready).toBe(true)
  expect(result.current.stream?.streamStatus).toBe('ended')
  unmount()
  const count = ports.resolve.mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
  expect(ports.resolve).toHaveBeenCalledTimes(count)
})
