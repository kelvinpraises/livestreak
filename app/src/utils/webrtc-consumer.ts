import { Effect } from 'effect'
import {
  createHostMediatedConsumerSignaling,
  type RtcPeerConnectionFactory,
  type SignalingFetch,
} from '@livestreak/observe'

import type { StreamFeedDetail, StreamPointer } from '#/utils/stream'

export type WebRtcConsumerStatus = 'idle' | 'connecting' | 'ready' | 'error'

export interface ConsumeHostWebRtcInput {
  readonly baseUrl: string
  readonly streamId: string
  readonly fetch?: SignalingFetch
  readonly peerConnectionFactory?: RtcPeerConnectionFactory
  readonly pollIntervalMs?: number
  readonly offerTimeoutMs?: number
  readonly mimeType?: string
  readonly signal?: AbortSignal
}

export interface ConsumeHostWebRtcResult {
  readonly blobUrl: string
  readonly totalBytes: number
}

/**
 * True when the stream is LIVE — then we take the realtime WebRTC feed. A `watchUrl` is the recording
 * (the goLive storage pointer / archived blob); it's for REPLAY once the stream has ended, so it must not
 * pre-empt the live feed while the producer is still broadcasting.
 */
export function shouldUseHostWebRtcFeed(
  pointer: StreamPointer | undefined,
  host: StreamFeedDetail | null | undefined,
): boolean {
  return pointer?.status === 'live' || host?.isLive === true
}

/** Sticky-latched WebRTC eligibility, scoped to one streamId. */
export interface WebRtcLatch {
  readonly streamId: string
  readonly enabled: boolean
}

/**
 * Latch step. `eligible` flickers with the ~3s board poll; this HOLDS `enabled` true across transient
 * drops so an in-flight MP4 transfer is never aborted. Releases only when the pointer reports `ended`;
 * a new `streamId` re-evaluates from scratch. Returns `prev` unchanged when nothing moved (no re-render).
 */
export function nextWebRtcLatch(
  prev: WebRtcLatch,
  streamId: string,
  eligible: boolean,
  ended: boolean,
): WebRtcLatch {
  const fresh = prev.streamId !== streamId
  const enabled = ended ? false : fresh ? eligible : prev.enabled || eligible
  return !fresh && enabled === prev.enabled ? prev : { streamId, enabled }
}

/**
 * Derived `enabled` the consumer sees: the latched value for THIS stream, OR live eligibility right now.
 * The live clause keeps go-live instant (no extra-render lag); the streamId guard stops a stale latch from
 * a previous market leaking into a freshly navigated stream; `ended` releases immediately (no render lag).
 */
export function resolveWebRtcEnabled(
  latch: WebRtcLatch,
  streamId: string,
  eligible: boolean,
  ended: boolean,
): boolean {
  return !ended && ((latch.streamId === streamId && latch.enabled) || eligible)
}

const toUint8Array = (data: unknown): Uint8Array => {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
  }
  return new Uint8Array(0)
}

export const assembleChunksToBlobUrl = (
  chunks: readonly Uint8Array[],
  mimeType = 'video/mp4',
): { blobUrl: string; totalBytes: number } => {
  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const assembled = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    assembled.set(chunk, offset)
    offset += chunk.byteLength
  }
  const blob = new Blob([assembled], { type: mimeType })
  return { blobUrl: URL.createObjectURL(blob), totalBytes }
}

/**
 * Host-mediated browser consumer: poll relay for sink offer, answer, collect data-channel
 * chunks, reassemble into a blob URL for `<video src>`.
 */
