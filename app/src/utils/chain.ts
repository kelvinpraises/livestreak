import { isAddress } from 'viem'

export type OptionsChainKind = 'evm' | 'sui'

export const SESSION_CHAIN_KEY = 'livestreak_options_chain'

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
