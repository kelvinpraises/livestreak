import VendorWalletAccountReadOnlySolana from '#vendor/solana/wallet-account-read-only-solana.js'
import VendorWalletAccountSolana from '#vendor/solana/wallet-account-solana.js'
import VendorWalletAccountReadOnlySolanaGasless from '#vendor/solana-gasless/wallet-account-read-only-solana-gasless.js'
import VendorWalletAccountSolanaGasless from '#vendor/solana-gasless/wallet-account-solana-gasless.js'

import type { SponsoredSolanaWalletConfig } from './config.js'
import { guardKoraClient } from './sponsored-transaction.js'

type VendorGaslessConfig = Parameters<
  VendorWalletAccountReadOnlySolanaGasless['_createFailoverProvider']
>[0]

// Solana confirms transaction signatures directly — this maps getSignatureStatuses onto the shared
// poller's receipt contract (null = pending, { success } = final), so pollUntilUserOperationIncluded
// works unchanged for EVM-style consumers.
type SolanaRpcLike = {
  getSignatureStatuses(
    signatures: readonly string[],
    options?: { searchTransactionHistory?: boolean },
  ): { send(): Promise<{ value: readonly (Record<string, unknown> | null)[] }> }
}

export async function readSolanaSignatureReceipt(
  rpc: SolanaRpcLike | undefined,
  hash: string,
): Promise<unknown> {
  if (!rpc) {
    throw new Error('The wallet must be connected to a provider to fetch signature statuses.')
  }
  const { value } = await rpc
    .getSignatureStatuses([hash], { searchTransactionHistory: true })
    .send()
  const status = value[0]
  if (!status) return null
  if (status['err'] !== null && status['err'] !== undefined) {
    return { success: false, status }
  }
  const confirmation = status['confirmationStatus']
  if (confirmation === 'confirmed' || confirmation === 'finalized') {
    return { success: true, status }
  }
  return null
}

export class WalletAccountReadOnlySolana extends VendorWalletAccountReadOnlySolana {
  async getUserOperationReceipt(hash: string): Promise<unknown> {
    return readSolanaSignatureReceipt(this._rpc as SolanaRpcLike | undefined, hash)
  }
}

export class WalletAccountSolana extends VendorWalletAccountSolana {
  async getUserOperationReceipt(hash: string): Promise<unknown> {
    return readSolanaSignatureReceipt(this._rpc as SolanaRpcLike | undefined, hash)
  }

  override async toReadOnlyAccount(): Promise<WalletAccountReadOnlySolana> {
    const address = await this.getAddress()
    return new WalletAccountReadOnlySolana(address, this._config)
  }
}

export class WalletAccountReadOnlySolanaGasless extends VendorWalletAccountReadOnlySolanaGasless {
  override _createFailoverProvider(config?: VendorGaslessConfig) {
    return guardKoraClient(super._createFailoverProvider(config))
  }

  async getUserOperationReceipt(hash: string): Promise<unknown> {
    return readSolanaSignatureReceipt(this._rpc as SolanaRpcLike | undefined, hash)
  }
}

export class WalletAccountSolanaGasless extends VendorWalletAccountSolanaGasless {
  override _createFailoverProvider(config?: VendorGaslessConfig) {
    return guardKoraClient(super._createFailoverProvider(config))
  }

  async getUserOperationReceipt(hash: string): Promise<unknown> {
    return readSolanaSignatureReceipt(this._rpc as SolanaRpcLike | undefined, hash)
  }

  override async toReadOnlyAccount(): Promise<WalletAccountReadOnlySolanaGasless> {
    const address = await this.getAddress()
    return new WalletAccountReadOnlySolanaGasless(
      address,
      this._config as SponsoredSolanaWalletConfig,
    )
  }
}
