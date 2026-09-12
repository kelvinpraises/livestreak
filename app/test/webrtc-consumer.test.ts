import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import {
  createHostMediatedConsumerSignaling,
  createHostMediatedSinkSignaling,
  createLoopbackNetwork,
  streamFileToWebRtc,
  type RtcSessionDescription,
  type SignalingFetch,
} from '@livestreak/observe'

import {
  assembleChunksToBlobUrl,
  consumeHostWebRtcFeed,
  nextWebRtcLatch,
  resolveWebRtcEnabled,
  shouldUseHostWebRtcFeed,
  type WebRtcLatch,
} from '../src/utils/webrtc-consumer'
import { resolveStreamFeed } from '../src/utils/stream'

interface RelaySlot {
  offer?: RtcSessionDescription
  answer?: RtcSessionDescription
}

const makeRelay = () => {
  const slots = new Map<string, RelaySlot>()
  const slotFor = (url: string): RelaySlot => {
    const parts = url.split('/webrtc/signal/')[1]!.split('/')
    const id = decodeURIComponent(parts[0]!)
    let slot = slots.get(id)
    if (slot === undefined) {
      slot = {}
      slots.set(id, slot)
    }
    return slot
  }
  const fetchImpl: SignalingFetch = async (url, init) => {
    const slot = slotFor(url)
    const isOffer = url.endsWith('/offer')
    const isAnswer = url.endsWith('/answer')
    if (init.method === 'POST') {
      const body = JSON.parse(init.body ?? '{}') as RtcSessionDescription
      if (isOffer) {
        slot.offer = body
      } else if (isAnswer) {
        slot.answer = body
      }
      return { status: 201, ok: true, text: async () => '' }
    }
    const value = isOffer ? slot.offer : isAnswer ? slot.answer : undefined
    if (value === undefined) {
      return { status: 404, ok: false, text: async () => '' }
    }
    return { status: 200, ok: true, text: async () => JSON.stringify(value) }
  }
  return { fetchImpl }
}

describe('shouldUseHostWebRtcFeed', () => {
  it('takes the live WebRTC feed even when a recording watchUrl is present (live precedence)', () => {
    // The watchUrl is the archived recording; a LIVE stream must still use the realtime WebRTC feed
    // rather than being pre-empted by the recording while the producer is still broadcasting.
    expect(
      shouldUseHostWebRtcFeed(undefined, {
        isLive: true,
        watchUrl: 'https://example.com/demo.mp4',
      }),
    ).toBe(true)
    // resolveStreamFeed still exposes the recording URL as the replay/archive media src.
    expect(
      resolveStreamFeed(undefined, {
        isLive: true,
        watchUrl: 'https://example.com/demo.mp4',
      }).src,
    ).toBe('https://example.com/demo.mp4')
  })

  it('returns true for live streams without a watch URL or static src', () => {
    expect(
      shouldUseHostWebRtcFeed({ status: 'live', scheme: 'walrus-testnet', id: 'abc' }, {
        isLive: true,
      }),
    ).toBe(true)
    expect(shouldUseHostWebRtcFeed(undefined, { isLive: true })).toBe(true)
  })

  it('returns false for offline streams', () => {
    expect(shouldUseHostWebRtcFeed(undefined, { isLive: false })).toBe(false)
    expect(
      shouldUseHostWebRtcFeed({ status: 'none', scheme: 'ipfs', id: 'x' }, { isLive: false }),
    ).toBe(false)
  })
})

describe('webrtc enabled latch', () => {
  // Mirror StreamLayout: each board poll applies nextWebRtcLatch then reads the derived enabled.
  const apply = (latch: WebRtcLatch, streamId: string, eligible: boolean, ended: boolean) => {
    const next = nextWebRtcLatch(latch, streamId, eligible, ended)
    return { latch: next, enabled: resolveWebRtcEnabled(next, streamId, eligible, ended) }
  }

  it('enables instantly the moment a stream goes live', () => {
    const start: WebRtcLatch = { streamId: 's1', enabled: false }
    // First eligible read is enabled on the SAME render — no extra-render lag waiting for the latch.
    expect(resolveWebRtcEnabled(start, 's1', true, false)).toBe(true)
    expect(apply(start, 's1', true, false).enabled).toBe(true)
  })

  it('stays enabled through a transient eligibility flicker mid-transfer (the bug)', () => {
    // Repro: go live, then the ~3s poll flickers eligibility false→true repeatedly. enabled must NOT
    // drop — that is what aborted the in-flight transfer and truncated the MP4 blob.
    let latch: WebRtcLatch = { streamId: 's1', enabled: false }
    const feed = [true, false, true, false, false, true] // poll readings while the transfer runs
    const seen: boolean[] = []
    for (const eligible of feed) {
      const step = apply(latch, 's1', eligible, false)
      latch = step.latch
      seen.push(step.enabled)
    }
    expect(seen).toEqual([true, true, true, true, true, true])
  })

  it("releases only when the pointer reports 'ended'", () => {
    let latch = nextWebRtcLatch({ streamId: 's1', enabled: false }, 's1', true, false)
    expect(resolveWebRtcEnabled(latch, 's1', false, false)).toBe(true) // flicker: held
    const ended = apply(latch, 's1', false, true)
    expect(ended.enabled).toBe(false) // ended: released
    latch = ended.latch
    expect(latch.enabled).toBe(false)
    // ended overrides even a still-live + latched read (immediate release, no render lag).
    expect(resolveWebRtcEnabled({ streamId: 's1', enabled: true }, 's1', true, true)).toBe(false)
  })

  it('does not leak a previous market’s latched value into a new streamId', () => {
    const live = nextWebRtcLatch({ streamId: 's1', enabled: false }, 's1', true, false)
    expect(live).toEqual({ streamId: 's1', enabled: true })
    // Navigate to s2 while s1 is still latched true but s2 is not eligible: enabled must read false.
    expect(resolveWebRtcEnabled(live, 's2', false, false)).toBe(false)
    const reset = nextWebRtcLatch(live, 's2', false, false)
    expect(reset).toEqual({ streamId: 's2', enabled: false })
  })

  it('returns the same latch reference when nothing changed (avoids re-render)', () => {
    const latch: WebRtcLatch = { streamId: 's1', enabled: true }
    expect(nextWebRtcLatch(latch, 's1', true, false)).toBe(latch)
    expect(nextWebRtcLatch(latch, 's1', false, false)).toBe(latch) // flicker, still enabled → no churn
  })
})

