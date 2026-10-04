import { useId, useState } from 'react'
import { CheckCircle, ShieldCheck, ArrowRight, SpinnerGap } from '@phosphor-icons/react'
import { perMinUSDCToRate, type OptionsVault } from '@livestreak/options'
import { useOptionsContext } from '#/providers/options-provider'
import { useFundingRules } from '#/hooks/use-funding-rules'
import { useWalletActions } from '#/hooks/use-wallet-actions'
import { useVaultView } from '#/hooks/use-vault-views'
import type { StreamDraft } from '#/hooks/use-stream-draft'
import { formatUSDCFull, formatRate, formatShares } from '#/utils/format'
import type { VaultMandate } from '@livestreak/schema'

const date = (seconds: number) => new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
function Rules({ mandate }: { mandate: VaultMandate }) {
  const evaluation = mandate.evaluation
  return <div className="funding-rules-body">
    <p><b>YES</b> {mandate.yesMeaning}</p><p><b>NO</b> {mandate.noMeaning}</p>
    <p><b>Decision</b> {mandate.method} · the market’s designated Steward. Registry authority may change.</p>
    {'rubric' in evaluation && <p>{evaluation.rubric}</p>}
    {(evaluation.kind === 'numeric-threshold' ? [evaluation] : evaluation.kind === 'mixed' ? evaluation.checks : []).map((check, i) =>
      <p key={i}>{check.sourceId}: {check.field} {check.comparator} {check.threshold} {check.units}; a tie means {check.tie.toUpperCase()}.</p>)}
    <p><b>Evidence</b> {mandate.evidence.map(e => `${e.description} (${e.sourceId}, ${e.kind})`).join('; ')}</p>
    <p><b>Funding closes</b> {date(mandate.fundingClose)} · your local time</p>
    <p><b>Decision window</b> {date(mandate.decisionStart)} – {date(mandate.decisionEnd)}</p>
    <p><b>Missing evidence</b> {mandate.missingEvidence.procedure} Deadline: {date(mandate.missingEvidence.deadline)}. No guaranteed refund.</p>
    <p><b>Disagreements</b> {mandate.ambiguityProcedure}</p>
  </div>
}
export function FundingComposer({ vault, draft, onStream }: {
  vault: OptionsVault; draft: StreamDraft;
  onStream?: (vaultId: string, side: 'yes' | 'no', rate: number) => void | Promise<unknown>
}) {
  const inputId = useId()
  const options = useOptionsContext()
  const live = options.enabled
  const rules = useFundingRules(vault.vaultId, live)
  const wallet = useWalletActions()
  const view = useVaultView(vault.vaultId)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const op = options.fundingOperation
  const ownOp = op?.vaultId === vault.vaultId ? op : null
  const pending = !!op && !['confirmed', 'failed'].includes(op.status)
  const frozen = busy || (live && (options.claiming || pending))
  const continuing = ownOp?.status === 'continue'
  const side = continuing ? ownOp.side : draft.side
  const rate = continuing ? ownOp.rate : draft.rate
  const nft = options.board?.panel.nfts.find(n => n.marketId === vault.marketId)
  const balance = nft?.account.balanceUSDC ?? 0
  const deposit = balance > 0 || rate <= 0 ? 0 : Number(perMinUSDCToRate(Math.max(0, Number.isFinite(rate) && rate <= 10 ? rate : 0)) * 600n) / 1_000_000
  const insufficient = live && options.isConnected && wallet.usdcBalance < deposit
  const blocked = live && (!!options.board?.dataError || rules.loading || !!rules.error || rules.closed || !rules.verified)
  const needsPosition = live && !options.hasNftForVault(vault.vaultId)
  const canSubmit = live && !!side && Number.isFinite(rate) && rate >= 0.01 && rate <= 10 && !busy && !blocked && !insufficient && (!pending || continuing) && !options.claiming
  const pauseReady = live && !!view.userPosition && view.userPosition.rate > 0 && !frozen
  const choose = (next: 'yes' | 'no') => { draft.setSide(next); if (draft.rate < 0.01) draft.setRate(1) }
  const submit = async () => {
    if (!side || !canSubmit) return
    if (live && !options.isConnected) { window.dispatchEvent(new Event('livestreak:connect-wallet')); return }
    setError(null); setBusy(true)
    try {
      if (onStream) await onStream(vault.vaultId, side, rate)
      else if (live) await options.fundStream(vault.vaultId, side, rate)
      draft.clear()
    } catch (err) { setError(err instanceof Error ? err.message : 'Funding could not be completed.') }
    finally { setBusy(false) }
  }
  const recover = async () => {
    setError(null); setBusy(true)
    try { await options.recoverFunding() } catch (err) { setError(err instanceof Error ? err.message : 'Confirmation is temporarily unavailable. Try checking again.') }
    finally { setBusy(false) }
  }
  return <section className="funding-composer" data-testid={`funding-composer-${vault.vaultId}`} aria-label="Fund this question">
    {live ? <details className="funding-rules" key={rules.verified?.terms.commitment ?? 'loading'}>
      <summary><ShieldCheck size={17} aria-hidden />
        {rules.loading ? 'Checking the committed rules…' : rules.error ? 'Rules unavailable · funding disabled' : rules.closed ? 'Funding closed · view rules' : 'Verified rules · view before funding'}
      </summary>
      {rules.verified && <><Rules mandate={rules.verified.mandate} /><p className="funding-digest mono">Commitment {rules.verified.terms.commitment}</p></>}
      {rules.error && <p>{rules.error} <button className="funding-text-button" onClick={rules.reload}>Check again</button></p>}
    </details> : <p className="funding-caption">Funding unavailable · options runtime is disabled</p>}
    {rules.error && live && <p className="funding-caption" role="status">We can’t verify the question’s rules yet. <button className="funding-text-button" onClick={rules.reload}>Retry</button></p>}
    <div className="funding-sides" role="group" aria-label="Choose a side">
      {(['yes', 'no'] as const).map(s => <button key={s} type="button" className={`funding-side funding-side-${s}`} aria-pressed={side === s}
        data-testid={`fund-side-${s}-${vault.vaultId}`} disabled={frozen} onClick={() => choose(s)}>
        <span>{s.toUpperCase()}</span><span>{rules.verified ? rules.verified.mandate[s === 'yes' ? 'yesMeaning' : 'noMeaning'] : `Stream on ${s.toUpperCase()}`}</span>
      </button>)}
    </div>
    <div className="funding-rate-row">
      <label htmlFor={inputId}>Stream rate <span>USDC / min</span></label>
      <input id={inputId} type="number" inputMode="decimal" min={0.01} max={10} step={0.1}
        aria-describedby={`${inputId}-help`} data-testid={`fund-amount-input-${vault.vaultId}`} aria-label="Stream rate in USDC per minute" value={rate ? Number(rate.toFixed(4)) : ''} placeholder="1.00"
        disabled={frozen} onChange={e => draft.setRate(e.target.value === '' ? 0 : Number(e.target.value))} />
    </div>
    <p className="funding-caption" id={`${inputId}-help`}>Choose 0.01–10 USDC per minute.</p>
    <div className="funding-presets" role="group" aria-label="Choose a stream rate">
      {[0.1, 0.5, 1, 5].map(r => <button key={r} aria-pressed={Math.abs(rate - r) < 0.00005} disabled={frozen} onClick={() => draft.setRate(r)}>{r} / min</button>)}
    </div>
    <div className="funding-quote">
      <div><span>{deposit > 0 ? 'Initial stream budget' : 'Using your shared budget'}</span><strong className="mono">{deposit > 0 ? `${new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(deposit)} USDC` : formatUSDCFull(balance)}</strong></div>
      <p>{deposit > 0 ? 'Up to 10 minutes at this rate. Unspent funds stay in your position.' : 'This balance supports all your active streams.'} Funding stops at the committed deadline.</p>
      {live && options.isConnected && <div className="funding-wallet-balance"><span>Wallet balance</span><span className="mono">{formatUSDCFull(wallet.usdcBalance)} USDC</span></div>}
    </div>
    {insufficient && <div className="funding-notice" role="status">Add USDC to start this stream. {wallet.canTopUp ? <button className="funding-text-button" disabled={wallet.isToppingUp || frozen} onClick={async () => {
      setError(null); try { await wallet.topUp(100) } catch (err) { setError(err instanceof Error ? err.message : 'Test funding is unavailable.') }
    }}>{wallet.isToppingUp ? 'Adding test funds…' : 'Mint 100 test USDC'}</button> : 'Send USDC to your connected wallet.'}
      {wallet.canTopUp && <small>Arbitrum Sepolia · test funds only</small>}</div>}
    {ownOp && <div className={`funding-progress funding-progress-${ownOp.status}`} role="status" aria-live="polite">
      {ownOp.status === 'confirmed' ? <CheckCircle size={18} /> : ownOp.status === 'working' ? <SpinnerGap className="funding-spinner" size={18} /> : null}
      <div><strong>{ownOp.status === 'confirmed' ? `${ownOp.side.toUpperCase()} position confirmed` : ownOp.status === 'unknown' ? 'Confirmation needed' : ownOp.status === 'continue' ? 'Ready to continue' : ownOp.status === 'failed' ? 'Transaction not completed' : ownOp.phase === 'mint' ? 'Creating your position…' : ownOp.phase === 'verify' ? 'Loading your on-chain position…' : ownOp.receiptStep === 'approve' ? 'Approving USDC…' : 'Funding your stream…'}</strong>
        <p>{ownOp.message ?? (ownOp.status === 'confirmed' ? 'Saved on-chain. You can reload and keep watching.' : 'Keep watching. We’ll confirm here.')}</p>
        {ownOp.txId && <span className="funding-tx mono" title={ownOp.txId}>Transaction {ownOp.txId.slice(0, 10)}…{ownOp.txId.slice(-6)}</span>}
      </div>
    </div>}
    {pending && op?.vaultId !== vault.vaultId && <p className="funding-notice">Finish your pending funding before starting another question. <a href={`/stream/${encodeURIComponent(op.marketId)}`}>Open pending market</a></p>}
    {ownOp?.status === 'unknown' ? <button className="funding-submit" disabled={busy || options.claiming} onClick={recover}>{busy ? 'Checking confirmation…' : 'Check transaction status'}</button> :
      <button className="funding-submit" data-side={side ?? ''} data-testid={`fund-submit-${vault.vaultId}`} disabled={!canSubmit} onClick={submit}>
        {busy || ownOp?.status === 'working' ? <><SpinnerGap className="funding-spinner" size={17} /> {needsPosition ? 'Creating your position…' : 'Confirming your stream…'}</> :
          !live ? 'Funding unavailable' : !options.isConnected ? 'Connect to fund' : continuing ? 'Continue funding' : rules.closed ? 'Funding closed' : !side ? 'Choose YES or NO' : `${needsPosition ? 'Create position & stream' : 'Stream'} ${side.toUpperCase()}`}<ArrowRight size={16} aria-hidden />
      </button>}
    {error && <p className="funding-error" role="alert">{error}</p>}
    {view.userPosition && <div className="funding-position"><span>Your {view.userPosition.side.toUpperCase()} position</span><strong className="mono">{formatRate(view.userPosition.rate)} · {formatShares(view.userPosition.shares)} shares</strong>
      {pauseReady && <button className="funding-text-button" onClick={async () => { setError(null); setBusy(true); try { await options.stopFunding(vault.vaultId, view.userPosition!.side); draft.clear() } catch (err) { setError(err instanceof Error ? err.message : 'Could not pause stream.') } finally { setBusy(false) } }}>Pause stream</button>}
    </div>}
  </section>
}
