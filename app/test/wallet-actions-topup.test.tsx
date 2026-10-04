// @vitest-environment jsdom
vi.mock('../src/utils/deployments', () => ({ EVM_TEST_USDC: '0x1234567890123456789012345678901234567890' }))
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const state=vi.hoisted(()=>({chain:'evm',isConnected:true,mint:vi.fn()}))
vi.mock('../src/providers/options-provider', () => ({
  useOptionsContext: () => ({ address: '0x0000000000000000000000000000000000000001', chain: state.chain, usdcBalance: 0, isConnected: state.isConnected, mintTestUsdc:state.mint }),
}))
import { useWalletActions } from '../src/hooks/use-wallet-actions'
beforeEach(()=>{state.chain='evm';state.isConnected=true;state.mint.mockReset()})
afterEach(cleanup)
describe('direct USDC token mint', () => {
  it('uses the wallet mint action and exposes real rejection without faking a balance', async () => {
    state.mint.mockRejectedValue(new Error('Contract mint reverted'))
    const {result}=renderHook(()=>useWalletActions())
    expect(result.current.canTopUp).toBe(true)
    await act(async()=>{await expect(result.current.topUp(100)).rejects.toThrow('Contract mint reverted')})
    expect(state.mint).toHaveBeenCalledWith(100)
    expect(result.current.usdcBalance).toBe(0)
    expect(result.current.isToppingUp).toBe(false)
  })
  it('does not offer the EVM mint on other chains or disconnected wallets', () => {
    state.chain='solana'
    const {result,rerender}=renderHook(()=>useWalletActions())
    expect(result.current.canTopUp).toBe(false)
    state.chain='evm';state.isConnected=false;rerender()
    expect(result.current.canTopUp).toBe(false)
  })
})
