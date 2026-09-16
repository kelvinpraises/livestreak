/**
 * MSE fMP4 player — the live viewer side of the encode-once byte fan-out (replaces the WebRTC consumer).
 *
 * Opens the host's viewer socket (`ws /live/watch/:streamId`), receives the init segment + GOP-aligned
 * fragments the host fans out, and appends them to a `MediaSource` SourceBuffer so a plain `<video>` plays
 * the stream at ~1s latency. Backpressure: appends are queued behind the SourceBuffer's `updateend`;
 * QuotaExceeded is handled by trimming already-played ranges. The host's end signal ends the media stream.
 *
 * iOS note: `MediaSource` on iOS Safari requires 17.1+ (ManagedMediaSource). We do NOT ship an HLS fallback
 * in this pass — older iOS viewers get the recording path (native <video src>) via the offline/vod branch.
 */

// H.264 (baseline/main) + no audio, in an fMP4 container — matches observe's libx264 yuv420p encode.
const FMP4_MIME = 'video/mp4; codecs="avc1.42E01E"'

const FRAME_INIT = 0x01
const FRAME_FRAGMENT = 0x02

export interface MsePlayerHandle {
  /** Tear down: close the socket, end/detach the MediaSource. Idempotent. */
  readonly close: () => void
}

/** Minimal WebSocket surface the player needs; the browser `WebSocket` satisfies it, tests inject a fake. */
export interface PlayerSocket {
  binaryType: string
  readonly addEventListener: (type: string, listener: (event: unknown) => void) => void
  readonly close: () => void
}

export type PlayerSocketFactory = (url: string) => PlayerSocket

/** Minimal MediaSource surface (browser `MediaSource` satisfies it; tests inject a fake). */
export interface MediaSourceLike {
  readonly addEventListener: (type: string, listener: () => void) => void
  readonly addSourceBuffer: (mime: string) => SourceBufferLike
  readonly endOfStream: () => void
  readonly readyState: string
}

export interface SourceBufferLike {
  readonly appendBuffer: (data: Uint8Array) => void
  readonly remove: (start: number, end: number) => void
  readonly addEventListener: (type: string, listener: () => void) => void
  updating: boolean
  readonly buffered: { readonly length: number; readonly start: (i: number) => number; readonly end: (i: number) => number }
}

export interface OpenMsePlayerInput {
  readonly baseUrl: string
  readonly streamId: string
  /** The <video> element to attach the MediaSource to (via `src = URL.createObjectURL(mediaSource)`). */
  readonly video: HTMLVideoElement
  readonly socketFactory?: PlayerSocketFactory
  /** Inject a MediaSource (tests); defaults to a browser `MediaSource` / `ManagedMediaSource`. */
  readonly mediaSourceFactory?: () => MediaSourceLike
  /** Called on the host's clean end signal. */
  readonly onEnded?: () => void
  /** Called on a fatal player error (bad init, socket error). */
  readonly onError?: (error: Error) => void
}

const toWsUrl = (baseUrl: string, streamId: string): string => {
  const ws = baseUrl.replace(/\/+$/, '').replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')
  return `${ws}/live/watch/${encodeURIComponent(streamId)}`
}

const defaultSocketFactory: PlayerSocketFactory = (url) =>
  new WebSocket(url) as unknown as PlayerSocket

const defaultMediaSourceFactory = (): MediaSourceLike => {
  const Managed = (globalThis as { ManagedMediaSource?: new () => MediaSourceLike }).ManagedMediaSource
  const Standard = (globalThis as { MediaSource?: new () => MediaSourceLike }).MediaSource
  const Ctor = Managed ?? Standard
  if (Ctor === undefined) {
    throw new Error('MSE player requires MediaSource (ManagedMediaSource on iOS 17.1+)')
  }
  return new Ctor()
}

const toBytes = (data: unknown): Uint8Array => {
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (data instanceof Uint8Array) return data
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return new Uint8Array(0)
}

/**
 * Open an MSE-backed live player. Returns a handle with `close()`. The returned object attaches to the
 * given `<video>`; the caller owns the element lifecycle.
 */
