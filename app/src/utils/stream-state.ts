import type { HomepageStreamCard } from '#/types/homepage'
export function streamState(stream: Pick<HomepageStreamCard, 'isLive' | 'streamStatus' | 'stale'>): 'live' | 'ended' | 'offline' | 'stale' {
  if (stream.stale) return 'stale'
  if (stream.streamStatus === 'ended') return 'ended'
  return stream.isLive ? 'live' : 'offline'
}
