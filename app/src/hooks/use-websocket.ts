import { useState, useEffect, useRef } from 'react'
import type { WSFrame, WSEvent } from '#/types/demo'
import { usePreferFixture, useParsedFixture } from '#/hooks/use-fixture-mode'

export function useWebSocket(url = 'ws://localhost:8765') {
  const preferFixture = usePreferFixture()
  const parsed = useParsedFixture()
  const [frame, setFrame] = useState<WSFrame>(parsed.frame)
  const [events, setEvents] = useState<WSEvent[]>(parsed.events)
  const [connected, setConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    setFrame(parsed.frame)
    setEvents(parsed.events)
  }, [parsed])

  useEffect(() => {
    if (!preferFixture || connected) return
    const interval = setInterval(() => {
      setFrame(prev => ({ ...prev, frame: prev.frame + 1, ts: Date.now() }))
    }, 800)
    return () => clearInterval(interval)
  }, [preferFixture, connected])

  useEffect(() => {
    if (preferFixture) return
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
  }, [url, preferFixture])

  return { frame, events, connected }
}
