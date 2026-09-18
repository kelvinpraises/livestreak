import { isAddress } from 'viem'

export type OptionsChainKind = 'evm' | 'sui'

// Chains the picker can DISPLAY — a superset of what the options runtime can drive. Solana's wallet
// + host sponsorship are live, but its contracts port is pending, so it renders as a non-selectable
// pill instead of crashing into a runtime that doesn't exist yet.
export type PickerChainId = OptionsChainKind | 'solana'

export const SESSION_CHAIN_KEY = 'livestreak_options_chain'

export interface ChainOption {
  readonly id: PickerChainId
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
  { id: 'solana', label: 'Solana', network: 'devnet · contracts pending', deployed: false },
]

export const chainLabel = (id: PickerChainId): string =>
  SUPPORTED_CHAINS.find((c) => c.id === id)?.label ?? id

const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/

export function readStoredChain(): OptionsChainKind {
  if (typeof window === 'undefined') return 'evm'
  const stored = sessionStorage.getItem(SESSION_CHAIN_KEY)
  return stored === 'sui' ? 'sui' : 'evm'
}

export function isValidRecipientAddress(chain: OptionsChainKind, value: string): boolean {
  if (chain === 'sui') return SUI_ADDRESS_RE.test(value)
  return isAddress(value)
}
