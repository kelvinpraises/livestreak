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
  shouldUseHostWebRtcFeed,
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
  it('returns false when a fixture watchUrl is present', () => {
    expect(
      shouldUseHostWebRtcFeed(undefined, {
        isLive: true,
        watchUrl: 'https://example.com/demo.mp4',
      }),
    ).toBe(false)
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
