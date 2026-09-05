import { useState, type CSSProperties } from 'react'
import { isAddress } from 'viem'
import type { OptionsFunctionView, OptionsNftPanel } from '@livestreak/options'

import { isOptionsModeEnabled } from '#/utils/env'
import { isValidRecipientAddress, type OptionsChainKind } from '#/utils/chain'
import { useOptionsContext } from '#/providers/options-provider'
import { OptionsActionButton } from '#/components/atoms/options-action-button'
import { usdcStringToNumber } from '#/utils/options'
import { formatUSDC, formatCountdown } from '#/utils/format'

// The setLanes top-up arg shape (SetLanesInput) is not yet published by options, so the button stays
// gated. Once options surfaces a `setLanes` function descriptor with its inputSchema, this disabled
// placeholder is replaced by the real action.
const SETLANES_GATED_REASON = 'Top-up unavailable — pending options setLanes arg shape'

function invalidAddressFn(): OptionsFunctionView {
  return { name: '', scope: '', label: '', disabled: true, disabledReason: 'Enter a valid address' }
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
            transferFn={options.findFunction('transferNft', fn =>
              fn.target?.kind === 'nft' && fn.target.tokenId === nft.tokenId)}
            approveFn={!isSui
              ? options.findFunction('approveNft', fn =>
                fn.target?.kind === 'nft' && fn.target.tokenId === nft.tokenId)
              : undefined}
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
          fn={valid ? fn : invalidAddressFn()}
          onAction={() => onApproveAll(operator, true)}
          variant="ghost"
          compact
        />
        <OptionsActionButton
          label="Revoke"
          fn={valid ? fn : invalidAddressFn()}
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
  transferFn,
  approveFn,
  onTransfer,
  onApprove,
}: {
  nft: OptionsNftPanel
  chain: OptionsChainKind
  transferFn?: OptionsFunctionView
  approveFn?: OptionsFunctionView
  onTransfer: (to: string) => Promise<unknown>
  onApprove: (operator: string) => Promise<unknown>
}) {
  const [transferTo, setTransferTo] = useState('')
  const [approveOperator, setApproveOperator] = useState('')
  const transferValid = isValidRecipientAddress(chain, transferTo)
  const approveValid = isAddress(approveOperator)
  const showApprove = chain === 'evm' && approveFn !== undefined

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
          {chain === 'evm' && nft.approved && (
            <span style={{ fontSize: 9, color: '#00c8ff', fontFamily: 'var(--font-mono)' }}>approved</span>
          )}
          {chain === 'evm' && nft.isOperator && (
            <span style={{ fontSize: 9, color: '#00ff87', fontFamily: 'var(--font-mono)' }}>operator</span>
          )}
        </div>
      </div>
      <div className="mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', marginBottom: 10, wordBreak: 'break-all' }}>
        owner {nft.owner}
      </div>

      {/* A3: shared Drips balance + runway readout (EVM only; both fields absent on Sui). */}
      {chain === 'evm' && nft.balanceUSDC !== undefined && (
        <RunwayReadout balanceUSDC={nft.balanceUSDC} runwayEndMs={nft.runwayEndMs} />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ flex: 1, fontSize: 9, color: 'rgba(255,255,255,0.3)' }}>Top up lane funding</div>
          <OptionsActionButton
            label="Top up"
            fn={{ name: '', scope: '', label: '', disabled: true, disabledReason: SETLANES_GATED_REASON }}
            onAction={async () => {}}
            variant="ghost"
            compact
          />
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            value={transferTo}
            onChange={e => setTransferTo(e.target.value.trim())}
            placeholder={chain === 'sui' ? 'Transfer to Sui address…' : 'Transfer to 0x…'}
            style={addressInputStyle}
          />
          <OptionsActionButton
            label="Transfer"
            fn={transferValid ? transferFn : invalidAddressFn()}
            onAction={() => onTransfer(transferTo)}
            variant="green"
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
            fn={approveValid ? approveFn : invalidAddressFn()}
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

function RunwayReadout({ balanceUSDC, runwayEndMs }: { balanceUSDC: string; runwayEndMs?: number }) {
  const balance = usdcStringToNumber(balanceUSDC)
  const msLeft = runwayEndMs !== undefined ? Math.max(0, runwayEndMs - Date.now()) : undefined
  const depleted = runwayEndMs !== undefined && msLeft === 0
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
      background: 'rgba(0,200,255,0.04)', border: '1px solid rgba(0,200,255,0.1)',
      borderRadius: 8, padding: '7px 10px', marginBottom: 10,
    }}>
      <div>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.06em' }}>BALANCE</div>
        <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: '#00c8ff' }}>{formatUSDC(balance)}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.06em' }}>RUNWAY</div>
        <div className="mono" style={{ fontSize: 13, fontWeight: 600, color: depleted ? '#ff2d78' : 'rgba(255,255,255,0.75)' }}>
          {msLeft === undefined ? '—' : depleted ? 'depleted' : formatCountdown(msLeft)}
        </div>
      </div>
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
