export interface AccrualPreviewView {
  projectedShares: number
  valueUsdc: number
  sharesPerSec: number
}

export function mapAccrualPreview(
  preview: { projectedShares: number; valueUSDC: number; sharesPerSec: number } | null,
): AccrualPreviewView | null {
  if (!preview) return null
  return {
    projectedShares: preview.projectedShares,
    valueUsdc: preview.valueUSDC,
    sharesPerSec: preview.sharesPerSec,
  }
}

const line: React.CSSProperties = { fontSize: 9, color: 'rgba(255,255,255,0.35)', margin: 0 }

export function AccrualPreview({ side, rate, sharePrice, preview, loading = false }: {
  side: 'yes' | 'no' | null
  rate: number
  sharePrice?: number
  preview: AccrualPreviewView | null
  loading?: boolean
}) {
  const showAccrual = !!side && rate > 0.01
  if (sharePrice === undefined && !showAccrual) return null
  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {sharePrice !== undefined && (
        <p className="mono" style={line}>Next share ~${sharePrice.toFixed(4)} USDC</p>
      )}
      {showAccrual && (
        <p className="mono" style={line}>
          {loading
            ? 'Projecting accrual…'
            : preview
              ? `~${preview.projectedShares.toFixed(2)} shares / min → $${preview.valueUsdc.toFixed(2)} over 60s`
              : 'Adjust rate to preview accrual'}
        </p>
      )}
    </div>
  )
}
