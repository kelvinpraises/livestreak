import type { OptionsStreamStatus } from '@livestreak/options'

/** On-chain stream pointer surfaced from the options board (market.stream). */
export interface StreamPointer {
  status: OptionsStreamStatus
  scheme: string
  id: string
}

export type StreamMediaKind = 'live' | 'vod' | 'none'

export interface StreamMedia {
  kind: StreamMediaKind
  /** Playable URL when resolvable (live watch URL, or a stored-blob aggregator URL for VOD). */
  src?: string
}

/**
 * Resolve a stream pointer's `(scheme, id)` to a content-gateway URL. The blob body (live manifest vs
 * VOD ref) is the un-converged 3-team StreamManifest schema; for now this returns the stored-blob
 * aggregator URL, which is correct for VOD playback. Live playback uses the host watch URL instead.
 */
export function schemeToGatewayUrl(scheme: string, id: string): string | undefined {
  switch (scheme) {
    case 'walrus-testnet':
      return `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${id}`
    case 'walrus-mainnet':
      return `https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${id}`
    case 'ipfs':
      return `https://ipfs.io/ipfs/${id}`
    case 'arweave':
      return `https://arweave.net/${id}`
    default:
      return undefined
  }
}

/**
 * Decide player mode + source from the on-chain stream status and the host's live watch URL.
 * - live  → host watch URL (host-forwarded live source) when available, else the gateway URL
 * - ended → the stored-blob gateway URL (replay)
 * - none/absent → offline placeholder
 *
 * Structured as a single seam: when the StreamManifest body schema converges, only this fn changes.
 */
export function resolveStreamMedia(
  pointer: StreamPointer | undefined,
  hostWatchUrl?: string,
): StreamMedia {
  if (!pointer || pointer.status === 'none') return { kind: 'none' }
  const gatewayUrl = schemeToGatewayUrl(pointer.scheme, pointer.id)
  if (pointer.status === 'live') {
    return { kind: 'live', src: hostWatchUrl ?? gatewayUrl }
  }
  // ended
  return { kind: 'vod', src: gatewayUrl }
}

/** Minimal host/fixture stream detail shape this resolver needs (subset of HostStreamDetail). */
export interface StreamFeedDetail {
  watchUrl?: string
  isLive: boolean
}

/**
 * Resolve the feed source for ONE stream from THAT stream's own data (C: per-stream feed, never a
 * single global asset). Priority:
 *  1. The on-chain stream pointer (market.stream) — its VOD blob in `ended`, its host-forwarded
 *     live source (incl. the SEAM-WEBRTC leg surfaced as a watch URL) while `live`.
 *  2. Otherwise the per-route host/fixture stream detail's watch URL — this is what powers demo mode
 *     (each fixture stream carries its own `watchUrl`) and any live market that has a host watch URL
 *     but no on-chain pointer yet.
 *  3. Otherwise an honest offline placeholder.
 */
export function resolveStreamFeed(
  pointer: StreamPointer | undefined,
  host: StreamFeedDetail | null | undefined,
): StreamMedia {
  if (pointer && pointer.status !== 'none') {
    const fromPointer = resolveStreamMedia(pointer, host?.watchUrl)
    if (fromPointer.kind !== 'none' && fromPointer.src) return fromPointer
  }
  if (host?.watchUrl) {
    return { kind: host.isLive ? 'live' : 'vod', src: host.watchUrl }
  }
  return { kind: 'none' }
}
