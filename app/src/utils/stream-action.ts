export type StreamMode = 'mint' | 'choose' | 'stop' | 'switch' | 'stream'

export interface StreamActionInput {
  needsMint: boolean
  side: 'yes' | 'no' | null
  rate: number
  activeFundedSide?: 'yes' | 'no'
}

/**
 * The single funding button serves five intents. Resolving them in one place keeps every card's button
 * label, colour, and click handler consistent. Dragging an active stream to the slider's centre reads as
 * the `stop` intent — which is a PAUSE on-chain (the lane keeps its deposit + shares and resumes).
 */
export function streamMode({ needsMint, side, rate, activeFundedSide }: StreamActionInput): StreamMode {
  if (needsMint) return 'mint'
  if (activeFundedSide && rate < 0.01) return 'stop'
  if (!side) return 'choose'
  if (activeFundedSide && side !== activeFundedSide) return 'switch'
  return 'stream'
}

export function streamLabel(mode: StreamMode, { side }: StreamActionInput): string {
  switch (mode) {
    case 'mint': return 'Mint your position on the Streams tab'
    case 'choose': return 'CHOOSE A SIDE'
    case 'stop': return 'PAUSE STREAM'
    case 'switch': return `SWITCH → ${side!.toUpperCase()}`
    case 'stream': return `STREAM → ${side!.toUpperCase()}`
  }
}
