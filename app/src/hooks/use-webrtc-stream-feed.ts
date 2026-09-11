import { useEffect, useRef, useState } from 'react'

import {
  consumeHostWebRtcFeed,
  type WebRtcConsumerStatus,
} from '#/utils/webrtc-consumer'

export function useWebRtcStreamFeed(input: {
  enabled: boolean
  baseUrl: string
  streamId: string
}): {
  blobUrl: string | undefined
  status: WebRtcConsumerStatus
  error: string | null
} {
  const [blobUrl, setBlobUrl] = useState<string | undefined>(undefined)
  const [status, setStatus] = useState<WebRtcConsumerStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const blobRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!input.enabled) {
      setStatus('idle')
      setError(null)
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current)
        blobRef.current = undefined
      }
      setBlobUrl(undefined)
      return
    }

    const controller = new AbortController()
    let cancelled = false

    setStatus('connecting')
    setError(null)
    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current)
      blobRef.current = undefined
    }
    setBlobUrl(undefined)

    void consumeHostWebRtcFeed({
      baseUrl: input.baseUrl,
      streamId: input.streamId,
      signal: controller.signal,
    })
      .then((result) => {
        if (cancelled) {
          URL.revokeObjectURL(result.blobUrl)
          return
        }
        blobRef.current = result.blobUrl
        setBlobUrl(result.blobUrl)
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
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current)
        blobRef.current = undefined
      }
    }
  }, [input.enabled, input.baseUrl, input.streamId])

  return { blobUrl, status, error }
}
