import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { isAddress } from 'viem'
import type { OptionsFunctionView, OptionsNftPanel } from '@livestreak/options'

import { isOptionsModeEnabled } from '#/utils/env'
import { isValidRecipientAddress, type OptionsChainKind } from '#/utils/chain'
import { useOptionsContext } from '#/providers/options-provider'
import { OptionsActionButton } from '#/components/atoms/options-action-button'
import { formatUSDC, formatRunway } from '#/utils/format'

// UI-only input gating (amount/address format); protocol gating comes from the real SDK descriptors.
function invalidFn(reason: string): OptionsFunctionView {
  return { name: '', scope: '', label: '', disabled: true, disabledReason: reason }
}

export function NftPanel() {
  const optionsEnabled = isOptionsModeEnabled()
  const options = useOptionsContext()

  if (!optionsEnabled || !options.isConnected || !options.board) return null

  const isSui = options.chain === 'sui'
  const nfts = options.board.panel.nfts
  const approveAllFn = options.findFunction('setApprovalForAll', fn => fn.target?.kind === 'global')

  return (
    <div style={{ padding: '14px 10px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.25)', padding: '0 4px 10px' }}>
        POSITION NFTS
      </div>

      {!isSui && <ApproveAllRow fn={approveAllFn} onApproveAll={options.setApprovalForAll} />}

      {nfts.length === 0 ? (
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', padding: '0 4px 14px', margin: 0 }}>
          No position NFTs yet.
        </p>
      ) : (
        nfts.map(nft => (
          <NftRow
            key={nft.tokenId}
            nft={nft}
            chain={options.chain}
            addFundsFn={options.findFunction('addFunds', fn =>
              fn.target?.kind === 'nft' && fn.target.tokenId === nft.tokenId)}
            sweepFn={options.findFunction('stopAllFunding', fn =>
              fn.target?.kind === 'nft' && fn.target.tokenId === nft.tokenId)}
            withdrawAllFn={options.findFunction('withdrawMany', fn =>
              fn.target?.kind === 'nft' && fn.target.tokenId === nft.tokenId)}
            transferFn={options.findFunction('transferNft', fn =>
              fn.target?.kind === 'nft' && fn.target.tokenId === nft.tokenId)}
            approveFn={!isSui
              ? options.findFunction('approveNft', fn =>
                fn.target?.kind === 'nft' && fn.target.tokenId === nft.tokenId)
              : undefined}
            onAddFunds={(usd) => options.addFundsNft(nft.tokenId, usd)}
            onSweep={() => options.sweepNft(nft.tokenId)}
            onWithdrawAll={() => options.withdrawAllNft(nft.tokenId)}
            onTransfer={(to) => options.transferNft(nft.tokenId, to)}
            onApprove={(operator) => options.approveNft(nft.tokenId, operator)}
          />
        ))
      )}
    </div>
  )
}

function ApproveAllRow({
  fn,
  onApproveAll,
}: {
  fn?: OptionsFunctionView
  onApproveAll: (operator: string, approved: boolean) => Promise<unknown>
}) {
  const [operator, setOperator] = useState('')
  const valid = isAddress(operator)

  return (
    <div style={{
      background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 10, padding: '10px 12px', margin: '0 2px 10px',
    }}>
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginBottom: 8, letterSpacing: '0.06em' }}>
        APPROVE ALL
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          value={operator}
          onChange={e => setOperator(e.target.value.trim())}
          placeholder="0x operator"
          style={addressInputStyle}
        />
        <OptionsActionButton
          label="Grant"
          fn={valid ? fn : invalidFn('Enter a valid address')}
          onAction={() => onApproveAll(operator, true)}
          variant="ghost"
          compact
        />
        <OptionsActionButton
          label="Revoke"
          fn={valid ? fn : invalidFn('Enter a valid address')}
          onAction={() => onApproveAll(operator, false)}
          variant="ghost"
          compact
        />
      </div>
    </div>
  )
}

