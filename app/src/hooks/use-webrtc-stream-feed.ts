import { useEffect, useRef, useState } from 'react'

import {
  consumeHostWebRtcFeed,
  type WebRtcConsumerStatus,
} from '#/utils/webrtc-consumer'

/**
 * Subscribe to a live host-mediated WebRTC feed and expose its inbound `MediaStream` for `<video>.srcObject`.
 * The stream is real-time (RTP media track); the peer is held OPEN while enabled and torn down on cleanup.
 */
export function useWebRtcStreamFeed(input: {
  enabled: boolean
  baseUrl: string
  streamId: string
}): {
  stream: MediaStream | undefined
  status: WebRtcConsumerStatus
  error: string | null
} {
  const [stream, setStream] = useState<MediaStream | undefined>(undefined)
  const [status, setStatus] = useState<WebRtcConsumerStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<(() => void) | undefined>(undefined)

  useEffect(() => {
    const teardown = () => {
      if (closeRef.current) {
        closeRef.current()
        closeRef.current = undefined
      }
    }

    if (!input.enabled) {
      setStatus('idle')
      setError(null)
      teardown()
      setStream(undefined)
      return
    }

    const controller = new AbortController()
    let cancelled = false

    setStatus('connecting')
    setError(null)
    teardown()
    setStream(undefined)

    void consumeHostWebRtcFeed({
      baseUrl: input.baseUrl,
      streamId: input.streamId,
      signal: controller.signal,
    })
      .then((result) => {
        if (cancelled) {
          result.close()
          return
        }
        closeRef.current = result.close
        setStream(result.stream)
        setStatus('ready')
      })
      .catch((err) => {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return
        setStatus('error')
        setError(err instanceof Error ? err.message : String(err))
      })

    return () => {
      cancelled = true
      controller.abort()
      teardown()
    }
  }, [input.enabled, input.baseUrl, input.streamId])

  return { stream, status, error }
}
