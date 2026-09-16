import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  openMsePlayer,
  type MediaSourceLike,
  type PlayerSocket,
  type SourceBufferLike,
} from '../src/utils/mse-player'
import { resolveStreamFeed } from '../src/utils/stream'

/**
 * MSE player against a mocked MediaSource/SourceBuffer + injected socket (no real DOM MediaSource). Asserts
 * init appends before fragments, fragments append in order, QuotaExceeded trims played ranges, and the end
 * signal ends the media stream. Plus source-mode selection (live vs recording).
 */

const FRAME_INIT = 0x01
const FRAME_FRAGMENT = 0x02

// A controllable fake SourceBuffer: records appended bytes; `updating` toggled by the harness.
const makeSourceBuffer = (): SourceBufferLike & {
  appended: Uint8Array[]
  removed: Array<[number, number]>
  fireUpdateEnd: () => void
  setBuffered: (start: number, end: number) => void
  throwQuotaOnce: () => void
} => {
  const listeners: Record<string, Array<() => void>> = {}
  let quotaOnce = false
  let bufStart = 0
  let bufEnd = 0
  const sb = {
    updating: false,
    appended: [] as Uint8Array[],
    removed: [] as Array<[number, number]>,
    appendBuffer(data: Uint8Array) {
      if (quotaOnce) {
        quotaOnce = false
        throw new DOMException('quota', 'QuotaExceededError')
      }
      sb.appended.push(data)
    },
    remove(start: number, end: number) {
      sb.removed.push([start, end])
    },
    addEventListener(type: string, listener: () => void) {
      ;(listeners[type] ??= []).push(listener)
    },
    get buffered() {
      return {
        length: bufEnd > bufStart ? 1 : 0,
        start: () => bufStart,
        end: () => bufEnd,
      }
    },
    fireUpdateEnd() {
      for (const l of listeners['updateend'] ?? []) l()
    },
    setBuffered(start: number, end: number) {
      bufStart = start
      bufEnd = end
    },
    throwQuotaOnce() {
      quotaOnce = true
    },
  }
  return sb
}

const makeMediaSource = (sb: SourceBufferLike): MediaSourceLike & { fireSourceOpen: () => void; endedCount: () => number } => {
  const listeners: Record<string, Array<() => void>> = {}
  let ended = 0
  return {
    readyState: 'open',
    addEventListener(type: string, listener: () => void) {
      ;(listeners[type] ??= []).push(listener)
    },
    addSourceBuffer() {
      return sb
    },
    endOfStream() {
      ended += 1
    },
    fireSourceOpen() {
      for (const l of listeners['sourceopen'] ?? []) l()
    },
    endedCount() {
      return ended
    },
  }
}

const makeSocket = (): PlayerSocket & { fire: (type: string, event: unknown) => void; closed: () => boolean } => {
  const listeners: Record<string, Array<(e: unknown) => void>> = {}
  let closed = false
  return {
    binaryType: 'blob',
    addEventListener(type: string, listener: (e: unknown) => void) {
      ;(listeners[type] ??= []).push(listener)
    },
    close() {
      closed = true
    },
    fire(type: string, event: unknown) {
      for (const l of listeners[type] ?? []) l(event)
    },
    closed: () => closed,
  }
}

const frame = (tag: number, body: number[]): ArrayBuffer => {
  const out = new Uint8Array(1 + body.length)
  out[0] = tag
  out.set(body, 1)
  return out.buffer
}

beforeEach(() => {
  // jsdom-free: stub the URL object-url surface the player touches.
  ;(globalThis as unknown as { URL: unknown }).URL = {
    createObjectURL: () => 'blob:mock',
    revokeObjectURL: () => undefined,
  }
})

