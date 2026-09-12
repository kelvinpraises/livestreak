import { isAddress } from 'viem'

export type OptionsChainKind = 'evm' | 'sui'

export const SESSION_CHAIN_KEY = 'livestreak_options_chain'

export interface ChainOption {
  readonly id: OptionsChainKind
  readonly label: string
  readonly network: string
}

// Canonical chains shown in the wallet's chain picker. `id` is the VM family used for wallet derivation
// + contract deployments (unchanged across the app); `label` is the SPECIFIC chain name — the EVM
// deployment currently targets Anvil, not "EVM" (the family). Add entries here as chains are deployed.
export const SUPPORTED_CHAINS: readonly ChainOption[] = [
  { id: 'sui', label: 'Sui', network: 'localnet' },
  { id: 'evm', label: 'Anvil', network: 'localhost · 31337' },
]

export const chainLabel = (id: OptionsChainKind): string =>
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
