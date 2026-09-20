export { default as WalletManagerSolana } from './manager.js'
export {
  WalletAccountReadOnlySolana,
  WalletAccountReadOnlySolanaGasless,
  WalletAccountSolana,
  WalletAccountSolanaGasless,
  readSolanaSignatureReceipt,
} from './account.js'

export type { SolanaTransaction } from '#vendor/solana/wallet-account-read-only-solana.js'
export type {
  LiveStreakSolanaWalletConfig,
  SolanaNetwork,
  SolanaPaymasterToken,
  SolanaWalletConfig,
  SponsoredSolanaWalletConfig,
} from './config.js'
export { assertSolanaSponsorshipConfig, isSponsoredSolanaConfig } from './config.js'

export {
  assertKoraPreservedSignedTransaction,
  guardKoraClient,
} from './sponsored-transaction.js'

// The shared livestreak program layer (PDAs + instruction builders + account decoders)
// every Solana handler leg consumes.
export * from './livestreak/index.js'