describe('MSE live player', () => {
  it('appends init before fragments, in order', () => {
    const sb = makeSourceBuffer()
    const ms = makeMediaSource(sb)
    const socket = makeSocket()
    const video = { src: '', currentTime: 0, play: () => Promise.resolve() } as unknown as HTMLVideoElement

    openMsePlayer({
      baseUrl: 'http://h',
      streamId: 's',
      video,
      socketFactory: () => socket,
      mediaSourceFactory: () => ms,
    })

    ms.fireSourceOpen() // SourceBuffer created
    socket.fire('message', { data: frame(FRAME_INIT, [9, 9]) })
    // Simulate the async append completing so the next append can pump.
    sb.fireUpdateEnd()
    socket.fire('message', { data: frame(FRAME_FRAGMENT, [1]) })
    sb.fireUpdateEnd()
    socket.fire('message', { data: frame(FRAME_FRAGMENT, [2]) })

    expect(sb.appended.map((a) => [...a])).toEqual([[9, 9], [1], [2]])
  })

  it('trims played ranges on QuotaExceeded then retries', () => {
    const sb = makeSourceBuffer()
    const ms = makeMediaSource(sb)
    const socket = makeSocket()
    const video = { src: '', currentTime: 10, play: () => Promise.resolve() } as unknown as HTMLVideoElement

    openMsePlayer({
      baseUrl: 'http://h',
      streamId: 's',
      video,
      socketFactory: () => socket,
      mediaSourceFactory: () => ms,
    })
    ms.fireSourceOpen()
    sb.setBuffered(0, 12)
    sb.throwQuotaOnce()
    socket.fire('message', { data: frame(FRAME_FRAGMENT, [1]) })
    // Quota hit → a remove was issued (trim before playhead), fragment re-queued.
    expect(sb.removed.length).toBe(1)
    expect(sb.removed[0]![0]).toBe(0)
    // Retry after the remove settles → the fragment lands.
    sb.fireUpdateEnd()
    expect(sb.appended.map((a) => [...a])).toEqual([[1]])
  })

  it('seeks the playhead to the buffered start when it stalls behind a nonzero-PTS range', () => {
    const sb = makeSourceBuffer()
    const ms = makeMediaSource(sb)
    const socket = makeSocket()
    // currentTime 0 but fragments start at PTS ~251 → HAVE_METADATA stall until we seek.
    const video = { src: '', currentTime: 0, play: () => Promise.resolve() } as unknown as HTMLVideoElement

    openMsePlayer({
      baseUrl: 'http://h',
      streamId: 's',
      video,
      socketFactory: () => socket,
      mediaSourceFactory: () => ms,
    })

    ms.fireSourceOpen()
    socket.fire('message', { data: frame(FRAME_INIT, [9, 9]) })
    sb.fireUpdateEnd()
    socket.fire('message', { data: frame(FRAME_FRAGMENT, [1]) })
    // The first media fragment landed at [251, 315]; the updateend seek jumps the playhead to the start.
    sb.setBuffered(251, 315)
    sb.fireUpdateEnd()

    expect(video.currentTime).toBe(251)
  })

  it('does not fight a playhead already inside the buffered range', () => {
    const sb = makeSourceBuffer()
    const ms = makeMediaSource(sb)
    const socket = makeSocket()
    // currentTime already inside the buffered range — the seek guard must leave it untouched.
    const video = { src: '', currentTime: 300, play: () => Promise.resolve() } as unknown as HTMLVideoElement

    openMsePlayer({
      baseUrl: 'http://h',
      streamId: 's',
      video,
      socketFactory: () => socket,
      mediaSourceFactory: () => ms,
    })

    ms.fireSourceOpen()
    socket.fire('message', { data: frame(FRAME_INIT, [9, 9]) })
    sb.fireUpdateEnd()
    socket.fire('message', { data: frame(FRAME_FRAGMENT, [1]) })
    sb.setBuffered(251, 315)
    sb.fireUpdateEnd()

    expect(video.currentTime).toBe(300)
  })

  it('ends the media stream on the host end signal', () => {
    const sb = makeSourceBuffer()
    const ms = makeMediaSource(sb)
    const socket = makeSocket()
    const video = { src: '', currentTime: 0, play: () => Promise.resolve() } as unknown as HTMLVideoElement
    const onEnded = vi.fn()

    openMsePlayer({
      baseUrl: 'http://h',
      streamId: 's',
      video,
      socketFactory: () => socket,
      mediaSourceFactory: () => ms,
      onEnded,
    })
    ms.fireSourceOpen()
    socket.fire('message', { data: JSON.stringify({ type: 'end', reason: 'done' }) })
    expect(onEnded).toHaveBeenCalledTimes(1)
    expect(ms.endedCount()).toBe(1)
  })

  it('close() tears down the socket', () => {
    const sb = makeSourceBuffer()
    const ms = makeMediaSource(sb)
    const socket = makeSocket()
    const video = { src: '', currentTime: 0, play: () => Promise.resolve() } as unknown as HTMLVideoElement
    const handle = openMsePlayer({
      baseUrl: 'http://h',
      streamId: 's',
      video,
      socketFactory: () => socket,
      mediaSourceFactory: () => ms,
    })
    handle.close()
    expect(socket.closed()).toBe(true)
  })
})

describe('source-mode selection', () => {
  it('resolves a live pointer to the live kind and an ended pointer to vod', () => {
    const live = resolveStreamFeed({ status: 'live', scheme: 'x', id: 'y' }, { isLive: true, watchUrl: 'http://w' })
    expect(live.kind).toBe('live')
    const ended = resolveStreamFeed(
      { status: 'ended', scheme: 'walrus-testnet', id: 'blob1' },
      { isLive: false },
    )
    expect(ended.kind).toBe('vod')
    expect(ended.src).toContain('blob1')
  })
})
