// PDA derivation for every account family the livestreak program uses. Seeds mirror
// programs/livestreak/src/{constants.rs,instructions/protocol.rs}; text seeds are the
// pure constants re-exported from @livestreak/contracts (the single seed source).
import { getProgramDerivedAddress, getU64Encoder, type Address, type ProgramDerivedAddress } from '@solana/kit'
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from '@solana-program/token'
import {
  ESCROW_SEED,
  MARKET_INDEX_SEED,
  MARKET_SEED,
  MARKET_STEWARD_SEED,
  POSITION_SEED,
  PROTOCOL_SEED,
  REGISTRY_SEED,
} from '@livestreak/contracts/solana'

import { bytesFromHex32, type Hex32 } from './ids.js'

/** [Address, bump] — the shape @solana/kit's PDA helpers resolve to. */
export type Pda = ProgramDerivedAddress

const u64le = getU64Encoder()

/** Singleton registry PDA: ["registry"]. */
export const findRegistryPda = (programId: Address): Promise<Pda> =>
  getProgramDerivedAddress({ programAddress: programId, seeds: [REGISTRY_SEED] })

/** Market PDA: ["market", market_id]. */
export const findMarketPda = (programId: Address, marketId: Hex32): Promise<Pda> =>
  getProgramDerivedAddress({ programAddress: programId, seeds: [MARKET_SEED, bytesFromHex32(marketId)] })

/** Enumeration ledger PDA: ["market_idx", index_le] (index = registry.market_count at register time). */
export const findMarketIndexPda = (programId: Address, index: bigint): Promise<Pda> =>
  getProgramDerivedAddress({
    programAddress: programId,
    seeds: [MARKET_INDEX_SEED, new Uint8Array(u64le.encode(index))],
  })

/** Per-market steward override PDA: ["steward", market_id]. */
export const findMarketStewardPda = (programId: Address, marketId: Hex32): Promise<Pda> =>
  getProgramDerivedAddress({ programAddress: programId, seeds: [MARKET_STEWARD_SEED, bytesFromHex32(marketId)] })

/** Per-market engine-state blob PDA: ["protocol", market_id]. */
export const findProtocolStatePda = (programId: Address, marketId: Hex32): Promise<Pda> =>
  getProgramDerivedAddress({ programAddress: programId, seeds: [PROTOCOL_SEED, bytesFromHex32(marketId)] })

/** Per-market USDC escrow token account PDA: ["escrow", market_id] (authority = protocol_state). */
export const findEscrowPda = (programId: Address, marketId: Hex32): Promise<Pda> =>
  getProgramDerivedAddress({ programAddress: programId, seeds: [ESCROW_SEED, bytesFromHex32(marketId)] })

/** Position-ownership PDA: ["position", token_id]. */
export const findPositionPda = (programId: Address, tokenId: Hex32): Promise<Pda> =>
  getProgramDerivedAddress({ programAddress: programId, seeds: [POSITION_SEED, bytesFromHex32(tokenId)] })

/** The caller's associated USDC token account (user_usdc in the money-moving flows). */
export const findUsdcAta = (owner: Address, usdcMint: Address): Promise<Pda> =>
  findAssociatedTokenPda({ owner, mint: usdcMint, tokenProgram: TOKEN_PROGRAM_ADDRESS })
