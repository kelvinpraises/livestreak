import { useEffect, useState, type RefObject } from 'react'

import { openMsePlayer } from '#/utils/mse-player'

export type LivePlayerStatus = 'idle' | 'connecting' | 'playing' | 'ended' | 'error'

/**
 * Drive the MSE live player against a `<video>` element. When enabled, opens the host viewer socket
 * (`ws /live/watch/:streamId`) and feeds init + fragments into the video's MediaSource. The player attaches
 * directly to the passed video ref, so the same `<video>` that plays a recording (native src) plays live —
 * one element, two source modes.
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
    const handle = openMsePlayer({
      baseUrl: input.baseUrl,
      streamId: input.streamId,
      video,
      onEnded: () => setStatus('ended'),
      onError: (err) => {
        setStatus('error')
        setError(err.message)
      },
    })
    // Optimistic: the socket + first append flip us to playing; a real error resets via onError.
    setStatus('playing')

    return () => {
      handle.close()
    }
  }, [input.enabled, input.baseUrl, input.streamId, input.videoRef])

  return { status, error }
}