describe('assembleChunksToBlobUrl', () => {
  it('concatenates chunks into one blob URL', () => {
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])]
    const { blobUrl, totalBytes } = assembleChunksToBlobUrl(chunks, 'application/octet-stream')
    expect(totalBytes).toBe(5)
    expect(blobUrl.startsWith('blob:')).toBe(true)
    URL.revokeObjectURL(blobUrl)
  })
})

describe('consumeHostWebRtcFeed (mock relay)', () => {
  it(
    'answers a sink offer and reassembles file bytes byte-identical',
    async () => {
    const source = new Uint8Array(32_768)
    for (let i = 0; i < source.length; i += 1) {
      source[i] = (i * 3 + 5) & 0xff
    }

    const streamId = '0xconsumer-stream'
    const baseUrl = 'http://relay.test'
    const relay = makeRelay()
    const network = createLoopbackNetwork()

    const consumer = consumeHostWebRtcFeed({
      baseUrl,
      streamId,
      fetch: relay.fetchImpl,
      peerConnectionFactory: network.factory,
      pollIntervalMs: 5,
      offerTimeoutMs: 5_000,
      mimeType: 'application/octet-stream',
    })

    const sinkSignaling = createHostMediatedSinkSignaling({
      baseUrl,
      streamId,
      fetch: relay.fetchImpl,
      pollIntervalMs: 5,
    })

    const dir = await import('node:os').then((os) => import('node:fs/promises').then((fs) =>
      fs.mkdtemp(`${os.tmpdir()}/livestreak-app-webrtc-`).then(async (path) => {
        const filePath = `${path}/clip.bin`
        await fs.writeFile(filePath, source)
        return { dir: path, filePath, fs }
      }),
    ))

    try {
      await streamFileToWebRtc({
        filePath: dir.filePath,
        streamId,
        signaling: sinkSignaling,
        peerConnectionFactory: network.factory,
      })

      const { blobUrl, totalBytes } = await consumer
      expect(totalBytes).toBe(source.length)

      const response = await fetch(blobUrl)
      const body = new Uint8Array(await response.arrayBuffer())
      expect(Array.from(body)).toEqual(Array.from(source))
      URL.revokeObjectURL(blobUrl)
    } finally {
      await dir.fs.rm(dir.dir, { recursive: true, force: true })
    }
  },
    15_000,
  )

  it('posts an answer to the relay after receiving the offer', async () => {
    const streamId = 'relay-answer-check'
    const baseUrl = 'http://relay.test'
    const relay = makeRelay()
    const network = createLoopbackNetwork()

    const offer = { type: 'offer' as const, sdp: 'loopback-offer' }
    await relay.fetchImpl(`${baseUrl}/webrtc/signal/${encodeURIComponent(streamId)}/offer`, {
      method: 'POST',
      body: JSON.stringify(offer),
    })

    const consumerSignaling = createHostMediatedConsumerSignaling({
      baseUrl,
      streamId,
      fetch: relay.fetchImpl,
      pollIntervalMs: 5,
    })

    const peer = network.factory()
    peer.ondatachannel = () => {}

    const remoteOffer = await Effect.runPromise(consumerSignaling.awaitOffer)
    await peer.setRemoteDescription(remoteOffer)
    const answer = await peer.createAnswer()
    await peer.setLocalDescription(answer)
    await Effect.runPromise(consumerSignaling.publishAnswer(answer))
    peer.close()

    const answerResp = await relay.fetchImpl(
      `${baseUrl}/webrtc/signal/${encodeURIComponent(streamId)}/answer`,
      { method: 'GET' },
    )
    expect(answerResp.ok).toBe(true)
    const posted = JSON.parse(await answerResp.text()) as RtcSessionDescription
    expect(posted.type).toBe('answer')
    expect(posted.sdp).toBe('loopback-answer')
  })
})
