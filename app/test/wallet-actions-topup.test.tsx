// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../src/providers/options-provider', () => ({
  useOptionsContext: () => ({ address: '0x0000000000000000000000000000000000000001', chain: 'evm', usdcBalance: 0, isConnected: true }),
}))
import { useWalletActions } from '../src/hooks/use-wallet-actions'
describe('retired platform token minting', () => {
  it('offers no mint action and directs callers to Paxos without making network requests', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    try {
      const { result } = renderHook(() => useWalletActions())
      expect(result.current.canTopUp).toBe(false)
      await expect(result.current.topUp()).rejects.toThrow('Paxos testnet faucet')
      expect(fetcher).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })
})
