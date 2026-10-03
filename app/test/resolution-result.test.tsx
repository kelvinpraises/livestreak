// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { OptionsVault } from '@livestreak/options'
const mocks = vi.hoisted(() => ({
  options: {
    isConnected: true,
    claiming: false,
    claimOperation: null as unknown,
    board: {
      panel: {
        nfts: [
          {
            lanes: [
              {
                vaultId: 'v',
                settlement: {
                  claimableUSDC: 2.5,
                  overstreamClaimableUSDC: 0,
                  canClaimLoss: false,
                  collectPending: false,
                },
              },
            ],
          },
        ],
      },
    },
    readFundingRules: vi.fn(async () => ({
      verified: { terms: { chainId: 'eip155:31337', commitment: 'digest' } },
    })),
    settleVault: vi.fn(async () => {}),
    recoverClaim: vi.fn(async () => {}),
  },
  list: vi.fn(async () => []),
  read: vi.fn(),
}))
vi.mock('../src/providers/options-provider', () => ({
  useOptionsContext: () => mocks.options,
}))
vi.mock('@livestreak/host', () => ({
  createResolutionClient: () => ({ list: mocks.list, read: mocks.read }),
}))
import { ResolutionResult } from '../src/components/molecules/resolution-result'
const vault = {
  vaultId: 'v',
  marketId: 'm',
  outcome: 'yes',
  status: 'resolved',
} as OptionsVault
beforeEach(() => {
  vi.clearAllMocks()
  mocks.options.claimOperation = null
  mocks.options.claiming = false
})
afterEach(cleanup)
it('shows real outcome and leaves legitimate claims available without a Host receipt', async () => {
  render(<ResolutionResult vault={vault} />)
  await screen.findByText('No matching evidence record is available.')
  expect(screen.getByText('Resolved YES')).toBeTruthy()
  expect(screen.getByText(/2\.500000 USDC claimable/)).toBeTruthy()
  fireEvent.click(screen.getByText('Cash out position'))
  expect(mocks.options.settleVault).toHaveBeenCalledWith('v')
})
it('keeps rejected claim errors inline and never claims success', async () => {
  mocks.options.settleVault.mockRejectedValueOnce(Error('RPC failed'))
  render(<ResolutionResult vault={vault} />)
  fireEvent.click(screen.getByText('Cash out position'))
  expect((await screen.findByRole('alert')).textContent).toContain('RPC failed')
  expect(screen.queryByText('Cash-out confirmed on-chain.')).toBeNull()
})
it('exposes recovery instead of another submission for an unknown claim', async () => {
  mocks.options.claimOperation = {
    vaultId: 'v',
    status: 'unknown',
    txId: 'known',
    receipts: [],
  }
  render(<ResolutionResult vault={vault} />)
  fireEvent.click(screen.getByText('Check claim confirmation'))
  expect(mocks.options.recoverClaim).toHaveBeenCalledTimes(1)
  expect(mocks.options.settleVault).not.toHaveBeenCalled()
})
it('disputed result blocks money action and shows the reason', async () => {
  render(<ResolutionResult vault={{ ...vault, status: 'disputed' }} />)
  expect((screen.getByText('Cash out position') as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByText('Claims are paused while this result is disputed.')).toBeTruthy()
})
it('does not offer another loss claim merely because the shared vault has a pending winner collect', () => {
  const lane = mocks.options.board.panel.nfts[0].lanes[0]
  const original = lane.settlement
  lane.settlement = {
    claimableUSDC: 0,
    overstreamClaimableUSDC: 0,
    canClaimLoss: false,
    collectPending: true,
  }
  render(<ResolutionResult vault={vault} />)
  expect((screen.getByText('Nothing to claim') as HTMLButtonElement).disabled).toBe(true)
  lane.settlement = original
})
