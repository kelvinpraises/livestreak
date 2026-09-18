import { useEffect, useState, type RefObject } from 'react'

import { openMsePlayer, type MsePlayerHandle } from '#/utils/mse-player'

export type LivePlayerStatus = 'idle' | 'connecting' | 'playing' | 'ended' | 'error'

/**
 * Ask the host where this stream's live door is. A direct-serving broadcaster announces its own
 * watch URL (`/live/direct/:streamId`); everyone else rides the host's fan-out watch path. The
 * lookup is fail-open — any error falls back to the host door.
 */
async function resolveWatchUrl(baseUrl: string, streamId: string): Promise<string | undefined> {
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/+$/, '')}/live/direct/${encodeURIComponent(streamId)}`,
    )
    if (!response.ok) return undefined
    const body = (await response.json()) as { watchUrl?: unknown }
    return typeof body.watchUrl === 'string' ? body.watchUrl : undefined
  } catch {
    return undefined
  }
}

/**
 * Drive the MSE live player against a `<video>` element. When enabled, opens the viewer socket —
 * the broadcaster's own door when one is announced (direct lane), else the host watch path
 * (`ws /live/watch/:streamId`) — and feeds init + fragments into the video's MediaSource. The player
 * attaches directly to the passed video ref, so the same `<video>` that plays a recording (native
 * src) plays live — one element, two source modes.
 */
export function useLiveStreamFeed(input: {
  enabled: boolean
  baseUrl: string
  streamId: string
  videoRef: RefObject<HTMLVideoElement | null>
}): { status: LivePlayerStatus; error: string | null } {
  const [status, setStatus] = useState<LivePlayerStatus>('idle')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const video = input.videoRef.current
    if (!input.enabled || video === null) {
      setStatus('idle')
      setError(null)
      return
    }

    setStatus('connecting')
    setError(null)

    let cancelled = false
    let handle: MsePlayerHandle | undefined

    void resolveWatchUrl(input.baseUrl, input.streamId).then((watchUrl) => {
      if (cancelled) return
      handle = openMsePlayer({
        baseUrl: input.baseUrl,
        streamId: input.streamId,
        ...(watchUrl === undefined ? {} : { watchUrl }),
        video,
        onEnded: () => setStatus('ended'),
        onError: (err) => {
          setStatus('error')
          setError(err.message)
        },
      })
      // Optimistic: the socket + first append flip us to playing; a real error resets via onError.
      setStatus('playing')
    })

    return () => {
      cancelled = true
      handle?.close()
    }
  }, [input.enabled, input.baseUrl, input.streamId, input.videoRef])

  return { status, error }
}
