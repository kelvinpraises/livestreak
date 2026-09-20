export { default, createWalletManager } from '#create-wallet-manager.js'

export {
  WalletManagerEvmErc4337,
  WalletAccountEvmErc4337,
  WalletAccountReadOnlyEvmErc4337,
  ConfigurationError,
} from '#chains/evm.js'

export {
  WalletManagerSui,
  WalletAccountSui,
  WalletAccountReadOnlySui,
  createSuiAccount,
  assertGasStationReturnedTxMatchesKind,
  assembleSponsoredTxBytes,
  createLocalGasStation,
  createSuiReadClient,
  executeSponsoredTransaction,
  isSponsoredSuiConfig,
  signSenderForSponsoredTransaction,
  verifySponsoredSignatures,
} from '#chains/sui/index.js'

export {
  WalletManagerSolana,
  WalletAccountSolana,
  WalletAccountReadOnlySolana,
  WalletAccountSolanaGasless,
  WalletAccountReadOnlySolanaGasless,
  assertKoraPreservedSignedTransaction,
  assertSolanaSponsorshipConfig,
  guardKoraClient,
  isSponsoredSolanaConfig,
  readSolanaSignatureReceipt,
} from '#chains/solana/index.js'

export type {
  WalletChain,
  EvmErc4337WalletConfig,
  SuiWalletConfig,
  WalletConfigByChain,
  WalletManagerForChain,
} from '#types.js'

export type {
  EvmErc4337WalletCommonConfig,
  EvmErc4337WalletPaymasterTokenConfig,
  EvmErc4337WalletSponsorshipPolicyConfig,
  EvmErc4337WalletNativeCoinsConfig,
} from '#chains/evm.js'

export type {
  SuiTransaction,
  LiveStreakSuiWalletConfig,
  SuiGasStation,
  SuiGasCoinRef,
  SuiNetwork,
} from '#chains/sui/index.js'

export type {
  SolanaTransaction,
  LiveStreakSolanaWalletConfig,
  SolanaNetwork,
  SolanaPaymasterToken,
  SponsoredSolanaWalletConfig,
} from '#chains/solana/index.js'

// Multichain-hygiene: @livestreak/wallet is the SINGLE @mysten/sui (v2) owner. Sui executors
// (options writer/reader, observe registrar) build PTBs + read VIA these re-exports instead of
// declaring their own direct @mysten/sui dependency.
export { Transaction } from '@mysten/sui/transactions'
export { bcs } from '@mysten/sui/bcs'
export { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
export type { SuiTransactionBlockResponse } from '@mysten/sui/jsonRpc'

// Same hygiene for Solana: the wallet is the single @solana/* + @solana/kora owner. The host's
// Kora-compatible signer and any Solana executor consume these re-exports.
export { createSolanaRpc } from '@solana/rpc'
export { address as solanaAddress } from '@solana/addresses'
export {
  getTransactionDecoder,
  getTransactionEncoder,
  getBase64EncodedWireTransaction,
} from '@solana/transactions'
export { getBase58Decoder, getBase64Decoder, getBase64Encoder } from '@solana/codecs'
export { getCompiledTransactionMessageDecoder } from '@solana/transaction-messages'
export { createKeyPairSignerFromPrivateKeyBytes } from '@solana/signers'
export { KoraClient } from '@solana/kora'

// The shared livestreak Solana program layer (PDAs, instruction builders, account
// decoders, tx composer + the kit Address/IInstruction primitives) for handler legs.
export * from '#chains/solana/livestreak/index.js'

export type { IWalletAccount } from '@tetherto/wdk-wallet'
export type {
  TransactionResult,
  TransferResult,
  TransferOptions,
  KeyPair,
} from '@tetherto/wdk-wallet'

export type { FeeRates, EvmTransaction } from '@tetherto/wdk-wallet-evm'

// Shared userOperation poller (systemic POLL + SUCCESS fix). All chain writers import this.
export {
  pollUntilUserOperationIncluded,
  readUserOperationSuccess,
  assertUserOperationSucceeded,
  isPaymasterSideFailure,
  UserOperationPollTimeoutError,
} from './poller.js'
export type {
  UserOperationReceiptReader,
  PollUserOperationOptions,
} from './poller.js'

// MetaMask-style at-rest keystore for the gateway daemon. Node-only — it pulls
// sodium-native, which must never enter a browser/SSR bundle. Import it from the
// dedicated subpath instead of the package root: `@livestreak/wallet/keystore`.
