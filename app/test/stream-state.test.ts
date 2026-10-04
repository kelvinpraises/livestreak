import { expect, it } from 'vitest'
import { streamState } from '../src/utils/stream-state'
import { shouldUseLiveFeed } from '../src/utils/live-feed'
import { resolveStreamFeed } from '../src/utils/stream'

it('uses lifecycle and freshness rather than the category to identify a live stream', () => {
  expect(streamState({ isLive: false, streamStatus: 'ended' })).toBe('ended')
  expect(streamState({ isLive: true, streamStatus: 'ended' })).toBe('ended')
  expect(streamState({ isLive: true, stale: true })).toBe('stale')
  expect(streamState({ isLive: false })).toBe('offline')
  expect(streamState({ isLive: true })).toBe('live')
});

it('cannot use a chain live pointer as proof that the Host is receiving video', () => {
  const pointer = { status: 'live' as const, scheme: 'host', id: 'm' }
  expect(shouldUseLiveFeed(pointer, undefined)).toBe(false)
  expect(shouldUseLiveFeed(pointer, { isLive: false })).toBe(false)
  expect(shouldUseLiveFeed(pointer, { isLive: true, stale: true })).toBe(false)
  expect(shouldUseLiveFeed(pointer, { isLive: true })).toBe(true)
  expect(resolveStreamFeed(pointer, { isLive: false, watchUrl: 'https://host/old' })).toEqual({ kind: 'none' })
});
