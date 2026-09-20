// SPL companion instructions the livestreak flows need alongside program ixs.
// Hand-rolled (not the codama client) so the payer keeps its WRITABLE_SIGNER role
// when addressed as a plain Address — our builders never carry TransactionSigners.
import { AccountRole, type Address, type Instruction } from '@solana/kit'
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from '@solana-program/token'
import { SYSTEM_PROGRAM_ADDRESS } from '@solana-program/system'

import { findUsdcAta } from './pdas.js'

export interface CreateAtaIdempotentInput {
  /** Rent payer — must sign; usually the owner itself so a gasless fee payer owes no rent. */
  payer: Address
  owner: Address
  mint: Address
}

/**
 * CreateIdempotent on the associated-token program: no-op when the ATA already exists.
 * Prepend to money-moving transactions (create_vault_seeded, fund, withdraw) so the
 * owner's USDC ATA existing is never a launch-order precondition.
 */
export async function buildCreateAtaIdempotentIx(input: CreateAtaIdempotentInput): Promise<Instruction> {
  const [ata] = await findUsdcAta(input.owner, input.mint)
  return {
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    accounts: [
      { address: input.payer, role: AccountRole.WRITABLE_SIGNER },
      { address: ata, role: AccountRole.WRITABLE },
      { address: input.owner, role: AccountRole.READONLY },
      { address: input.mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: Uint8Array.of(1), // CreateIdempotent discriminator
  }
}
