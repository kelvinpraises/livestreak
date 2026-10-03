// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { OptionsVault } from '@livestreak/options'
vi.mock('../src/hooks/use-fixture-mode', () => ({ usePreferFixture: () => false }))
vi.mock('../src/hooks/use-board-ui-state', () => ({
  useStreamTab: () => ['vaults', vi.fn()],
}))
vi.mock('../src/providers/options-provider', () => ({
  useOptionsContext: () => ({
    enabled: true,
    board: {},
    isLoading: false,
    isConnected: false,
  }),
}))
vi.mock('../src/components/molecules/vault-card', () => ({
  VaultCard: ({ vault }: { vault: OptionsVault }) => (
    <article>
      {vault.question}: {vault.status}
    </article>
  ),
}))
vi.mock('../src/components/organisms/focused-vault', () => ({ FocusedVault: () => null }))
vi.mock('../src/components/organisms/activity-feed', () => ({ ActivityFeed: () => null }))
vi.mock('../src/components/organisms/my-positions', () => ({ MyPositions: () => null }))
vi.mock('../src/components/organisms/nft-panel', () => ({ NftPanel: () => null }))
import { VaultList } from '../src/components/organisms/vault-list'
afterEach(cleanup)
it('keeps settled questions discoverable to a viewer with no positions', () => {
  render(
    <VaultList
      vaults={[
        {
          vaultId: 'settled',
          question: 'Closed question',
          status: 'resolved',
        } as OptionsVault,
        { vaultId: 'open', question: 'Live question', status: 'open' } as OptionsVault,
      ]}
      events={[]}
      positions={[]}
      selectedVaultId={null}
      streamId="market"
      onDismissVault={() => {}}
    />,
  )
  expect(screen.getByText('Closed question: resolved')).toBeTruthy()
  expect(screen.getAllByRole('article').map((n) => n.textContent)).toEqual([
    'Live question: open',
    'Closed question: resolved',
  ])
})
