import type { StreamFeedDetail, StreamPointer } from '#/utils/stream'

/**
 * Live-eligibility + sticky latch for the host live feed. Transport-neutral (fMP4 fan-out): decides WHEN a
 * stream is live and should take the host live path, not HOW it is carried. Extracted so the media
 * transport can change without touching this logic.
 */

/**
 * True when the stream is LIVE — then we take the host live feed. A `watchUrl` is the recording (the goLive
 * storage pointer / archived blob); it's for REPLAY once the stream has ended, so it must not pre-empt the
 * live feed while the producer is still broadcasting.
 */
export function shouldUseLiveFeed(
  pointer: StreamPointer | undefined,
  host: StreamFeedDetail | null | undefined,
): boolean {
  return pointer?.status === 'live' || host?.isLive === true
}

/** Sticky-latched live eligibility, scoped to one streamId. */
export interface LiveFeedLatch {
  readonly streamId: string
  readonly enabled: boolean
}

/**
 * Latch step. `eligible` flickers with the ~3s board poll; this HOLDS `enabled` true across transient drops
 * so an in-flight live session is never torn down. Releases only when the pointer reports `ended`; a new
 * `streamId` re-evaluates from scratch. Returns `prev` unchanged when nothing moved (no re-render).
 */
export function nextLiveFeedLatch(
  prev: LiveFeedLatch,
  streamId: string,
  eligible: boolean,
  ended: boolean,
): LiveFeedLatch {
  const fresh = prev.streamId !== streamId
  const enabled = ended ? false : fresh ? eligible : prev.enabled || eligible
  return !fresh && enabled === prev.enabled ? prev : { streamId, enabled }
}

/**
 * Derived `enabled` the player sees: the latched value for THIS stream, OR live eligibility right now. The
 * live clause keeps go-live instant (no extra-render lag); the streamId guard stops a stale latch from a
 * previous market leaking into a freshly navigated stream; `ended` releases immediately (no render lag).
 */
export function resolveLiveFeedEnabled(
  latch: LiveFeedLatch,
  streamId: string,
  eligible: boolean,
  ended: boolean,
): boolean {
  return !ended && ((latch.streamId === streamId && latch.enabled) || eligible)
}
