import { type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useStreamTab } from '#/hooks/use-board-ui-state'
import { FocusedVault } from '#/components/organisms/focused-vault'
import { VaultCard } from '#/components/molecules/vault-card'
import { ActivityFeed } from '#/components/organisms/activity-feed'
import { MyPositions } from '#/components/organisms/my-positions'
import { NftPanel } from '#/components/organisms/nft-panel'
import { useOptionsContext } from '#/providers/options-provider'
import { OptionsActionButton } from '#/components/atoms/options-action-button'
import { isOptionsModeEnabled } from '#/utils/env'
import type { WSEvent, Position } from '#/types/ui'
import type { OptionsVault } from '@livestreak/options'

interface Props {
  vaults: OptionsVault[]
  events: WSEvent[]
  positions: Position[]
  selectedVaultId: string | null
  streamId: string
  onDismissVault: () => void
  onStream?: (
    vaultId: string,
    side: 'yes' | 'no',
    rate: number,
    durationMinutes?: number,
  ) => void | Promise<unknown>
}

export function VaultList({
  vaults,
  events,
  positions,
  selectedVaultId,
  streamId,
  onDismissVault,
  onStream,
}: Props) {
  // A1/S5: tab persists across the board's periodic refresh (was local useState → reset to STREAMS).
  const [tab, setTab] = useStreamTab(streamId, 'vaults')
  const selectedVault = selectedVaultId
    ? vaults.find((v) => v.vaultId === selectedVaultId)
    : null

  const options = useOptionsContext()
  const loading = options.enabled && !options.error && (!options.board || options.isLoading)
  const mintFn =
    isOptionsModeEnabled() && options.isConnected
      ? options.findFunction('mint', (fn) => fn.target?.kind === 'market')
      : undefined

  // Keep results discoverable after settlement, including for viewers without a position.
  const listedVaults = [...vaults].sort(
    (a, b) => Number(a.status === 'resolved') - Number(b.status === 'resolved'),
  )

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {options.error && <p role="alert" style={{ color: '#ffd553', padding: 12 }}>Market/account data could not be refreshed. Values may be stale.</p>}
      {/* Focused vault from NikoNiko click */}
      <AnimatePresence>
        {selectedVault && (
          <FocusedVault
            key={selectedVault.vaultId}
            vault={selectedVault}
            onDismiss={onDismissVault}
            onStream={onStream}
            onGoToMint={() => setTab('mine')}
          />
        )}
      </AnimatePresence>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          padding: '0 16px',
          flexShrink: 0,
          gap: 4,
        }}
      >
        <TabBtn
          active={tab === 'mine'}
          onClick={() => setTab('mine')}
          count={positions.filter((p) => !p.resolved).length}
        >
          STREAMS
        </TabBtn>
        <TabBtn
          active={tab === 'vaults'}
          onClick={() => setTab('vaults')}
          count={listedVaults.length}
        >
          VAULTS
        </TabBtn>
        <TabBtn active={tab === 'feed'} onClick={() => setTab('feed')}>
          LIVE FEED
        </TabBtn>
      </div>

      {/* Tab content — S6: every panel stays MOUNTED and is toggled by visibility. Switching tabs is
          instant (no unmount/remount), so the VAULTS panel never flashes a ~1.5s blank while its cards
          re-mount and replay their entry animations. */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
        <TabPanel active={tab === 'mine'}>
          {mintFn && !mintFn.disabled && mintFn.target?.marketId && (
            <div style={{ padding: '14px 10px' }}>
              <p
                style={{
                  fontSize: 12,
                  color: 'rgba(255,255,255,0.45)',
                  margin: '0 0 10px',
                }}
              >
                Enter this market to open positions — mints your position NFT (your account
                for this market).
              </p>
              <OptionsActionButton
                label="Enter market — mint position NFT"
                fn={mintFn}
                onAction={() => options.mint(mintFn.target!.marketId!)}
                variant="green"
              />
            </div>
          )}
          <NftPanel />
          <MyPositions positions={positions} vaults={vaults} />
        </TabPanel>
        <TabPanel active={tab === 'vaults'}>
          {listedVaults.length > 0 ? (
            <div style={{ padding: '14px 10px 4px' }}>
              {listedVaults.map((v, i) => (
                <VaultCard
                  key={v.vaultId}
                  vault={v}
                  fundingFocused={selectedVaultId === v.vaultId}
                  index={i}
                  onStream={onStream}
                  onGoToMint={() => setTab('mine')}
                />
              ))}
            </div>
          ) : (
            <div
              style={{
                padding: '40px 20px',
                textAlign: 'center',
                color: 'rgba(255,255,255,0.3)',
                fontSize: 12,
              }}
            >
              {loading ? 'Loading market questions…' : 'No questions in this market yet.'}
            </div>
          )}
        </TabPanel>
        <TabPanel active={tab === 'feed'} overflow="hidden">
          <ActivityFeed events={events} />
        </TabPanel>
      </div>
    </div>
  )
}

function TabPanel({
  active,
  overflow = 'auto',
  children,
}: {
  active: boolean
  overflow?: 'auto' | 'hidden'
  children: ReactNode
}) {
  return (
    <div
      aria-hidden={!active}
      style={{
        position: 'absolute',
        inset: 0,
        overflowY: overflow === 'auto' ? 'auto' : 'hidden',
        overflowX: 'hidden',
        opacity: active ? 1 : 0,
        transform: active ? 'translateX(0px)' : 'translateX(8px)',
        pointerEvents: active ? 'auto' : 'none',
        visibility: active ? 'visible' : 'hidden',
        transition: 'opacity 0.15s ease, transform 0.15s ease',
      }}
    >
      {children}
    </div>
  )
}

function TabBtn({
  active,
  onClick,
  children,
  count,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  count?: number
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '10px 12px 11px',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.1em',
        fontFamily: 'var(--font-mono)',
        color: active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.3)',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        transition: 'color 0.15s cubic-bezier(0.23, 1, 0.32, 1)',
      }}
    >
      {children}
      {count !== undefined && count > 0 && (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: active ? '#00ff87' : 'rgba(255,255,255,0.1)',
            color: active ? '#000' : 'rgba(255,255,255,0.5)',
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          {count}
        </span>
      )}
      {active && (
        <motion.div
          layoutId="vault-tab-indicator"
          style={{
            position: 'absolute',
            bottom: -1,
            left: 0,
            right: 0,
            height: 2,
            background: 'var(--color-green)',
            borderRadius: 1,
            boxShadow: '0 0 8px var(--color-green-glow)',
          }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        />
      )}
    </button>
  )
}
