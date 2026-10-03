import { describe, expect, it } from 'vitest'
import {
  NO_RECORDING_POINTER_ID,
  resolveStreamFeed,
  resolveStreamMedia,
} from '../src/utils/stream'

describe('no-recording end state', () => {
  it('pins the sentinel value shared with observe market keys', () => {
    expect(NO_RECORDING_POINTER_ID).toBe('')
  })

  it('an ended market with the marker offers no replay, only offline', () => {
    const media = resolveStreamMedia(
      { status: 'ended', scheme: 'walrus-testnet', id: NO_RECORDING_POINTER_ID },
      'http://host/watch/abc',
    )

    expect(media.kind).toBe('none')
    expect(media.src).toBeUndefined()
  })

  it('the marker wins over a host/fixture URL — no borrowed feed as replay', () => {
    const media = resolveStreamFeed(
      { status: 'ended', scheme: 'walrus-testnet', id: NO_RECORDING_POINTER_ID },
      { watchUrl: 'http://host/fixture.mp4', isLive: false },
    )

    expect(media).toEqual({ kind: 'none', ended: true })
  })

  it('an unverified ended pointer cannot manufacture replay', () => {
    const media = resolveStreamMedia(
      { status: 'ended', scheme: 'walrus-testnet', id: 'realBlobId123' },
      undefined,
    )

    expect(media).toEqual({ kind: 'none', ended: true })
  })

  it('a live market still prefers the host watch URL', () => {
    const media = resolveStreamMedia(
      { status: 'live', scheme: 'walrus-testnet', id: 'whatever' },
      'http://host/watch/abc',
    )

    expect(media).toEqual({ kind: 'live', src: 'http://host/watch/abc' })
  })
})

 describe('ended Host reconciliation', () => {
  it('keeps an ended Host authoritative when the options pointer is stale or missing', () => {
    for (const pointer of [undefined, { status: 'live' as const, scheme: 'ipfs', id: 'old' }]) {
      expect(resolveStreamFeed(pointer, { isLive: true, streamStatus: 'ended', watchUrl: 'http://old/live' })).toEqual({ kind: 'none', ended: true })
    }
  })
  it('does not borrow a host URL for an empty or legacy ended pointer', () => {
    for (const id of ['', 'livestreak:no-recording', 'ab'.repeat(32)]) {
      expect(resolveStreamFeed({ status: 'ended', scheme: 'ipfs', id }, { isLive: true, watchUrl: 'http://old/live' })).toEqual({ kind: 'none', ended: true })
    }
  })
 })

describe('verified Host replay', () => {
  const id = 'a'.repeat(64)
  const replay = { pointerId: id, url: 'https://media.example/content/' + id, format: 'hls' as const, durationSeconds: 120 }
  it('plays the exact verified Host pointer and rejects mismatches', () => {
    expect(resolveStreamFeed({ status: 'ended', scheme: 'host', id }, { isLive: false, streamStatus: 'ended', replay })).toMatchObject({ kind: 'vod', src: replay.url, format: 'hls' })
    expect(resolveStreamFeed({ status: 'ended', scheme: 'host', id: 'b'.repeat(64) }, { isLive: false, streamStatus: 'ended', replay }).kind).toBe('none')
    expect(resolveStreamFeed({ status: 'ended', scheme: 'ipfs', id }, { isLive: false, streamStatus: 'ended', replay }).kind).toBe('none')
  })
  it('shows processing without advertising a video', () => {
    expect(resolveStreamFeed({ status: 'ended', scheme: 'host', id: '' }, { isLive: false, recordingStatus: 'processing' })).toMatchObject({ kind: 'none', ended: true, processing: true })
  })
})