function NftRow({
  nft,
  chain,
  addFundsFn,
  sweepFn,
  withdrawAllFn,
  transferFn,
  approveFn,
  onAddFunds,
  onSweep,
  onWithdrawAll,
  onTransfer,
  onApprove,
}: {
  nft: OptionsNftPanel
  chain: OptionsChainKind
  addFundsFn?: OptionsFunctionView
  sweepFn?: OptionsFunctionView
  withdrawAllFn?: OptionsFunctionView
  transferFn?: OptionsFunctionView
  approveFn?: OptionsFunctionView
  onAddFunds: (depositUsd: number) => Promise<unknown>
  onSweep: () => Promise<unknown>
  onWithdrawAll: () => Promise<unknown>
  onTransfer: (to: string) => Promise<unknown>
  onApprove: (operator: string) => Promise<unknown>
}) {
  const [transferTo, setTransferTo] = useState('')
  const [approveOperator, setApproveOperator] = useState('')
  const [addAmount, setAddAmount] = useState('')
  const transferValid = isValidRecipientAddress(chain, transferTo)
  const approveValid = isAddress(approveOperator)
  const showApprove = chain === 'evm' && approveFn !== undefined

  // Balance-first: addFunds is valid with zero active lanes (it parks the deposit as budget). The protocol
  // gate (NFT ownership) rides the SDK descriptor; only the amount-format check is UI-side.
  const addUsd = parseFloat(addAmount)
  const addButtonFn = !(addUsd > 0) ? invalidFn('Enter an amount') : (addFundsFn ?? invalidFn('Unavailable'))

  return (
    <div style={{
      background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: 10, padding: '10px 12px', margin: '0 2px 10px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
        <div>
          <div className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>
            #{nft.tokenId}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
            {nft.marketId} · {nft.laneCount} lane{nft.laneCount === 1 ? '' : 's'}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
          {chain === 'evm' && nft.transfer.approved && (
            <span style={{ fontSize: 9, color: '#00c8ff', fontFamily: 'var(--font-mono)' }}>approved</span>
          )}
          {chain === 'evm' && nft.transfer.isOperator && (
            <span style={{ fontSize: 9, color: '#00ff87', fontFamily: 'var(--font-mono)' }}>operator</span>
          )}
        </div>
      </div>
      <div className="mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginBottom: 10, wordBreak: 'break-all' }}>
        owner {nft.owner}
      </div>

      {/* Shared Drips balance (live-ticking) + runway + realized winnings (EVM only; balance absent on Sui). */}
      {chain === 'evm' && nft.account.balanceUSDC !== undefined && (
        <RunwayReadout account={nft.account} pnl={nft.pnl} />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Balance-first add funds: budget the NFT (and resume/extend any streams) — no active lane needed. */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="number"
            min="0"
            step="1"
            value={addAmount}
            onChange={e => setAddAmount(e.target.value)}
            placeholder="Add to balance (USDC)"
            style={addressInputStyle}
          />
          <OptionsActionButton
            label="Add funds"
            fn={addButtonFn}
            onAction={async () => { await onAddFunds(addUsd); setAddAmount('') }}
            variant="green"
            compact
          />
        </div>

        {/* Get money out: sweep the remaining balance back to the wallet / collect all winnings. EVM only. */}
        {chain === 'evm' && (
          <div style={{ display: 'flex', gap: 6 }}>
            <OptionsActionButton label="Sweep to wallet" fn={sweepFn} onAction={onSweep} variant="ghost" compact />
            <OptionsActionButton label="Withdraw all" fn={withdrawAllFn} onAction={onWithdrawAll} variant="green" compact />
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            value={transferTo}
            onChange={e => setTransferTo(e.target.value.trim())}
            placeholder={chain === 'sui' ? 'Transfer to Sui address…' : 'Transfer to 0x…'}
            style={addressInputStyle}
          />
          <OptionsActionButton
            label="Transfer"
            fn={transferValid ? transferFn : invalidFn('Enter a valid address')}
            onAction={() => onTransfer(transferTo)}
            variant="ghost"
            compact
          />
        </div>
        {showApprove && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            value={approveOperator}
            onChange={e => setApproveOperator(e.target.value.trim())}
            placeholder="Approve operator 0x…"
            style={addressInputStyle}
          />
          <OptionsActionButton
            label="Approve"
            fn={approveValid ? approveFn : invalidFn('Enter a valid address')}
            onAction={() => onApprove(approveOperator)}
            variant="ghost"
            compact
          />
        </div>
        )}
      </div>
    </div>
  )
}

// Balance ticks down between polls (linear to 0 at runway end, re-anchored each poll). The account STATUS is
// canonical from the SDK — streaming / idle (parked, nothing streaming) / depleted / empty — so the readout
// no longer infers it from the Drips maxEnd (which reads "now" for parked and drained alike).
function RunwayReadout({
  account,
  pnl,
}: {
  account: OptionsNftPanel['account']
  pnl: OptionsNftPanel['pnl']
}) {
  // BALANCE is already the SDK's LIVE balance; tick it down between polls at the SDK's canonical drain rate.
  // Thin display smoothing of canonical values — no re-derivation. Re-anchors whenever the poll moves.
  const polledBalance = account.balanceUSDC ?? 0
  const drainRate = account.drainRatePerSecUSDC ?? 0 // USDC/sec; present only while streaming
  const end = account.endsAtMs // present only while streaming
  const streaming = account.status === 'streaming'
  const anchor = useRef({ at: Date.now(), balance: polledBalance })
  if (anchor.current.balance !== polledBalance) {
    anchor.current = { at: Date.now(), balance: polledBalance }
  }

  const [, setTick] = useState(0)
  useEffect(() => {
    if (!streaming) return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [streaming])

  const now = Date.now()
  const liveBalance = streaming
    ? Math.max(0, anchor.current.balance - drainRate * ((now - anchor.current.at) / 1000))
    : anchor.current.balance
  const msLeft = end !== undefined ? Math.max(0, end - now) : undefined
  const returned = pnl.returnedUSDC

  const runwayText = account.status === 'streaming'
    ? (msLeft !== undefined ? formatRunway(msLeft) : '—')
    : account.status === 'idle' ? 'idle'
      : account.status === 'depleted' ? 'depleted'
        : '—'
  const runwayColor = account.status === 'depleted'
    ? '#ff2d78'
    : account.status === 'idle' ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.75)'

  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
      background: 'rgba(0,200,255,0.04)', border: '1px solid rgba(0,200,255,0.1)',
      borderRadius: 8, padding: '7px 10px', marginBottom: 10,
    }}>
      <Stat label="BALANCE" value={formatUSDC(liveBalance)} color="#00c8ff" />
      <Stat label="RUNWAY" value={runwayText} color={runwayColor} align="right" />
      {returned > 0 && <Stat label="WON" value={formatUSDC(returned)} color="#ffd553" align="right" />}
    </div>
  )
}

function Stat({ label, value, color, align = 'left' }: { label: string; value: string; color: string; align?: 'left' | 'right' }) {
  return (
    <div style={{ textAlign: align }}>
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.06em' }}>{label}</div>
      <div className="mono" style={{ fontSize: 13, fontWeight: 600, color }}>{value}</div>
    </div>
  )
}

const addressInputStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  color: '#fff',
  fontSize: 10,
  fontFamily: 'var(--font-mono)',
  padding: '6px 8px',
}
