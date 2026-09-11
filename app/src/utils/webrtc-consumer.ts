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
 * True when the stream is live, has no ordinary host watch URL, and no other static src resolved.
 * Fixture/demo streams that carry `watchUrl` stay on the existing path.
 */
export function shouldUseHostWebRtcFeed(
  pointer: StreamPointer | undefined,
  host: StreamFeedDetail | null | undefined,
): boolean {
  if (host?.watchUrl) return false
  const isLive = pointer?.status === 'live' || host?.isLive === true
  return isLive
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
    const bumpIdle = () => {
      if (chunks.length === 0) return
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      idleTimer = setTimeout(finishTransfer, 250)
    }

    peer.ondatachannel = (event) => {
      const channel = event.channel
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
    await Promise.race([
      Effect.runPromise(signaling.publishAnswer(answer)),
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

type BrowserPeerCtor = new () => ReturnType<RtcPeerConnectionFactory>

const resolveBrowserPeerFactory = (): RtcPeerConnectionFactory => {
  const ctor = (globalThis as { RTCPeerConnection?: BrowserPeerCtor }).RTCPeerConnection
  if (ctor === undefined) {
    throw new Error('consumeHostWebRtcFeed requires RTCPeerConnection or peerConnectionFactory')
  }
  return () => new ctor()
}
