import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import {
  createHostMediatedConsumerSignaling,
  createLoopbackNetwork,
  type RtcPeerConnectionFactory,
  type RtcSessionDescription,
  type SignalingFetch,
} from '@livestreak/observe'

import {
  consumeHostWebRtcFeed,
  fetchHostIce,
  nextWebRtcLatch,
  resolveViewerIce,
  resolveWebRtcEnabled,
  shouldUseHostWebRtcFeed,
  type HostIceConfig,
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

describe('host ICE discovery (turnkey /webrtc/ice)', () => {
  // The host's wire contract (getIce via sendRouteResult) is the BARE payload — no envelope.
  const hostIce: HostIceConfig = {
    iceServers: [
      { urls: 'stun:192.168.1.7:3478' },
      { urls: 'turn:192.168.1.7:3478?transport=udp', username: 'livestreak', credential: 'streampass' },
    ],
    relayOnly: true,
  }

  it('fetches GET {base}/webrtc/ice and parses {iceServers, relayOnly}', async () => {
    const urls: string[] = []
    const fetchImpl = (async (url: unknown) => {
      urls.push(String(url))
      return { ok: true, json: async () => hostIce }
    }) as unknown as typeof globalThis.fetch

    const config = await fetchHostIce('http://127.0.0.1:8787/', fetchImpl)

    expect(urls).toEqual(['http://127.0.0.1:8787/webrtc/ice'])
    expect(config).toEqual(hostIce)
  })

  it('degrades to undefined on non-OK, malformed JSON, or network failure', async () => {
    const notOk = (async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof globalThis.fetch
    const badJson = (async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('bad json')
      },
    })) as unknown as typeof globalThis.fetch
    const netFail = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof globalThis.fetch

    expect(await fetchHostIce('http://h', notOk)).toBeUndefined()
    expect(await fetchHostIce('http://h', badJson)).toBeUndefined()
    expect(await fetchHostIce('http://h', netFail)).toBeUndefined()
  })

  it('resolves host-described ICE (servers + advised relayOnly) when no env is set', () => {
    expect(resolveViewerIce(hostIce, {})).toEqual({
      iceServers: hostIce.iceServers,
      relayOnly: true,
    })
  })

  it('falls back to the STUN default when the host fetch degraded', () => {
    expect(resolveViewerIce(undefined, {})).toEqual({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      relayOnly: false,
    })
  })

  it('build-time env (VITE_LIVESTREAK_ICE_SERVERS) wins over the host ICE; malformed env falls through', () => {
    const envServers = [{ urls: 'turn:relay.example:3478', username: 'u', credential: 'c' }]
    expect(
      resolveViewerIce(hostIce, { iceServersJson: JSON.stringify(envServers) }).iceServers,
    ).toEqual(envServers)
    expect(resolveViewerIce(hostIce, { iceServersJson: '{nope' }).iceServers).toEqual(hostIce.iceServers)
  })

  it('env VITE_LIVESTREAK_ICE_RELAY_ONLY=1 forces relay even when the host does not advise it', () => {
    expect(resolveViewerIce({ iceServers: [], relayOnly: false }, { relayOnly: '1' }).relayOnly).toBe(true)
    expect(resolveViewerIce(undefined, { relayOnly: '0' }).relayOnly).toBe(false)
  })
})

describe('consumeHostWebRtcFeed (mock relay)', () => {
  // A media peer whose setRemoteDescription synchronously fires `ontrack` with a fake stream — models the
  // real transport where the inbound video track arrives as the remote description is applied.
  const mockMediaPeerFactory = (fakeStream: unknown): { factory: RtcPeerConnectionFactory; isClosed: () => boolean } => {
    let closed = false
    const factory: RtcPeerConnectionFactory = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const peer: any = {
        ontrack: null,
        createOffer: async () => ({ type: 'offer', sdp: '' }),
        createAnswer: async () => ({ type: 'answer', sdp: 'mock-answer' }),
        setLocalDescription: async () => {},
        setRemoteDescription: async () => {
          peer.ontrack?.({ streams: [fakeStream], track: fakeStream })
        },
        localDescriptionWithCandidates: async (fb: RtcSessionDescription) => fb,
        close: () => {
          closed = true
        },
      }
      return peer
    }
    return { factory, isClosed: () => closed }
  }

  it('resolves the inbound MediaStream from ontrack and returns a close handle', async () => {
    const streamId = '0xmedia-track-stream'
    const baseUrl = 'http://relay.test'
    const relay = makeRelay()
    // Pre-post the producer's offer so the consumer's awaitOffer resolves immediately.
    await relay.fetchImpl(`${baseUrl}/webrtc/signal/${encodeURIComponent(streamId)}/offer`, {
      method: 'POST',
      body: JSON.stringify({ type: 'offer', sdp: 'sink-offer' }),
    })

    const fakeStream = { id: 'fake-media-stream' }
    const mock = mockMediaPeerFactory(fakeStream)

    const result = await consumeHostWebRtcFeed({
      baseUrl,
      streamId,
      fetch: relay.fetchImpl,
      peerConnectionFactory: mock.factory,
      pollIntervalMs: 5,
      offerTimeoutMs: 5_000,
    })

    // The consumer surfaces the exact inbound stream (no blob), and the answer is posted to the relay.
    expect(result.stream as unknown).toBe(fakeStream)
    const answerResp = await relay.fetchImpl(
      `${baseUrl}/webrtc/signal/${encodeURIComponent(streamId)}/answer`,
      { method: 'GET' },
    )
    expect(answerResp.ok).toBe(true)
    expect(JSON.parse(await answerResp.text()).sdp).toBe('mock-answer')

    // close() tears down the peer (a live stream keeps it open until the viewer is done).
    expect(mock.isClosed()).toBe(false)
    result.close()
    expect(mock.isClosed()).toBe(true)
  })

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
      viewerId: 'viewer-x',
      fetch: relay.fetchImpl,
      pollIntervalMs: 5,
    })

    const peer = network.factory()

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
