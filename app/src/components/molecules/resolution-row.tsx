import { Link } from '@tanstack/react-router'
import { CheckCircle, XCircle, ArrowRight } from '@phosphor-icons/react'
import type { HomepageLifetimeVault } from '#/types/homepage'
import { chainLabel } from '#/utils/chain'
import { formatUSDCFull } from '#/utils/format'

export function ResolutionRow({ vault }: { vault: HomepageLifetimeVault }) {
  const contents = <>
    {vault.outcome === 'yes' ? <CheckCircle size={18} color="#00ff87" weight="fill" /> : <XCircle size={18} color="#ff2d78" />}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14 }}>{vault.option}</div>
      <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 5 }}>{vault.streamTitle}{vault.chain && ` · ${chainLabel(vault.chain)}`}{vault.stale && ' · Last observed; refresh unavailable'}</div>
    </div>
    <span className="mono" style={{ color: vault.outcome === 'yes' ? '#00ff87' : '#ff2d78', fontSize: 12 }}>{vault.outcome.toUpperCase()}</span>
    <span className="mono" style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>{formatUSDCFull(vault.totalPool)}</span>
    {vault.streamId && <ArrowRight size={16} color="rgba(255,255,255,0.4)" />}
  </>
  const style = { display: 'flex', alignItems: 'center', gap: 12, padding: '16px', borderRadius: 10, textDecoration: 'none', background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.08)' }
  return vault.streamId
    ? <Link className="glass-card" to="/stream/$id" params={{ id: vault.streamId }} search={{ vault: vault.vaultId, chain: vault.chain }} style={style}>{contents}</Link>
    : <div style={style}>{contents}</div>
}
