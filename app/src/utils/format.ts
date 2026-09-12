export function formatUSDC(n: number, decimals = 2): string {
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'k'
  return '$' + n.toFixed(decimals)
}
export function formatUSDCFull(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
export function formatLvst(n: number): string { return n.toLocaleString('en-US') + ' $LVST' }
export function formatMultiplier(n: number): string { return n.toFixed(2) + 'x' }
// Short countdown for HOT timers etc. Hour/day-aware so a long duration never renders as "1323:41":
// under an hour it stays m:ss, beyond that it rolls up to "Xh Ym" / "Xd Yh".
export function formatCountdown(ms: number): string {
  if (ms <= 0) return '0:00'
  const totalSec = Math.floor(ms / 1000)
  const d = Math.floor(totalSec / 86_400)
  const h = Math.floor((totalSec % 86_400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}:${s.toString().padStart(2, '0')}`
}
// Runway / time-left readout at MINUTE granularity (no jittery seconds): "<1m" / "12m" / "3h 5m" / "2d 4h".
export function formatRunway(ms: number): string {
  if (ms <= 0) return 'now'
  const totalMin = Math.floor(ms / 60_000)
  if (totalMin < 1) return '<1m'
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
export function formatRate(usdcPerMin: number): string {
  if (usdcPerMin < 0.01) return '—'
  return '$' + usdcPerMin.toFixed(2) + '/min'
}
// Human share count. Shares are SECONDARY to "% of side" on the card, so stay compact: exact when small,
// grouped in the thousands, K/M when large (the 95884945420631800000 case → e.g. "2.45M"). Rolls K→M at
// ~999.5K so it never prints "1000.0K".
export function formatShares(n: number): string {
  if (!isFinite(n) || n <= 0) return '0'
  if (n < 100) return (+n.toFixed(2)).toString() // 12.4, 95.88
  if (n < 10_000) return Math.round(n).toLocaleString('en-US') // 312, 2,450
  if (n < 999_500) return +(n / 1_000).toFixed(1) + 'K' // 24.5K … 999.5K
  return +(n / 1_000_000).toFixed(2) + 'M' // 1.00M, 2.45M
}
// "% of side" — the HERO metric on a position. 1 decimal, trimmed; a tiny sliver shows "<0.1%" not "0%".
export function formatSharePct(p: number): string {
  if (!isFinite(p) || p <= 0) return '0%'
  if (p < 0.1) return '<0.1%'
  return (+p.toFixed(1)).toString() + '%' // 6.1%, 18.2%, 100%
}
export function formatMinute(min: number): string { return min + "'" }
export function calcPoolPct(noTotal: number, yesTotal: number): number {
  const total = noTotal + yesTotal
  return total === 0 ? 0.5 : yesTotal / total
}
