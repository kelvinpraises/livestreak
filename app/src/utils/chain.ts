import { isAddress } from 'viem'

// The VM families the options runtime can drive. Solana's contracts port landed, so it is now a
// first-class runtime chain alongside EVM + Sui (no longer a display-only pill).
export type OptionsChainKind = 'evm' | 'sui' | 'solana'

export const SESSION_CHAIN_KEY = 'livestreak_options_chain'

export interface ChainOption {
  readonly id: OptionsChainKind
  readonly label: string
  readonly network: string
  readonly deployed: boolean
}

// Canonical chains shown in the wallet's chain picker. `id` is the VM family used for wallet derivation
// + contract deployments (unchanged across the app); `label` is the SPECIFIC chain name — the EVM
// deployment currently targets Anvil, not "EVM" (the family). Flip `deployed` as chains land.
export const SUPPORTED_CHAINS: readonly ChainOption[] = [
  { id: 'sui', label: 'Sui', network: 'localnet', deployed: true },
  { id: 'evm', label: 'Anvil', network: 'localhost · 31337', deployed: true },
  { id: 'solana', label: 'Solana', network: 'localnet · 8899', deployed: true },
]

// Empty-state helper: given the active chain, return the FIRST other supported chain that has open
// vaults (per the `hasVaults` probe), or null if none do. Replaces a binary `evm ? sui : evm` toggle
// that silently mispointed once Solana became a third chain — the "switch chain" hint must never send
// a user to an equally-empty chain.
export function firstOtherChainWithVaults(
  active: OptionsChainKind,
  hasVaults: (chain: OptionsChainKind) => boolean,
): OptionsChainKind | null {
  return SUPPORTED_CHAINS.map((c) => c.id).find((id) => id !== active && hasVaults(id)) ?? null
}

export const chainLabel = (id: OptionsChainKind): string =>
  SUPPORTED_CHAINS.find((c) => c.id === id)?.label ?? id

const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/
// A base58-encoded 32-byte Solana pubkey renders to 32–44 chars in the base58 alphabet (no 0 O I l).
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export function readStoredChain(): OptionsChainKind {
  if (typeof window === 'undefined') return 'evm'
  const stored = sessionStorage.getItem(SESSION_CHAIN_KEY)
  if (stored === 'sui') return 'sui'
  if (stored === 'solana') return 'solana'
  return 'evm'
}

// Placeholder for a transfer-recipient input, matched to each chain's address shape (EVM/Sui are
// 0x-hex, Solana is base58) so we never prompt a Solana user for a "0x…" address.
export function recipientPlaceholder(chain: OptionsChainKind): string {
  if (chain === 'sui') return 'Transfer to Sui address…'
  if (chain === 'solana') return 'Transfer to Solana address…'
  return 'Transfer to 0x…'
}

export function isValidRecipientAddress(chain: OptionsChainKind, value: string): boolean {
  if (chain === 'sui') return SUI_ADDRESS_RE.test(value)
  if (chain === 'solana') return SOLANA_ADDRESS_RE.test(value)
  return isAddress(value)
}
