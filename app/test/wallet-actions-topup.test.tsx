// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import type { OptionsChainKind } from '../src/utils/chain'

// Mutable options-context stub, swapped per test to drive the chain branch.
const ctx = vi.hoisted(() => ({
  value: {
    address: '0x0000000000000000000000000000000000000aBc' as string | null,
    chain: 'evm' as OptionsChainKind,
    usdcBalance: 0,
    isConnected: true,
    refresh: vi.fn(async () => {}),
  },
}))

vi.mock('../src/providers/options-provider', () => ({
  useOptionsContext: () => ctx.value,
}))

// Local EVM dev stack: loopback RPC + a deployed mock USDC so canTopUpEvm can be true.
vi.mock('../src/utils/deployments', () => ({
  LOCALHOST_RPC_URL: 'http://127.0.0.1:8545',
  LOCALHOST_MOCK_USDC: '0x0000000000000000000000000000000000000db0',
}))

const writeContract = vi.hoisted(() => vi.fn(async () => '0xhash'))
const waitForTransactionReceipt = vi.hoisted(() => vi.fn(async () => ({})))

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  return {
    ...actual,
    createWalletClient: () => ({ writeContract }),
    createPublicClient: () => ({ waitForTransactionReceipt }),
  }
})
vi.mock('viem/accounts', () => ({ privateKeyToAccount: () => ({ address: '0xdead' }) }))

import { useWalletActions } from '../src/hooks/use-wallet-actions'

const HOST = 'http://127.0.0.1:8787'

describe('useWalletActions — top-up chain branch', () => {
  beforeEach(() => {
    ctx.value = {
      address: '0x0000000000000000000000000000000000000aBc',
      chain: 'evm',
      usdcBalance: 0,
      isConnected: true,
      refresh: vi.fn(async () => {}),
    }
    writeContract.mockClear()
    waitForTransactionReceipt.mockClear()
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('canTopUp is true on EVM and true on Solana (both dev stacks)', () => {
    const evm = renderHook(() => useWalletActions())
    expect(evm.result.current.canTopUp).toBe(true)

    ctx.value = { ...ctx.value, chain: 'solana', address: 'SoLaNaBase58Addr' }
    const sol = renderHook(() => useWalletActions())
    expect(sol.result.current.canTopUp).toBe(true)
  })

  it('canTopUp is false on Sui (no faucet) and when disconnected', () => {
    ctx.value = { ...ctx.value, chain: 'sui' as OptionsChainKind }
    const sui = renderHook(() => useWalletActions())
    expect(sui.result.current.canTopUp).toBe(false)

    ctx.value = { ...ctx.value, chain: 'evm', isConnected: false }
    const off = renderHook(() => useWalletActions())
    expect(off.result.current.canTopUp).toBe(false)
  })

  it('EVM top-up mints via the anvil key and never calls the faucet', async () => {
    const fetchSpy = fetch as unknown as ReturnType<typeof vi.fn>
    const { result } = renderHook(() => useWalletActions())
    await act(async () => {
      await result.current.topUp()
    })
    expect(writeContract).toHaveBeenCalledTimes(1)
    expect(waitForTransactionReceipt).toHaveBeenCalledTimes(1)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(ctx.value.refresh).toHaveBeenCalledTimes(1)
  })

  it('Solana top-up POSTs { address } to the host faucet, then refreshes — no viem write', async () => {
    ctx.value = { ...ctx.value, chain: 'solana', address: 'SoLaNaBase58Addr' }
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }))
    vi.stubGlobal('fetch', fetchSpy)

    const { result } = renderHook(() => useWalletActions())
    await act(async () => {
      await result.current.topUp()
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${HOST}/aa/solana/faucet`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ address: 'SoLaNaBase58Addr' })
    expect(writeContract).not.toHaveBeenCalled()
    expect(ctx.value.refresh).toHaveBeenCalledTimes(1)
  })

  it('Solana faucet surfaces the returned error message on 404 / 503', async () => {
    ctx.value = { ...ctx.value, chain: 'solana', address: 'SoLaNaBase58Addr' }
    const fetchSpy = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: { message: 'mint authority keypair not found' } }),
    }))
    vi.stubGlobal('fetch', fetchSpy)

    const { result } = renderHook(() => useWalletActions())
    await expect(
      act(async () => {
        await result.current.topUp()
      }),
    ).rejects.toThrow('mint authority keypair not found')
    expect(ctx.value.refresh).not.toHaveBeenCalled()
  })

  it('Sui top-up throws (no faucet) and never fetches', async () => {
    ctx.value = { ...ctx.value, chain: 'sui' as OptionsChainKind }
    const fetchSpy = fetch as unknown as ReturnType<typeof vi.fn>
    const { result } = renderHook(() => useWalletActions())
    await expect(
      act(async () => {
        await result.current.topUp()
      }),
    ).rejects.toThrow(/only available on the local EVM dev stack/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
