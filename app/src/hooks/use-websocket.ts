import { useState, useEffect, useRef } from 'react'
import { env } from '#/utils/env'
import type { WSFrame, WSEvent } from '#/types/ui'

export function useWebSocket(url = env.activityWsUrl) {
  const [frame, setFrame] = useState<WSFrame>({ frame: 0, ts: 0, min: 0, events: [] })
  const [events, setEvents] = useState<WSEvent[]>([])
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!url) return
    try {
      const ws = new WebSocket(url)
      ws.onopen = () => setConnected(true)
      ws.onmessage = (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data as string) as WSFrame
          setFrame(data)
          if (data.events?.length) setEvents(prev => [...data.events, ...prev].slice(0, 50))
        } catch { /* ignore */ }
      }
      ws.onclose = () => setConnected(false)
      ws.onerror = () => ws.close()
      wsRef.current = ws
    } catch { /* ws unavailable */ }
    return () => wsRef.current?.close()
  }, [url])

  return { frame, events, connected }
}
