export function formatUSDC(n: number, decimals = 2): string {
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'k'
  return '$' + n.toFixed(decimals)
}
export function formatUSDCFull(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
export function formatLvst(n: number): string { return n.toLocaleString('en-US') + ' $LVST' }
export function formatMultiplier(n: number): string { return n.toFixed(2) + 'x' }
export function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00'
  const s = Math.floor(ms / 1000), m = Math.floor(s / 60), sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}
export function formatRate(usdcPerMin: number): string {
  if (usdcPerMin < 0.01) return '—'
  return '$' + usdcPerMin.toFixed(2) + '/min'
}
export function formatMinute(min: number): string { return min + "'" }
export function calcPoolPct(noTotal: number, yesTotal: number): number {
  const total = noTotal + yesTotal
  return total === 0 ? 0.5 : yesTotal / total
}
