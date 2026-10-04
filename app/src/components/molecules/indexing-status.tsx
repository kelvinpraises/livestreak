import type { CatalogIndexing } from '@livestreak/host'
export function IndexingStatus({ indexing }: { indexing?: CatalogIndexing }) {
  const verified = indexing?.verifiedChains ?? []
  if (indexing?.statsScope === 'complete') return <p role="status" style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginBottom: 20 }}>Totals and results verified from {verified.join(', ')} · Updated {new Date(indexing.generatedAtMs).toLocaleTimeString()}</p>
  const incomplete = indexing?.chains?.filter(c => c.status !== 'fresh').map(c => c.chain) ?? indexing?.failedChains ?? []
  const text = !indexing ? 'Index freshness is unavailable. Totals and results cannot be verified.' : indexing.statsScope === 'verified-subset' ? `Totals and results include only verified records from ${verified.join(', ')}.${incomplete.length ? ` Coverage incomplete: ${incomplete.join(', ')}.` : ''} Unverified records are excluded.` : 'No current records could be verified. Totals and results are unavailable; previously indexed streams are marked stale.'
  return <p role="status" style={{ color: '#ffd553', fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>{text}</p>
}
