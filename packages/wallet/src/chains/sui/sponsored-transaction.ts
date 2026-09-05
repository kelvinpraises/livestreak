import { SuiClient } from '@mysten/sui/client'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions'
import { normalizeSuiAddress } from '@mysten/sui/utils'
import { verifyTransactionSignature } from '@mysten/sui/verify'
import type { TransactionResult } from '@tetherto/wdk-wallet'

import { ConfigurationError } from '#vendor/evm-erc-4337/errors.js'
import type { SuiTransaction } from '#vendor/sui/wallet-account-read-only-sui.js'
import type VendorWalletAccountSui from '#vendor/sui/wallet-account-sui.js'

import type { LiveStreakSuiWalletConfig, SuiGasCoinRef } from './config.js'

export type SuiGasStationSponsorInput = {
  txKindBytes: Uint8Array
  sender: string
}

export type SuiGasStationSponsorResult = {
  txBytes: Uint8Array
  sponsorSignature: string
  sponsorAddress: string
}

export type SuiGasStation = {
  sponsor(input: SuiGasStationSponsorInput): Promise<SuiGasStationSponsorResult>
}

export type AssembleSponsoredTxBytesInput = {
  kindBytes: Uint8Array
  sender: string
  sponsorKeypair: Ed25519Keypair
  gasCoins: SuiGasCoinRef[]
  gasBudget: bigint
  gasPrice: bigint
  client: SuiClient
}

export type ExecuteSponsoredTransactionInput = {
  account: VendorWalletAccountSui
  transaction: SuiTransaction
  gasStation: SuiGasStation
  client: SuiClient
  transferMaxFee?: number | bigint
}

const GAS_STATION_ALTERED_TX_ERROR =
  'Gas station altered the transaction kind/sender; refusing to sign.'

function isSimpleTransfer(
  tx: SuiTransaction,
): tx is { to: string; value: number | bigint } {
  return (
    typeof (tx as { to?: unknown }).to === 'string'
    && (tx as { value?: unknown }).value !== undefined
  )
}

function kindBytesFromParsedTx(parsed: TransactionDataBuilder): Uint8Array {
  return parsed.build({ onlyTransactionKind: true })
}

export function assertGasStationReturnedTxMatchesKind(
  txBytes: Uint8Array,
  txKindBytes: Uint8Array,
  expectedSender: string,
): void {
  const parsed = TransactionDataBuilder.fromBytes(txBytes)

  if (
    !parsed.sender
    || normalizeSuiAddress(parsed.sender) !== normalizeSuiAddress(expectedSender)
  ) {
    throw new Error(GAS_STATION_ALTERED_TX_ERROR)
  }

  const returnedKindBytes = kindBytesFromParsedTx(parsed)
  if (
    returnedKindBytes.length !== txKindBytes.length
    || !returnedKindBytes.every((byte, index) => byte === txKindBytes[index])
  ) {
    throw new Error(GAS_STATION_ALTERED_TX_ERROR)
  }
}

export function resolveSuiClient(config: LiveStreakSuiWalletConfig): SuiClient {
  if (config.provider) {
    return config.provider
  }
  if (typeof config.rpcUrl === 'string') {
    return new SuiClient({ url: config.rpcUrl })
  }
  throw new Error('The wallet must be connected to a provider to send transactions.')
}

export async function normalizeSuiTransaction(
  transaction: SuiTransaction,
): Promise<Transaction> {
  if (transaction instanceof Transaction) {
    return transaction
  }
  if (isSimpleTransfer(transaction)) {
    const tx = new Transaction()
    const [coin] = tx.splitCoins(tx.gas, [transaction.value])
    tx.transferObjects([coin], transaction.to)
    return tx
  }
  throw new Error('Invalid transaction object.')
}

export async function assembleSponsoredTxBytes(
  input: AssembleSponsoredTxBytesInput,
): Promise<SuiGasStationSponsorResult> {
  const sponsorAddress = input.sponsorKeypair.getPublicKey().toSuiAddress()
  const transaction = Transaction.fromKind(input.kindBytes)
  transaction.setSender(input.sender)
  transaction.setGasOwner(sponsorAddress)
  transaction.setGasPayment(input.gasCoins)
  transaction.setGasBudget(input.gasBudget)
  transaction.setGasPrice(input.gasPrice)

  const txBytes = await transaction.build({ client: input.client })
  const { signature: sponsorSignature } = await input.sponsorKeypair.signTransaction(txBytes)

  return { txBytes, sponsorSignature, sponsorAddress }
}

export function createLocalGasStation(options: {
  sponsorKeypair: Ed25519Keypair
  gasCoins: SuiGasCoinRef[]
  gasBudget: bigint
  gasPrice: bigint
  client: SuiClient
}): SuiGasStation {
  return {
    sponsor: ({ txKindBytes, sender }) =>
      assembleSponsoredTxBytes({
        kindBytes: txKindBytes,
        sender,
        sponsorKeypair: options.sponsorKeypair,
        gasCoins: options.gasCoins,
        gasBudget: options.gasBudget,
        gasPrice: options.gasPrice,
        client: options.client,
      }),
  }
}

export async function signSenderForSponsoredTransaction(
  account: VendorWalletAccountSui,
  txBytes: Uint8Array,
): Promise<string> {
  const privateKey = account.keyPair.privateKey
  if (!privateKey) {
    throw new Error('The wallet account has been disposed.')
  }
  const senderKeypair = Ed25519Keypair.fromSecretKey(privateKey)
  const { signature } = await senderKeypair.signTransaction(txBytes)
  return signature
}

export async function verifySponsoredSignatures(
  txBytes: Uint8Array,
  senderSignature: string,
  sponsorSignature: string,
  senderAddress: string,
  sponsorAddress: string,
): Promise<void> {
  try {
    await verifyTransactionSignature(txBytes, senderSignature, { address: senderAddress })
  } catch {
    throw new Error('Sender signature verification failed.')
  }

  try {
    await verifyTransactionSignature(txBytes, sponsorSignature, { address: sponsorAddress })
  } catch {
    throw new Error('Sponsor signature verification failed.')
  }
}

export async function executeSponsoredTransaction(
  input: ExecuteSponsoredTransactionInput,
): Promise<TransactionResult> {
  const { account, transaction, gasStation, client, transferMaxFee } = input
  const sender = await account.getAddress()
  const built = await normalizeSuiTransaction(transaction)
  const txKindBytes = await built.build({ client, onlyTransactionKind: true })

  const { txBytes, sponsorSignature, sponsorAddress } = await gasStation.sponsor({
    txKindBytes,
    sender,
  })

  if (!sponsorAddress) {
    throw new ConfigurationError('gasStation.sponsor() must return sponsorAddress.')
  }

  assertGasStationReturnedTxMatchesKind(txBytes, txKindBytes, sender)

  const senderSignature = await signSenderForSponsoredTransaction(account, txBytes)

  const result = await client.executeTransactionBlock({
    transactionBlock: txBytes,
    signature: [senderSignature, sponsorSignature],
    options: { showEffects: true },
  })

  const gasUsed = result.effects?.gasUsed
  const fee = gasUsed
    ? BigInt(gasUsed.computationCost) + BigInt(gasUsed.storageCost) - BigInt(gasUsed.storageRebate)
    : 0n

  if (transferMaxFee !== undefined && fee >= transferMaxFee) {
    throw new Error(`Exceeded maximum fee cost for transaction. Fee: ${fee}, Max: ${transferMaxFee}`)
  }

  return { hash: result.digest, fee }
}
