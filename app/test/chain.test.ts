import { describe, expect, it, beforeEach } from 'vitest'
import {
  SESSION_CHAIN_KEY,
  SUPPORTED_CHAINS,
  firstOtherChainWithVaults,
  isValidRecipientAddress,
  readStoredChain,
  recipientPlaceholder,
} from '../src/utils/chain'

// readStoredChain guards on `typeof window` and reads sessionStorage; the default vitest env is
// node, so install a minimal in-memory shim rather than pulling in a full DOM environment.
function installSessionStorage(): void {
  const store = new Map<string, string>()
  const shim = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  }
  ;(globalThis as Record<string, unknown>).window = globalThis
  ;(globalThis as Record<string, unknown>).sessionStorage = shim
}

describe('readStoredChain', () => {
  beforeEach(() => {
    installSessionStorage()
    sessionStorage.clear()
  })

  it('round-trips solana', () => {
    sessionStorage.setItem(SESSION_CHAIN_KEY, 'solana')
    expect(readStoredChain()).toBe('solana')
  })

  it('round-trips sui and evm; returns null for unset/unknown (the default is decided by initialChain)', () => {
    sessionStorage.setItem(SESSION_CHAIN_KEY, 'sui')
    expect(readStoredChain()).toBe('sui')
    sessionStorage.setItem(SESSION_CHAIN_KEY, 'evm')
    expect(readStoredChain()).toBe('evm')
    // No hard-coded default here anymore: unknown / unset → null, so a Solana-only run never boots evm.
    sessionStorage.setItem(SESSION_CHAIN_KEY, 'dogecoin')
    expect(readStoredChain()).toBeNull()
    sessionStorage.clear()
    expect(readStoredChain()).toBeNull()
  })
})

describe('SUPPORTED_CHAINS', () => {
  it('marks solana as a deployed runtime chain on localnet', () => {
    const solana = SUPPORTED_CHAINS.find((c) => c.id === 'solana')
    expect(solana).toBeDefined()
    expect(solana?.deployed).toBe(true)
    expect(solana?.network).toBe('localnet · 8899')
  })
})

describe('recipientPlaceholder', () => {
  it('never prompts a solana user for a 0x address', () => {
    expect(recipientPlaceholder('solana')).toBe('Transfer to Solana address…')
    expect(recipientPlaceholder('solana')).not.toContain('0x')
  })

  it('keeps the sui + evm placeholders chain-accurate', () => {
    expect(recipientPlaceholder('sui')).toBe('Transfer to Sui address…')
    expect(recipientPlaceholder('evm')).toBe('Transfer to 0x…')
  })
})

describe('firstOtherChainWithVaults', () => {
  it('skips the active chain and returns the first OTHER chain that has vaults', () => {
    // Active solana, vaults only on sui -> point at sui (not evm, the old binary "other").
    expect(firstOtherChainWithVaults('solana', c => c === 'sui')).toBe('sui')
  })

  it('never points at an equally-empty chain (returns null when no other chain has vaults)', () => {
    expect(firstOtherChainWithVaults('evm', c => c === 'evm')).toBe(null)
    expect(firstOtherChainWithVaults('solana', () => false)).toBe(null)
  })

  it('honours SUPPORTED_CHAINS ordering when multiple others qualify', () => {
    // sui precedes evm in SUPPORTED_CHAINS; active solana with both funded -> sui wins.
    expect(firstOtherChainWithVaults('solana', c => c === 'sui' || c === 'evm')).toBe('sui')
  })
})

describe('isValidRecipientAddress (solana)', () => {
  it('accepts a valid base58 32-byte pubkey', () => {
    // The deployed localnet program id — a real 44-char base58 pubkey.
    expect(
      isValidRecipientAddress('solana', 'CZnAfgbnbVtuXDRQynwL9XMHqeQ7wngbodRihGLbErK8'),
    ).toBe(true)
    // System program (32 chars, all base58) — the anon viewer.
    expect(isValidRecipientAddress('solana', '11111111111111111111111111111111')).toBe(true)
  })

  it('rejects non-base58 / wrong-length / evm-hex input', () => {
    expect(isValidRecipientAddress('solana', '0x000000000000000000000000000000000000dead')).toBe(
      false,
    ) // contains 0, x — not base58
    expect(isValidRecipientAddress('solana', 'short')).toBe(false)
    expect(isValidRecipientAddress('solana', '0OIl00OIl00OIl00OIl00OIl00OIl00OI')).toBe(false) // 0 O I l excluded
    expect(isValidRecipientAddress('solana', '')).toBe(false)
  })

  it('still routes evm + sui to their own validators', () => {
    expect(
      isValidRecipientAddress('evm', '0x000000000000000000000000000000000000dEaD'),
    ).toBe(true)
    expect(isValidRecipientAddress('evm', 'CZnAfgbnbVtuXDRQynwL9XMHqeQ7wngbodRihGLbErK8')).toBe(
      false,
    )
    expect(
      isValidRecipientAddress(
        'sui',
        '0x000000000000000000000000000000000000000000000000000000000000dead',
      ),
    ).toBe(true)
  })
})
