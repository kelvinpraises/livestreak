import raw from './fixture-demo.json'
import type { AppFixture } from '#/types/host-edge'

// The bundled fixture predates the host contract's `chain` tag on discovery items; the app
// reads these shapes and ignores the (absent) tag, so cast through `unknown`.
export const defaultHostEdgeFixture = raw as unknown as AppFixture

export const DEMO_EDGE_KEY = 'livestreak_demo_edge'
export const DEMO_FIXTURE_KEY = 'livestreak_edge_fixture'

export function readDemoEdgeEnabled(fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  const stored = sessionStorage.getItem(DEMO_EDGE_KEY)
  if (stored === '1') return true
  if (stored === '0') return false
  return fallback
}

export function writeDemoEdgeEnabled(on: boolean): void {
  sessionStorage.setItem(DEMO_EDGE_KEY, on ? '1' : '0')
}

export function readInjectedFixture(): AppFixture | null {
  if (typeof window === 'undefined') return null
  const rawJson = sessionStorage.getItem(DEMO_FIXTURE_KEY)
  if (!rawJson) return null
  try {
    return JSON.parse(rawJson) as AppFixture
  } catch {
    return null
  }
}

export function writeInjectedFixture(data: AppFixture | null): void {
  if (data === null) {
    sessionStorage.removeItem(DEMO_FIXTURE_KEY)
    return
  }
  sessionStorage.setItem(DEMO_FIXTURE_KEY, JSON.stringify(data))
}