export async function consumeHostWebRtcFeed(
  input: ConsumeHostWebRtcInput,
): Promise<ConsumeHostWebRtcResult> {
  if (input.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const signaling = createHostMediatedConsumerSignaling({
    baseUrl: input.baseUrl,
    streamId: input.streamId,
    fetch: input.fetch,
    pollIntervalMs: input.pollIntervalMs,
    offerTimeoutMs: input.offerTimeoutMs,
  })

  const chunks: Uint8Array[] = []

  const abortPromise = input.signal
    ? new Promise<never>((_, reject) => {
        const onAbort = () => reject(new DOMException('Aborted', 'AbortError'))
        if (input.signal!.aborted) {
          onAbort()
          return
        }
        input.signal!.addEventListener('abort', onAbort, { once: true })
      })
    : null

  let peer: ReturnType<RtcPeerConnectionFactory> | undefined

  try {
    const offer = await Promise.race([
      Effect.runPromise(signaling.awaitOffer),
      ...(abortPromise ? [abortPromise] : []),
    ])

    const factory = input.peerConnectionFactory ?? resolveBrowserPeerFactory()
    peer = factory()

    let resolveTransfer!: () => void
    const transferComplete = new Promise<void>((resolve) => {
      resolveTransfer = resolve
    })
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    const finishTransfer = () => {
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      resolveTransfer()
    }
    // The producer drains its send buffer fully and then closes, so `onclose` is the authoritative
    // completion signal. The idle timer is only a fallback for a lost close — give it real margin so a
    // producer-side backpressure pause (large MP4) can't prematurely finalize a partial, undecodable blob.
    const bumpIdle = () => {
      if (chunks.length === 0) return
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      idleTimer = setTimeout(finishTransfer, 3000)
    }

    peer.ondatachannel = (event) => {
      const channel = event.channel
      // A native RTCDataChannel may default `binaryType` to "blob"; our reassembly only handles
      // ArrayBuffer/typed-array, so Blobs would be dropped to zero-length and the feed would be empty.
      ;(channel as unknown as { binaryType?: string }).binaryType = 'arraybuffer'
      channel.onmessage = (message) => {
        const bytes = toUint8Array(message.data)
        if (bytes.byteLength > 0) {
          chunks.push(bytes)
          bumpIdle()
        }
      }
      channel.onclose = finishTransfer
    }

    await peer.setRemoteDescription(offer)
    const answer = await peer.createAnswer()
    await peer.setLocalDescription(answer)
    // Non-trickle ICE: publish the answer WITH its gathered candidates (the relay carries only the SDP, so
    // the producer never learns our address otherwise and the data channel never opens).
    const localAnswer = await peer.localDescriptionWithCandidates(answer)
    await Promise.race([
      Effect.runPromise(signaling.publishAnswer(localAnswer)),
      ...(abortPromise ? [abortPromise] : []),
    ])
    await Promise.race([
      transferComplete,
      ...(abortPromise ? [abortPromise] : []),
    ])

    if (chunks.length === 0) {
      throw new Error('WebRTC consumer received no data-channel chunks')
    }

    return assembleChunksToBlobUrl(chunks, input.mimeType)
  } finally {
    peer?.close()
  }
}

const resolveBrowserPeerFactory = (): RtcPeerConnectionFactory => {
  const Ctor = (globalThis as { RTCPeerConnection?: new (config?: RTCConfiguration) => RTCPeerConnection })
    .RTCPeerConnection
  if (Ctor === undefined) {
    throw new Error('consumeHostWebRtcFeed requires RTCPeerConnection or peerConnectionFactory')
  }
  // The native peer is structurally an RtcPeerConnectionLike; wrap it to add the non-trickle gather step —
  // wait for ICE gathering, then return the candidate-rich local description so the answer carries them.
  // STUN (symmetric with the producer) yields a server-reflexive candidate; without it the browser offers
  // only an mDNS-obfuscated host candidate (`<uuid>.local`) the non-browser producer cannot resolve. Across
  // real networks/NAT a TURN relay is still required for the strict-NAT minority.
  // ICE servers are build-time overridable (VITE_LIVESTREAK_ICE_SERVERS = JSON
  // array) so the viewer can use a TURN relay for a Dockerized/remote producer.
  const iceServers: RTCIceServer[] = (() => {
    const raw = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      ?.VITE_LIVESTREAK_ICE_SERVERS
    if (raw !== undefined && raw.trim() !== '') {
      try {
        return JSON.parse(raw) as RTCIceServer[]
      } catch {
        /* malformed → STUN default */
      }
    }
    return [{ urls: 'stun:stun.l.google.com:19302' }]
  })()
  return () => {
    const relayOnly = (import.meta as unknown as { env?: Record<string, string | undefined> }).env
      ?.VITE_LIVESTREAK_ICE_RELAY_ONLY === '1'
    const peer = new Ctor(relayOnly ? { iceServers, iceTransportPolicy: 'relay' } : { iceServers })
    const like = peer as unknown as ReturnType<RtcPeerConnectionFactory>
    like.localDescriptionWithCandidates = async (fallback) => {
      const deadline = Date.now() + 3000
      while (peer.iceGatheringState !== 'complete' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      return (peer.localDescription as unknown as typeof fallback) ?? fallback
    }
    return like
  }
}
