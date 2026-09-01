// useStealthWallet.ts — INTERIM wallet edge.
//
// ⚠️ Architecture note (see app/docs/TODO.md): the app should NOT own wallet
// instantiation. The intended design is that the app only (a) derives the seed
// from a password and (b) assembles the WalletInit config (@livestreak/schema),
// then hands both to the options SDK, which owns @livestreak/wallet. Until the
// options SDK gains that wallet integration, this hook wires the wallet directly
// as a stopgap.
//
// The wallet edge FAILS SOFT: @livestreak/wallet is loaded lazily (so SSR and
// bundling/load failures can't crash the app), and every wallet operation is a
// console.warn + error-state on failure — never a hard throw.

import { useState, useCallback, useEffect, useRef } from 'react'
import { sha256, toBytes, hexToBytes, bytesToHex, erc20Abi, type Address } from 'viem'
import type { WalletAccountEvmErc4337, EvmTransaction } from '@livestreak/wallet'
import { publicClient, contracts, walletConfig } from '#/config/contracts.ts'

const STEALTH_DOMAIN = 'livestreak-stealth-v1'
const SESSION_SECRET_KEY = 'livestreak_stealth_secret'

export interface StealthWalletState {
  address: Address | null
  isConnected: boolean
  isLoading: boolean
  error: string | null
  usdcBalance: bigint
  /** Derive (or restore) the wallet from a password. Fails soft (sets error). */
  connect: (password: string) => Promise<void>
  disconnect: () => void
  /** Send calls through the smart account. Returns tx hash, or '' on no-op/failure. */
  sendUserOperation: (calls: unknown[]) => Promise<string>
}

function warn(message: string, err?: unknown) {
  const detail = err instanceof Error ? err.message : err != null ? String(err) : ''
  console.warn(`[wallet] ${message}${detail ? `: ${detail}` : ''} (interim wallet edge)`)
}

export function useStealthWallet(): StealthWalletState {
  const [address, setAddress] = useState<Address | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [usdcBalance, setUsdcBalance] = useState<bigint>(0n)

  const accountRef = useRef<WalletAccountEvmErc4337 | null>(null)
  const balanceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchBalance = useCallback(async (addr: Address) => {
    try {
      const balance = await publicClient.readContract({
        address: contracts.usdc,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [addr],
      })
      setUsdcBalance(balance as bigint)
    } catch {
      // keep previous value on read failure
    }
  }, [])

  // Build the wallet manager + account from raw secret bytes. Fails soft.
  const initFromSecret = useCallback(async (secret: Uint8Array) => {
    try {
      // Lazy import: @livestreak/wallet is a heavy Node/bare-runtime SDK. Loading
      // it on demand keeps it out of the SSR graph and turns any bundling/runtime
      // load failure into a soft warning rather than a module-load crash.
      const { WalletManagerEvmErc4337 } = await import('@livestreak/wallet')
      const manager = new WalletManagerEvmErc4337(secret, walletConfig())
      const account = await manager.getAccountByPath("0'/0/0")
      const addr = (await account.getAddress()) as Address

      accountRef.current = account
      setAddress(addr)
      setIsConnected(true)
      setError(null)

      fetchBalance(addr)
      if (balanceIntervalRef.current) clearInterval(balanceIntervalRef.current)
      balanceIntervalRef.current = setInterval(() => fetchBalance(addr), 15_000)
    } catch (err) {
      warn('wallet init failed', err)
      setError(err instanceof Error ? err.message : String(err))
      setIsConnected(false)
      accountRef.current = null
    }
  }, [fetchBalance])

  // Auto-restore from sessionStorage within the same tab (client only).
  useEffect(() => {
    if (typeof window === 'undefined') return
    const cached = sessionStorage.getItem(SESSION_SECRET_KEY)
    if (!cached) return
    setIsLoading(true)
    try {
      void initFromSecret(hexToBytes(cached as `0x${string}`)).finally(() => setIsLoading(false))
    } catch (err) {
      warn('session restore failed', err)
      sessionStorage.removeItem(SESSION_SECRET_KEY)
      setIsLoading(false)
    }
    return () => {
      if (balanceIntervalRef.current) clearInterval(balanceIntervalRef.current)
    }
  }, [initFromSecret])

  const connect = useCallback(async (password: string) => {
    if (!password) {
      setError('Password required')
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const secret = toBytes(sha256(toBytes(STEALTH_DOMAIN + password)))
      try {
        sessionStorage.setItem(SESSION_SECRET_KEY, bytesToHex(secret))
      } catch {
        // sessionStorage unavailable — non-fatal
      }
      await initFromSecret(secret) // soft inside
    } catch (err) {
      warn('connect failed', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsLoading(false)
    }
  }, [initFromSecret])

  const disconnect = useCallback(() => {
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem(SESSION_SECRET_KEY)
      } catch {
        // ignore
      }
    }
    try {
      accountRef.current?.dispose?.()
    } catch {
      // ignore disposal errors
    }
    accountRef.current = null
    setAddress(null)
    setIsConnected(false)
    setUsdcBalance(0n)
    setError(null)
    if (balanceIntervalRef.current) {
      clearInterval(balanceIntervalRef.current)
      balanceIntervalRef.current = null
    }
  }, [])

  const sendUserOperation = useCallback(async (calls: unknown[]): Promise<string> => {
    const account = accountRef.current
    if (!account) {
      warn('sendUserOperation called with no connected wallet — no-op')
      return ''
    }
    try {
      const txs = (calls as Array<{ to: string; data?: string; value?: bigint }>).map(c => ({
        to: c.to,
        data: c.data ?? '0x',
        value: c.value ?? 0n,
      })) as EvmTransaction[]

      const result = (await account.sendTransaction(
        txs.length === 1 ? txs[0] : txs,
      )) as unknown as { hash?: string; userOpHash?: string; transactionHash?: string }

      if (address) fetchBalance(address)
      return result.transactionHash ?? result.hash ?? result.userOpHash ?? ''
    } catch (err) {
      warn('sendUserOperation failed', err)
      setError(err instanceof Error ? err.message : String(err))
      return ''
    }
  }, [address, fetchBalance])

  return { address, isConnected, isLoading, error, usdcBalance, connect, disconnect, sendUserOperation }
}
