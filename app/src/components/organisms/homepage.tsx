import { Link } from '@tanstack/react-router'
import { motion } from 'framer-motion'
import { Play, Stack, Fire, ArrowRight, Eye, CurrencyDollar, Trophy, Clock,  } from '@phosphor-icons/react'
import type { HomepageLiveVaultCard, HomepageStreamCard } from '#/types/homepage'
import { useHomepageData } from '#/hooks/use-homepage-data'
import { chainLabel } from '#/utils/chain'
import { streamState } from '#/utils/stream-state'
import { IndexingStatus } from '#/components/molecules/indexing-status'
import { ResolutionRow } from '#/components/molecules/resolution-row'
import { formatUSDCFull } from '#/utils/format'



/** Permutation #4: headline = effective pool; muted settled subline when host splits them. */
function showsSettledSubline(effective: number, settled?: number): settled is number {
  return settled !== undefined && effective > settled
}

function SettledPoolSubline({ effective, settled }: { effective: number; settled?: number }) {
  if (!showsSettledSubline(effective, settled)) return null
  return (
    <span className="mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.02em' }}>
      Settled {formatUSDCFull(settled)}
    </span>
  )
}

export function HomePage() {
  const { streams, liveVaults, lifetimeVaults, protocolStats, ready, error, indexing } = useHomepageData()
  const statsVerified = ready && !error && (indexing?.statsScope === 'complete' || indexing?.statsScope === 'verified-subset')
  const visibleStreams = streams.filter(stream => streamState(stream) === 'live')
  const visibleLiveVaults = statsVerified ? liveVaults.filter(v => !v.stale) : []
  const visibleLifetime = statsVerified ? lifetimeVaults.filter(v => !v.stale) : []
  const resolvedPooled = visibleLifetime.reduce((sum, vault) => sum + vault.totalPool, 0)

  return (
    <div style={{ overflowY: 'auto', height: 'calc(100vh - 56px)' }}>
      {/* Hero */}
      <section style={{ padding: '100px 24px 80px', position: 'relative', overflow: 'hidden' }}>
        <div className="ambient-mesh" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: '30%', left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(0,255,135,0.06), transparent)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: '70%', left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(255,45,120,0.04), transparent)', pointerEvents: 'none' }} />

        <div style={{ position: 'relative', zIndex: 1, maxWidth: 800, margin: '0 auto', textAlign: 'center' }}>
          <motion.div initial={{ opacity: 0, transform: 'translateY(12px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} transition={{ delay: 0.1, duration: 0.4 }} style={{ marginBottom: 32 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(0,255,135,0.06)', border: '1px solid rgba(0,255,135,0.18)', borderRadius: 20, padding: '5px 16px' }}>
              <div className="live-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: '#00ff87' }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: '#00ff87', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}>EARLY ACCESS</span>
            </div>
          </motion.div>

          <div className="broadcast-corners" style={{ display: 'inline-block', padding: '8px 24px', marginBottom: 28 }}>
            <motion.h1 className="display" style={{ lineHeight: 1.2, letterSpacing: '-0.01em' }}>
              <motion.span initial={{ opacity: 0, transform: 'translateY(20px)', filter: 'blur(6px)' }} animate={{ opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' }} transition={{ delay: 0.2, duration: 0.5, ease: [0.16, 1, 0.3, 1] }} style={{ display: 'block', fontSize: 48, fontWeight: 700, color: '#fff' }}>
                Any live stream.
              </motion.span>
              <motion.span initial={{ opacity: 0, transform: 'translateY(20px)', filter: 'blur(6px)' }} animate={{ opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' }} transition={{ delay: 0.35, duration: 0.5, ease: [0.16, 1, 0.3, 1] }} className="text-prismatic" style={{ display: 'block', fontSize: 48, fontWeight: 700 }}>
                Any prediction.
              </motion.span>
              <motion.span initial={{ opacity: 0, transform: 'translateY(20px)', filter: 'blur(6px)' }} animate={{ opacity: 1, transform: 'translateY(0px)', filter: 'blur(0px)' }} transition={{ delay: 0.5, duration: 0.5, ease: [0.16, 1, 0.3, 1] }} style={{ display: 'block', fontSize: 36, fontWeight: 500, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>
                Every loss creates an owner.
              </motion.span>
            </motion.h1>
          </div>

          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7, duration: 0.4 }} style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)', lineHeight: 1.7, maxWidth: 500, margin: '0 auto 36px', fontWeight: 300 }}>
            Watch live video. Predict what happens next with streaming USDC. AI agents create markets in real-time. Losers earn $LVST and become protocol owners.
          </motion.p>

          <motion.div initial={{ opacity: 0, transform: 'translateY(10px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} transition={{ delay: 0.9, duration: 0.3 }}>
            <a href="#streams" className="cta-glow" style={{ padding: '14px 30px', fontSize: 15, borderRadius: 10 }}>
              Browse Live Streams <ArrowRight size={16} />
            </a>
          </motion.div>
        </div>
      </section>

      {/* Protocol Stats Bar */}
      {ready && !error && <div style={{ maxWidth: 1120, margin: '0 auto', padding: '0 24px' }}><IndexingStatus indexing={indexing} /></div>}
      <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1, duration: 0.4 }}>
        <div className="broadcast-rule" />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, padding: '14px 24px', background: 'rgba(255,255,255,0.015)' }}>
          {[
            { label: 'VAULTS', value: protocolStats.totalVaults.toLocaleString(), accent: '#00ff87' },
            { label: 'POOLED', value: formatUSDCFull(protocolStats.totalVolume), accent: '#00c8ff' },
            { label: 'LIVE', value: protocolStats.activeStreams.toString(), accent: '#ff2d78' },
            { label: 'RESOLVED', value: protocolStats.resolvedVaults.toString(), accent: '#ffd553' },
          ].map((stat, i) => (
            <div key={stat.label} style={{ display: 'flex', alignItems: 'center' }}>
              {i > 0 && <span className="sep-dot" style={{ fontSize: 18 }}>&middot;</span>}
              <span className="data-tag">
                <span className="data-label">{stat.label}</span>
                <span className="data-value" style={{ color: stat.accent }}>{statsVerified ? stat.value : '—'}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="broadcast-rule" />
      </motion.section>

      {/* Live Streams */}
      <section id="streams" style={{ padding: '48px 24px', maxWidth: 1120, margin: '0 auto' }}>
        <motion.div initial={{ opacity: 0, transform: 'translateY(10px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} transition={{ delay: 1.1, duration: 0.3 }} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <div className="live-dot" style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff2d78', boxShadow: '0 0 8px #ff2d78' }} />
          <h2 className="display" style={{ fontSize: 22, fontWeight: 700, color: '#fff', letterSpacing: '0.02em' }}>Live Now</h2>
        </motion.div>
        {!ready && <p role="status" style={{ color: 'rgba(255,255,255,0.5)' }}>Loading streams…</p>}
        {error && <p role="alert" style={{ color: '#ffd553' }}>Stream catalog unavailable ({error.slice(0, 160)}). Retrying…</p>}
        {ready && !error && visibleStreams.length === 0 && <p style={{ color: 'rgba(255,255,255,0.5)' }}>{indexing?.statsScope === 'complete' ? 'No streams are live right now.' : 'No live streams in the verified records.'} All broadcasts are on the Streams page.</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
          {visibleStreams.map((stream, i) => <StreamCard key={`${stream.chain}:${stream.id}`} stream={stream} index={i} />)}
        </div>
      </section>

      {/* Live Vaults */}
      <section style={{ padding: '0 24px 48px', maxWidth: 1120, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <Stack size={18} color="#00ff87" />
          <h2 className="display" style={{ fontSize: 22, fontWeight: 700, color: '#fff', letterSpacing: '0.02em' }}>Open Vaults</h2>
          <span className="mono" style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginLeft: 4 }}>{statsVerified ? `${visibleLiveVaults.length} indexed` : 'Refresh incomplete'}</span>
        </div>
        {visibleLiveVaults.length === 0 && <p style={{ color: 'rgba(255,255,255,0.5)' }}>{!ready ? 'Loading vaults…' : statsVerified ? 'No open vaults right now.' : 'Open vaults could not be verified.'}</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {visibleLiveVaults.map((vault, i) => <LiveVaultCard key={`${vault.chain}:${vault.vaultId}`} vault={vault} index={i} />)}
        </div>
      </section>

      {/* Lifetime / Resolved Vaults */}
      <section style={{ padding: '0 24px 48px', maxWidth: 1120, margin: '0 auto' }}>
        <div className="broadcast-rule" style={{ marginBottom: 32 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <Trophy size={18} color="#ffd553" />
          <h2 className="display" style={{ fontSize: 22, fontWeight: 700, color: '#fff', letterSpacing: '0.02em' }}>Lifetime</h2>
        </div>

        {/* Lifetime stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
          <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>RESOLVED</div>
            <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>{statsVerified ? protocolStats.resolvedVaults : '—'}</div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>RESOLVED POOL</div>
            <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: '#00c8ff' }}>{statsVerified ? formatUSDCFull(resolvedPooled) : '—'}</div>
          </div>
          <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', marginBottom: 4, fontFamily: 'var(--font-mono)' }}>YES OUTCOMES</div>
            <div className="mono" style={{ fontSize: 20, fontWeight: 700, color: '#00ff87' }}>
              {statsVerified && protocolStats.yesWinRatePct !== null ? `${protocolStats.yesWinRatePct}%` : '—'}
            </div>
          </div>
        </div>

        {/* Recent resolutions */}
        <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.25)', padding: '4px 0 10px' }}>RECENT RESOLUTIONS</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {visibleLifetime.map(vault => <ResolutionRow key={`${vault.chain}:${vault.vaultId}`} vault={vault} />)}
          {lifetimeVaults.some(v => v.stale) && <p role="status" style={{ color: '#ffd553', fontSize: 12 }}>Previous results awaiting verification are excluded from this list and the totals.</p>}
        </div>
      </section>

      {/* How It Works */}
      <section style={{ padding: '48px 24px 64px', maxWidth: 1120, margin: '0 auto', position: 'relative' }}>
        <div className="broadcast-rule" style={{ marginBottom: 48 }} />
        <h2 className="display" style={{ fontSize: 22, fontWeight: 700, color: '#fff', textAlign: 'center', marginBottom: 48, letterSpacing: '0.02em' }}>How It Works</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          {[
            { step: '01', icon: Eye, title: 'Watch', desc: 'Tune into any live stream. AI agents analyze the video and generate real-time prediction markets.', accent: '#00ff87' },
            { step: '02', icon: Play, title: 'Predict', desc: 'Stream USDC into YES or NO positions. No "place bet" button — your money flows continuously.', accent: '#00c8ff' },
            { step: '03', icon: Trophy, title: 'Earn', desc: 'Win and collect USDC. Lose and receive $LVST tokens — every loss makes you a protocol owner.', accent: '#ffd553' },
          ].map((item, i) => (
            <motion.div key={item.step} initial={{ opacity: 0, transform: 'translateY(16px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} transition={{ delay: 0.3 + i * 0.1 }}
              className="broadcast-corners" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 12, padding: '32px 24px', position: 'relative', overflow: 'visible' }}>
              <div style={{ position: 'absolute', top: 12, right: 16, fontSize: 56, fontWeight: 700, fontFamily: 'var(--font-display)', color: `${item.accent}08`, lineHeight: 1, letterSpacing: '-0.02em' }}>{item.step}</div>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: `${item.accent}0a`, border: `1px solid ${item.accent}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
                <item.icon size={18} color={item.accent} />
              </div>
              <h3 className="display" style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 10, letterSpacing: '0.02em' }}>{item.title}</h3>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.38)', lineHeight: 1.65, fontWeight: 300 }}>{item.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer>
        <div className="broadcast-rule" />
        <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.18)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>LIVESTREAK PROTOCOL &middot; ALPHA</span>
        </div>
      </footer>
    </div>
  )
}

/* ─── Stream Card ─── */

export function StreamCard({ stream, index, entranceDelay = 1.15 }: { stream: HomepageStreamCard; index: number; entranceDelay?: number }) {
  const state = streamState(stream)
  const category = ['live', 'uncategorized', ''].includes(stream.category.toLowerCase()) ? null : stream.category
  const categoryColors: Record<string, string> = { Tech: '#00ff87', Esports: '#00c8ff', Politics: '#ff7a00', Entertainment: '#ffd553' }
  const accent = categoryColors[stream.category] ?? '#00ff87'
  const statusColor = state === 'live' ? '#ff2d78' : state === 'stale' ? '#ffd553' : 'rgba(255,255,255,0.6)'

  return (
    <Link to="/stream/$id" params={{ id: stream.id }} search={{ chain: stream.chain }} style={{ textDecoration: 'none' }}>
      <motion.div initial={{ opacity: 0, transform: 'translateY(12px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} transition={{ delay: entranceDelay + Math.min(index, 5) * 0.06 }} className="glass-card" style={{ cursor: 'pointer', overflow: 'hidden' }}
        whileHover={{ borderColor: `${accent}40`, boxShadow: `0 0 28px ${accent}12` }}>
        <div style={{ height: 130, background: `linear-gradient(135deg, ${accent}06 0%, rgba(13,13,28,0.98) 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at 50% 80%, ${accent}08 0%, transparent 60%)`, pointerEvents: 'none' }} />
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: `${accent}10`, border: `1px solid ${accent}25`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Play size={20} color={accent} />
          </div>
          {(
            <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(0,0,0,0.7)', borderRadius: 4, padding: '3px 8px', backdropFilter: 'blur(4px)' }}>
              <div className={state === 'live' ? 'live-dot' : undefined} style={{ width: 5, height: 5, borderRadius: '50%', background: statusColor }} />
              <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: statusColor, letterSpacing: '0.1em' }}>{state.toUpperCase()}</span>
            </div>
          )}
          {category && <div style={{ position: 'absolute', top: 10, right: 10, background: `${accent}12`, border: `1px solid ${accent}25`, borderRadius: 4, padding: '2px 8px' }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: accent, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>{category}</span>
          </div>}
        </div>
        <div style={{ padding: '12px 14px' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.85)', marginBottom: 8, lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stream.title}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Stack size={11} color="rgba(255,255,255,0.3)" /><span className="mono" style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{stream.stale ? '—' : stream.activeVaults} active vaults</span></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <CurrencyDollar size={11} color="#00c8ff" />
                <span className="mono" style={{ fontSize: 11, color: '#00c8ff', fontWeight: 600 }}>{stream.stale ? '—' : formatUSDCFull(stream.totalPooled)}</span>
              </div>
              {!stream.stale && <SettledPoolSubline effective={stream.totalPooled} settled={stream.settledPooled} />}
            </div>
          </div>
          {state === 'ended' && <p style={{ marginTop: 10, fontSize: 12, color: stream.replay ? '#00ff87' : 'rgba(255,255,255,0.45)' }}>{stream.replay ? 'Watch replay' : stream.recordingStatus === 'processing' ? 'Replay processing…' : stream.recordingStatus === 'recording' ? 'Recording finishing…' : 'No recording available'}</p>}
          {state === 'live' && stream.elapsed && (
            <div style={{ marginTop: 8 }}><span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.22)' }}>{stream.elapsed}</span></div>
          )}
        </div>
      </motion.div>
    </Link>
  )
}

/* ─── Live Vault Card ─── */

function LiveVaultCard({ vault, index }: { vault: HomepageLiveVaultCard; index: number }) {
  const isHot = vault.status === 'hot'
  return (
    <Link to="/stream/$id" params={{ id: vault.streamId }} search={{ chain: vault.chain, vault: vault.vaultId }} style={{ textDecoration: 'none' }}>
      <motion.div initial={{ opacity: 0, transform: 'translateY(10px)' }} animate={{ opacity: 1, transform: 'translateY(0px)' }} transition={{ delay: 0.3 + index * 0.05 }}
        style={{ background: 'var(--color-bg-card)', border: `1px solid ${isHot ? 'rgba(255,45,120,0.25)' : 'rgba(255,255,255,0.05)'}`, borderRadius: 10, padding: '14px 16px', cursor: 'pointer', transition: 'border-color 0.2s, box-shadow 0.2s' }}
        whileHover={{ borderColor: isHot ? 'rgba(255,45,120,0.5)' : 'rgba(255,255,255,0.12)', boxShadow: isHot ? '0 0 20px rgba(255,45,120,0.08)' : '0 0 20px rgba(255,255,255,0.03)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <p style={{ fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.72)', lineHeight: 1.4, flex: 1 }}>{vault.option}</p>
          {isHot && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
              <Fire size={11} color="#ff2d78" />
              <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: '#ff2d78' }}>HOT</span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)' }}>{vault.streamTitle} {vault.chain && `· ${chainLabel(vault.chain)}`}</span>
          <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: isHot ? '#ff7a00' : '#00ff87', textShadow: isHot ? '0 0 12px rgba(255,122,0,0.3)' : '0 0 12px rgba(0,255,135,0.2)' }}>
            {vault.stale ? 'STALE' : vault.status.toUpperCase()}
          </span>
        </div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>Pool</span>
              <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.55)' }}>{formatUSDCFull(vault.totalPool)}</span>
            </div>
            <SettledPoolSubline effective={vault.totalPool} settled={vault.settledPool} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Clock size={10} color="rgba(255,255,255,0.2)" />
            <span className="mono" style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{vault.stale ? 'Last observed' : `${Math.floor(vault.expiresInSec / 60)}m left`}</span>
          </div>
        </div>
      </motion.div>
    </Link>
  )
}
