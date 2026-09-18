import { ConfigurationError } from '#vendor/evm-erc-4337/errors.js'
import type { SolanaWalletConfig } from '#vendor/solana/wallet-account-read-only-solana.js'

export type { SolanaWalletConfig }

// The Solana cluster identifiers. Callers pass this IN (from their own config);
// the wallet never reads it from the environment.
export type SolanaNetwork = 'mainnet-beta' | 'devnet' | 'testnet' | 'localnet'

export type SolanaPaymasterToken = { address: string }

// Sponsorship follows the vendored gasless kit's Kora paymaster model: the paymaster co-signs as
// fee payer and quotes fees in an SPL token. paymasterUrl points at any Kora-RPC-compatible
// endpoint — the real kora node or the host's in-process signer; the wallet cannot tell them apart.
export type LiveStreakSolanaWalletConfig = SolanaWalletConfig & {
  isSponsored?: boolean
  paymasterUrl?: string | string[]
  paymasterAddress?: string
  paymasterToken?: SolanaPaymasterToken
  network?: SolanaNetwork
}

export type SponsoredSolanaWalletConfig = LiveStreakSolanaWalletConfig & {
  paymasterUrl: string | string[]
  paymasterAddress: string
  paymasterToken: SolanaPaymasterToken
}

export function isSponsoredSolanaConfig(
  config: LiveStreakSolanaWalletConfig,
): config is SponsoredSolanaWalletConfig {
  return config.paymasterUrl !== undefined
}

// Fail fast at manager construction (the EVM kit's _validateConfig posture) instead of at first send.
export function assertSolanaSponsorshipConfig(config: LiveStreakSolanaWalletConfig): void {
  if (!config.isSponsored) return
  const missing: string[] = []
  if (config.paymasterUrl === undefined) missing.push('paymasterUrl')
  if (config.paymasterAddress === undefined) missing.push('paymasterAddress')
  if (config.paymasterToken === undefined) missing.push('paymasterToken')
  if (missing.length > 0) {
    throw new ConfigurationError(
      `Sponsored Solana wallet config is missing: ${missing.join(', ')}.`,
    )
  }
}