export function openMsePlayer(input: OpenMsePlayerInput): MsePlayerHandle {
  const socketFactory = input.socketFactory ?? defaultSocketFactory
  const mediaSourceFactory = input.mediaSourceFactory ?? defaultMediaSourceFactory

  let closed = false
  const mediaSource = mediaSourceFactory()
  let sourceBuffer: SourceBufferLike | undefined
  // Fragments that arrive before the SourceBuffer exists / while it is updating queue here in order.
  const queue: Uint8Array[] = []
  let objectUrl: string | undefined
  // Live fMP4 fragments carry a nonzero baseMediaDecodeTime (observed ~251s), so the first buffered range is
  // e.g. [251,315] while `currentTime` is still 0 → HAVE_METADATA stall, blank player. We seek the playhead
  // into the buffered range once appends land. `initialSeekDone` gates the one-shot live-edge jump so we do
  // not fight the user's own seeks afterward; the post-eviction catch-up below is a separate, always-on guard.
  let initialSeekDone = false

  const fail = (error: Error): void => {
    input.onError?.(error)
    close()
  }

  // Drain queued segments into the SourceBuffer one at a time, respecting `updating`. On QuotaExceeded,
  // trim everything before the current playback position and retry — live viewers never need the past.
  const pump = (): void => {
    if (sourceBuffer === undefined || sourceBuffer.updating || queue.length === 0 || closed) return
    const next = queue.shift()!
    try {
      sourceBuffer.appendBuffer(next)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        trimPlayed()
        queue.unshift(next) // retry after the next updateend
        return
      }
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  }

  // Keep the playhead inside the buffered range. Two cases, both fired from `updateend` once bytes have
  // buffered:
  //   1) initial attach — currentTime is 0 (or before buffered.start), and no seek has happened yet. The
  //      fragments start at a nonzero PTS, so we jump to buffered.start once. Guarded by `initialSeekDone`
  //      so a later user seek is never overridden.
  //   2) post-eviction — trimPlayed() removed the range under a lagging playhead, leaving currentTime behind
  //      the new buffered.start. Catch the playhead up so it never stalls behind an evicted range. This can
  //      recur, so it is not gated by the one-shot flag; it only fires when currentTime is strictly behind.
  // We seek to buffered.start rather than the live edge: the pump/trim path already keeps only a ~2s tail
  // behind the playhead, so buffered.start IS near the live edge and starting there avoids a gap-induced stall.
  const seekIntoBuffer = (): void => {
    if (sourceBuffer === undefined || sourceBuffer.buffered.length === 0) return
    const start = sourceBuffer.buffered.start(0)
    const end = sourceBuffer.buffered.end(0)
    const current = input.video.currentTime
    if (current >= start && current <= end) {
      // Playhead is inside the buffered range — nothing to do; do not fight the user's position.
      initialSeekDone = true
      return
    }
    if (!initialSeekDone) {
      input.video.currentTime = start
      initialSeekDone = true
      return
    }
    // After the initial seek: only rescue a playhead that has fallen behind an evicted range.
    if (current < start) {
      input.video.currentTime = start
    }
  }

  const onUpdateEnd = (): void => {
    seekIntoBuffer()
    pump()
  }

  const trimPlayed = (): void => {
    if (sourceBuffer === undefined || sourceBuffer.buffered.length === 0) return
    const start = sourceBuffer.buffered.start(0)
    const current = input.video.currentTime
    // Keep a small safety margin behind the playhead; drop everything older.
    const cutoff = Math.max(start, current - 2)
    if (cutoff > start) {
      try {
        sourceBuffer.remove(start, cutoff)
      } catch {
        /* remove throws if updating — the next updateend re-pumps */
      }
    }
  }

  const onSourceOpen = (): void => {
    if (closed || sourceBuffer !== undefined) return
    try {
      sourceBuffer = mediaSource.addSourceBuffer(FMP4_MIME)
      sourceBuffer.addEventListener('updateend', onUpdateEnd)
      pump()
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  }

  mediaSource.addEventListener('sourceopen', onSourceOpen)

  // Attach the MediaSource to the video. createObjectURL(MediaSource) is the portable path (srcObject for
  // MediaSource is not universally supported yet).
  try {
    objectUrl = URL.createObjectURL(mediaSource as unknown as MediaSource)
    input.video.src = objectUrl
    void input.video.play().catch(() => undefined)
  } catch (error) {
    fail(error instanceof Error ? error : new Error(String(error)))
  }

  const socket = socketFactory(toWsUrl(input.baseUrl, input.streamId))
  socket.binaryType = 'arraybuffer'
  socket.addEventListener('message', (event) => {
    if (closed) return
    const data = (event as { data: unknown }).data
    if (typeof data === 'string') {
      // JSON control frame — currently only the end signal.
      try {
        const msg = JSON.parse(data) as { type?: string }
        if (msg.type === 'end') {
          endStream()
        }
      } catch {
        /* ignore malformed control frames */
      }
      return
    }
    const bytes = toBytes(data)
    if (bytes.length === 0) return
    const tag = bytes[0]!
    const body = bytes.subarray(1)
    if (tag === FRAME_INIT || tag === FRAME_FRAGMENT) {
      queue.push(body.slice())
      pump()
    }
  })
  socket.addEventListener('error', () => fail(new Error('live player socket error')))
  socket.addEventListener('close', () => {
    // A socket close without a prior end is treated as end-of-stream (producer gone).
    endStream()
  })

  const endStream = (): void => {
    if (closed) return
    input.onEnded?.()
    try {
      if (mediaSource.readyState === 'open' && (sourceBuffer === undefined || !sourceBuffer.updating)) {
        mediaSource.endOfStream()
      }
    } catch {
      /* endOfStream throws if not open — safe to ignore */
    }
  }

  const close = (): void => {
    if (closed) return
    closed = true
    try {
      socket.close()
    } catch {
      /* ignore */
    }
    try {
      if (mediaSource.readyState === 'open') mediaSource.endOfStream()
    } catch {
      /* ignore */
    }
    if (objectUrl !== undefined) {
      try {
        URL.revokeObjectURL(objectUrl)
      } catch {
        /* ignore */
      }
    }
  }

  return { close }
}
