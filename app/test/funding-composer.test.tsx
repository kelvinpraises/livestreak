// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import type { OptionsVault } from '@livestreak/options'
const mocks = vi.hoisted(() => ({
  options: { enabled: true, isConnected: true, claiming: false, fundingOperation: null as unknown, board: { panel: { nfts: [] } }, hasNftForVault: () => false, recoverFunding: vi.fn(async () => {}), fundStream: vi.fn(async () => {} ) },
  rules: { loading: false, closed: false, error: undefined as string | undefined, verified: { terms: { commitment: '0xcommitment' }, mandate: {
    yesMeaning: 'Movement visible', noMeaning: 'No movement', evaluation: { kind: 'rubric', rubric: 'Compare frames' }, method: 'discretionary', evidence: [], fundingClose: 9999999999, decisionStart: 9999999999, decisionEnd: 9999999999, missingEvidence: { procedure: 'Escalate', deadline: 9999999999 }, ambiguityProcedure: 'Escalate' } }, reload: vi.fn() },
  wallet: { usdcBalance: 100, canTopUp: true, isToppingUp: false, topUp: vi.fn(async () => {}) }, fixture: false,
}))
vi.mock('../src/providers/options-provider', () => ({ useOptionsContext: () => mocks.options }))
vi.mock('../src/hooks/use-fixture-mode', () => ({ usePreferFixture: () => mocks.fixture }))
vi.mock('../src/hooks/use-funding-rules', () => ({ useFundingRules: () => mocks.rules }))
vi.mock('../src/hooks/use-wallet-actions', () => ({ useWalletActions: () => mocks.wallet }))
vi.mock('../src/hooks/use-vault-views', () => ({ useVaultView: () => ({}) }))
vi.mock('@livestreak/options', () => ({ perMinUSDCToRate: (rate: number) => BigInt(Math.max(1, Math.round(rate * 1_000_000 / 60))) }))
import { FundingComposer } from '../src/components/molecules/funding-composer'
const vault = { vaultId: 'v', marketId: 'm' } as OptionsVault
function Form({ onStream = mocks.options.fundStream }: { onStream?: (...args: unknown[]) => Promise<unknown> }) {
  const [side, setSide] = useState<'yes' | 'no' | null>(null)
  const [rate, setRate] = useState(0)
  return <FundingComposer vault={vault} draft={{ side, rate, editing: false, change: () => {}, setSide, setRate, clear: () => { setSide(null); setRate(0) } }} onStream={onStream} />
}
beforeEach(() => { mocks.options.fundingOperation = null; mocks.options.isConnected = true; mocks.options.claiming = false; mocks.rules.error = undefined; mocks.rules.closed = false; mocks.wallet.usdcBalance = 100; mocks.fixture = false; vi.clearAllMocks() })
afterEach(cleanup)
const choose = () => fireEvent.click(screen.getByTestId('fund-side-yes-v'))
const submit = () => screen.getByTestId('fund-submit-v') as HTMLButtonElement
it('shows the committed meanings, initial cost and one inline action for a new viewer', () => {
  render(<Form />); choose()
  expect(screen.getByTestId('fund-side-yes-v').textContent).toContain('Movement visible')
  expect(screen.getByText('Initial stream budget')).toBeTruthy()
  expect(screen.getByText('10.0002 USDC')).toBeTruthy()
  expect(screen.getByText('Create position & stream YES')).toBeTruthy()
  expect(submit().disabled).toBe(false)
})
it('keeps the side and rate when submission fails', async () => {
  const fail = vi.fn(async () => { throw Error('RPC unavailable') })
  render(<Form onStream={fail} />); choose(); fireEvent.click(submit())
  await screen.findByRole('alert')
  expect(screen.getByRole('alert').textContent).toContain('RPC unavailable')
  expect((screen.getByLabelText('Stream rate in USDC per minute') as HTMLInputElement).value).toBe('1')
  expect(screen.getByTestId('fund-side-yes-v').getAttribute('aria-pressed')).toBe('true')
})
it.each(['missing', 'closed'])('blocks %s rules before submission', reason => {
  if (reason === 'missing') mocks.rules.error = 'Missing commitment'
  else mocks.rules.closed = true
  render(<Form />); choose(); expect(submit().disabled).toBe(true)
  fireEvent.click(submit()); expect(mocks.options.fundStream).not.toHaveBeenCalled()
})
it('offers a clearly labelled development faucet before the first position exists', async () => {
  mocks.wallet.usdcBalance = 0
  render(<Form />); choose(); expect(submit().disabled).toBe(true)
  fireEvent.click(screen.getByText('Add 100 test USDC'))
  await waitFor(() => expect(mocks.wallet.topUp).toHaveBeenCalledWith(100))
  expect(screen.getByText('Local development faucet · test funds only')).toBeTruthy()
})
it('opens the canonical wallet dialog instead of pretending a disconnected bet worked', () => {
  mocks.options.isConnected = false
  const open = vi.fn(); window.addEventListener('livestreak:connect-wallet', open)
  render(<Form />); choose(); fireEvent.click(submit())
  expect(open).toHaveBeenCalledTimes(1); expect(mocks.options.fundStream).not.toHaveBeenCalled()
  window.removeEventListener('livestreak:connect-wallet', open)
})
it('reconciles an unknown transaction and keeps the submission control out of reach', async () => {
  mocks.options.fundingOperation = { vaultId: 'v', marketId: 'm', side: 'yes', rate: 1, status: 'unknown', phase: 'fund', txId: '0xhash' }
  render(<Form />)
  expect(screen.queryByTestId('fund-submit-v')).toBeNull()
  fireEvent.click(screen.getByText('Check transaction status'))
  await waitFor(() => expect(mocks.options.recoverFunding).toHaveBeenCalledTimes(1))
  expect(mocks.options.fundStream).not.toHaveBeenCalled()
})
it('prevents a rate outside the supported range from producing a submit', () => {
  render(<Form />); choose()
  fireEvent.change(screen.getByLabelText('Stream rate in USDC per minute'), {target:{value:'100'}})
  expect(submit().disabled).toBe(true)
  fireEvent.click(submit()); expect(mocks.options.fundStream).not.toHaveBeenCalled()
})
