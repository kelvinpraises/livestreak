import { getBase64Encoder } from '@solana/kit'
import { getTransactionDecoder } from '@solana/transactions'

// The Kora paymaster integrity guard — the assertGasStationReturnedTxMatchesKind analog for Solana.
//
// Trust model: in the Kora flow the SENDER signs first (partial sign over messageBytes), so a
// paymaster cannot alter the transaction it broadcasts without invalidating the sender's ed25519
// signature — the chain rejects any mutation. That covers signAndSendTransaction structurally.
// signTransaction, however, RETURNS a co-signed transaction the caller may broadcast; a hostile or
// buggy paymaster could hand back a different transaction. This guard fails fast locally instead of
// letting a swapped transaction travel to the RPC and die there (or worse, carry a forged shape the
// caller then trusts for display).

const decodeWireTransaction = (base64Wire: string) =>
  getTransactionDecoder().decode(getBase64Encoder().encode(base64Wire))

const bytesEqual = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export function assertKoraPreservedSignedTransaction(
  sentBase64Wire: string,
  returnedBase64Wire: string,
): void {
  const sent = decodeWireTransaction(sentBase64Wire)
  const returned = decodeWireTransaction(returnedBase64Wire)

  if (!bytesEqual(sent.messageBytes, returned.messageBytes)) {
    throw new Error('Kora paymaster returned a transaction with an altered message.')
  }

  // The paymaster may only FILL empty signature slots (its own), never touch existing ones.
  for (const [signerAddress, signature] of Object.entries(sent.signatures)) {
    if (signature === null) continue
    const returnedSignature = returned.signatures[signerAddress as keyof typeof returned.signatures]
    if (
      returnedSignature === null ||
      returnedSignature === undefined ||
      !bytesEqual(signature as ArrayLike<number>, returnedSignature as ArrayLike<number>)
    ) {
      throw new Error(
        `Kora paymaster dropped or replaced the signature for ${signerAddress}.`,
      )
    }
  }
}

type KoraSignTransactionInput = { transaction: string; signer_key?: string }
type KoraSignTransactionResult = { signed_transaction: string }

// Wraps a KoraClient (or a failover wrapper around several) so every signTransaction response is
// integrity-checked before the kit trusts it. All other methods pass through untouched.
export function guardKoraClient<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (prop === 'signTransaction' && typeof value === 'function') {
        return async (input: KoraSignTransactionInput): Promise<KoraSignTransactionResult> => {
          const result = (await value.call(target, input)) as KoraSignTransactionResult
          assertKoraPreservedSignedTransaction(input.transaction, result.signed_transaction)
          return result
        }
      }
      return typeof value === 'function' ? value.bind(target) : value
    },
  }) as T
}
