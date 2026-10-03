import { useEffect, useState } from 'react'
import { createResolutionClient } from '@livestreak/host'
import type { OptionsVault } from '@livestreak/options'
import type { ResolutionRecord } from '@livestreak/schema'
import { useOptionsContext } from '#/providers/options-provider'
import { HOST_BASE_URL } from '#/utils/env'

export function ResolutionResult({ vault }: { vault: OptionsVault }) {
  const options = useOptionsContext()
  const [records, setRecords] = useState<ResolutionRecord[]>([])
  const [receiptError, setReceiptError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    setError(null)
  }, [options.address, options.chain, vault.vaultId])
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setReceiptError(null)
    setRecords([])
    void (async () => {
      const { verified } = await options.readFundingRules(vault.vaultId)
      const client = createResolutionClient(HOST_BASE_URL)
      const digests = await client.list(verified.terms.chainId, vault.vaultId)
      const results = await Promise.allSettled(digests.map((d) => client.read(d)))
      if (cancelled) return
      const valid = results.flatMap((r) =>
        r.status === 'fulfilled' &&
        r.value.mandateCommitment === verified.terms.commitment &&
        r.value.marketId === vault.marketId &&
        r.value.chainId === verified.terms.chainId &&
        r.value.vaultId === vault.vaultId
          ? [r.value]
          : [],
      )
      setRecords(valid)
      if (results.some((r) => r.status === 'rejected'))
        setReceiptError('Some evidence records could not be verified.')
    })()
      .catch((e) => {
        if (!cancelled)
          setReceiptError(e instanceof Error ? e.message : 'Evidence unavailable.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [options.readFundingRules, vault.vaultId, vault.marketId, revision])
  const lanes =
    options.board?.panel.nfts.flatMap((n) =>
      n.lanes.filter((l) => l.vaultId === vault.vaultId),
    ) ?? []
  const settlement = lanes.flatMap((l) => (l.settlement ? [l.settlement] : []))
  const usdc = settlement.reduce(
    (sum, s) => sum + (s.claimableUSDC ?? 0) + (s.overstreamClaimableUSDC ?? 0),
    0,
  )
  const hasClaim = settlement.some(
    (s) =>
      (s.claimableUSDC ?? 0) > 0 ||
      (s.overstreamClaimableUSDC ?? 0) > 0 ||
      s.canClaimLoss === true ||
      s.canClaimWin === true,
  )
  const op =
    options.claimOperation?.vaultId === vault.vaultId ? options.claimOperation : null
  const pending = op && ['working', 'unknown'].includes(op.status)
  const run = async (recover = false) => {
    if (busy) return
    setBusy(true)
    setChecking(recover)
    setError(null)
    try {
      if (recover) await options.recoverClaim()
      else await options.settleVault(vault.vaultId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cash-out could not complete.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      className="resolution-result"
      aria-label="Question result"
      data-testid={`resolution-${vault.vaultId}`}
    >
      <strong>
        {vault.status === 'disputed'
          ? 'Result disputed'
          : vault.outcome === 'pending'
            ? 'Awaiting Steward decision'
            : `Resolved ${vault.outcome.toUpperCase()}`}
      </strong>
      <p>
        {vault.status === 'disputed'
          ? 'Claims are paused while this result is disputed.'
          : 'The chain confirms the outcome. Evidence records explain submitted assessments; their content hashes do not authenticate the author or prove the evidence true.'}
      </p>
      <details>
        <summary>Evidence and reasoning</summary>
        {loading ? (
          <p>Loading evidence records…</p>
        ) : records.length === 0 ? (
          <p>No matching evidence record is available.</p>
        ) : (
          records.map((record, i) => (
            <article key={i}>
              <strong>
                {record.outcome === 'pending'
                  ? 'Needs attention'
                  : `Assessment: ${record.outcome.toUpperCase()}`}
              </strong>
              <p>{record.reason}</p>
              {record.transactionId && (
                <p>
                  Submission reference: <code>{record.transactionId}</code>
                </p>
              )}
              <p>
                Reported Steward: <code>{record.stewardId}</code> ·{' '}
                {new Date(record.decisionTime * 1000).toLocaleString()}
              </p>
              {record.evidence.map((e, j) => (
                <details key={j}>
                  <summary>
                    {e.sourceId} · {e.kind}
                  </summary>
                  <p>Origin: {e.reference}</p>
                  <p>
                    Observed {new Date(e.observedAt * 1000).toLocaleString()} · retrieved{' '}
                    {new Date(e.retrievedAt * 1000).toLocaleString()}
                  </p>
                  <pre>{e.payload}</pre>
                  <code>{e.digest}</code>
                </details>
              ))}
            </article>
          ))
        )}
        {receiptError && <p role="alert">{receiptError}</p>}
        <button type="button" onClick={() => setRevision((n) => n + 1)} disabled={loading}>
          Refresh evidence
        </button>
      </details>
      {options.isConnected && lanes.length > 0 && (
        <div>
          <p>
            {usdc > 0
              ? `${usdc.toFixed(6)} USDC claimable`
              : 'Your position is recorded on-chain.'}{' '}
            Losing positions follow the protocol’s LVST treatment.
          </p>
          {op?.step && op.status !== 'confirmed' && (
            <p role="status">
              {op.status === 'continue'
                ? 'Remaining cash-out ready'
                : op.status === 'unknown' && (!busy || checking)
                  ? 'Confirmation needed'
                  : op.step.action === 'claimLossLvst'
                    ? 'Claiming loss entitlement'
                    : op.step.action === 'withdraw'
                      ? 'Withdrawing USDC'
                      : 'Stopping this question’s stream'}
            </p>
          )}
          {op?.status === 'confirmed' && <p role="status">Cash-out confirmed on-chain.</p>}
          {op?.message && <p role="status">{op.message}</p>}
          {op?.txId && (
            <p>
              Transaction: <code>{op.txId}</code>
            </p>
          )}
          {pending ? (
            <button
              type="button"
              onClick={() => void run(true)}
              disabled={busy || options.claiming}
            >
              {busy
                ? checking
                  ? 'Checking confirmation…'
                  : 'Cash-out in progress…'
                : 'Check claim confirmation'}
            </button>
          ) : (
            <button
              type="button"
              data-testid={`claim-${vault.vaultId}`}
              onClick={() => void run()}
              disabled={
                busy ||
                options.claiming ||
                vault.status !== 'resolved' ||
                (!hasClaim && op?.status !== 'continue')
              }
            >
              {busy
                ? 'Cash-out in progress…'
                : op?.status === 'continue'
                  ? 'Continue cash-out'
                  : hasClaim
                    ? 'Cash out position'
                    : 'Nothing to claim'}
            </button>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </section>
  )
}
