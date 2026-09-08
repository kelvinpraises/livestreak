import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

// Ported from agentix `library/utils` (the `cn` helper only). The canonical
// shadcn/Radix atoms in `#/components/atoms` use this to merge cva variant
// classes with caller overrides. tailwind-merge dedupes conflicting utilities
// so call-site className overrides (our dark-glass styling) win cleanly.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
