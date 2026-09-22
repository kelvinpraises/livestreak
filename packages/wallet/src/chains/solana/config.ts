import { ConfigurationError } from '#vendor/evm-erc-4337/errors.js'
import type { SolanaWalletConfig } from '#vendor/solana/wallet-account-read-only-solana.js'

export type { SolanaWalletConfig }

// The Solana cluster identifiers. Callers pass this IN (from their own config);
// the wallet never reads it from the environment.
export type SolanaNetwork = 'mainnet-beta' | 'devnet' | 'testnet' | 'localnet'

export type SolanaPaymasterToken = { address: string }

// Sponsorship: the paymaster co-signs as fee payer. paymasterUrl points at any Kora-RPC-compatible
// endpoint — the real kora node or the host's in-process signer; the wallet cannot tell them apart.
//
// TOKEN-FREE by default: with no `paymasterToken` the paymaster pays the SOL fee and takes NOTHING —
// no fee-token transfer instruction, so no sponsor fee-token ATA to provision (the prod-safety win).
// A `paymasterToken` opts into the legacy Kora fee-token flow (the account appends an SPL transfer to
// the sponsor's fee-token ATA), kept for compatibility.
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
  // paymasterToken is OPTIONAL: absent ⇒ token-free; present ⇒ legacy Kora fee-token flow.
  paymasterToken?: SolanaPaymasterToken
}

export function isSponsoredSolanaConfig(
  config: LiveStreakSolanaWalletConfig,
): config is SponsoredSolanaWalletConfig {
  return config.paymasterUrl !== undefined && config.paymasterAddress !== undefined
}

// A sponsored config with no fee token — the paymaster pays SOL and takes nothing.
export function isTokenFreeSponsoredConfig(config: LiveStreakSolanaWalletConfig): boolean {
  return isSponsoredSolanaConfig(config) && config.paymasterToken === undefined
}

// Fail fast at manager construction (the EVM kit's _validateConfig posture) instead of at first send.
// paymasterToken is NOT required — its absence means token-free sponsorship, the default.
export function assertSolanaSponsorshipConfig(config: LiveStreakSolanaWalletConfig): void {
  if (!config.isSponsored) return
  const missing: string[] = []
  if (config.paymasterUrl === undefined) missing.push('paymasterUrl')
  if (config.paymasterAddress === undefined) missing.push('paymasterAddress')
  if (missing.length > 0) {
    throw new ConfigurationError(
      `Sponsored Solana wallet config is missing: ${missing.join(', ')}.`,
    )
  }
}
