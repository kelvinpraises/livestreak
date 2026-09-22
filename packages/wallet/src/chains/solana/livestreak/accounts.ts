// Account decoders for the non-ProtocolState accounts (ProtocolState carries a postcard
// engine blob — decode it via @livestreak/contracts/solana's EngineView/decodeProtocolState).
// Layouts mirror the IDL `types`; each decoder validates the 8-byte account discriminator
// (also from the IDL) before decoding the borsh body.
import {
  addDecoderSizePrefix,
  fixDecoderSize,
  getAddressDecoder,
  getBytesDecoder,
  getI64Decoder,
  getStructDecoder,
  getU32Decoder,
  getU64Decoder,
  getU8Decoder,
  type Address,
  type ReadonlyUint8Array,
} from '@solana/kit'
import { livestreakIdl } from '@livestreak/contracts/solana'

import { hex32FromBytes, type Hex32 } from './ids.js'

type AccountName = (typeof livestreakIdl.accounts)[number]['name']

const ACCOUNT_DISCRIMINATORS: Record<string, Uint8Array> = Object.fromEntries(
  livestreakIdl.accounts.map((a) => [a.name, Uint8Array.from(a.discriminator)]),
)

/** The 8-byte anchor discriminator for an account, straight from the IDL. */
export const accountDiscriminator = (name: AccountName): Uint8Array => ACCOUNT_DISCRIMINATORS[name]

const id32 = fixDecoderSize(getBytesDecoder(), 32) // [u8; 32] fixed array
const vecBytes = addDecoderSizePrefix(getBytesDecoder(), getU32Decoder()) // Vec<u8>

function stripDiscriminator(name: AccountName, data: Uint8Array): Uint8Array {
  const expected = accountDiscriminator(name)
  const actual = data.subarray(0, 8)
  for (let i = 0; i < 8; i++) {
    if (actual[i] !== expected[i]) throw new Error(`account discriminator mismatch: not a ${name} account`)
  }
  return data.subarray(8)
}

// ── typed account shapes ──────────────────────────────────────────────────────────

export interface RegistryAccount {
  marketCount: bigint
  defaultSteward: Address
  bump: number
  lvstMint: Address
}
export interface MarketAccount {
  marketId: Hex32
  creator: Address
  title: Uint8Array
  streamId: Uint8Array
  createdAt: bigint
  streamStatus: number
  streamScheme: number
  streamPointer: Uint8Array
  streamUpdatedAt: bigint
  streamEndedAt: bigint
  bump: number
}
export interface MarketIndexAccount {
  marketId: Hex32
  bump: number
}
export interface MarketStewardAccount {
  steward: Address
  bump: number
}
export interface PositionOwnerAccount {
  tokenId: Hex32
  owner: Address
  /** The market this position was minted for — lets a reader attribute a still-laneless position. */
  marketId: Hex32
  bump: number
}

// ── raw borsh decoders (body only, in IDL field order) ────────────────────────────

const registryBody = getStructDecoder([
  ['marketCount', getU64Decoder()],
  ['defaultSteward', getAddressDecoder()],
  ['bump', getU8Decoder()],
  // lvst_mint is appended last in the account (keeps the older field offsets stable).
  ['lvstMint', getAddressDecoder()],
])

const marketBody = getStructDecoder([
  ['marketId', id32],
  ['creator', getAddressDecoder()],
  ['title', vecBytes],
  ['streamId', vecBytes],
  ['createdAt', getI64Decoder()],
  ['streamStatus', getU8Decoder()],
  ['streamScheme', getU8Decoder()],
  ['streamPointer', vecBytes],
  ['streamUpdatedAt', getI64Decoder()],
  ['streamEndedAt', getI64Decoder()],
  ['bump', getU8Decoder()],
])

const marketIndexBody = getStructDecoder([
  ['marketId', id32],
  ['bump', getU8Decoder()],
])

const marketStewardBody = getStructDecoder([
  ['steward', getAddressDecoder()],
  ['bump', getU8Decoder()],
])

const positionOwnerBody = getStructDecoder([
  ['tokenId', id32],
  ['owner', getAddressDecoder()],
  ['marketId', id32],
  ['bump', getU8Decoder()],
])

const asBytes = (b: ReadonlyUint8Array): Uint8Array => new Uint8Array(b)

// ── public decoders ───────────────────────────────────────────────────────────────

export function decodeRegistryAccount(data: Uint8Array): RegistryAccount {
  return registryBody.decode(stripDiscriminator('Registry', data))
}

export function decodeMarketAccount(data: Uint8Array): MarketAccount {
  const raw = marketBody.decode(stripDiscriminator('Market', data))
  return {
    ...raw,
    marketId: hex32FromBytes(asBytes(raw.marketId)),
    title: asBytes(raw.title),
    streamId: asBytes(raw.streamId),
    streamPointer: asBytes(raw.streamPointer),
  }
}

export function decodeMarketIndexAccount(data: Uint8Array): MarketIndexAccount {
  const raw = marketIndexBody.decode(stripDiscriminator('MarketIndex', data))
  return { marketId: hex32FromBytes(asBytes(raw.marketId)), bump: raw.bump }
}

export function decodeMarketStewardAccount(data: Uint8Array): MarketStewardAccount {
  return marketStewardBody.decode(stripDiscriminator('MarketSteward', data))
}

export function decodePositionOwnerAccount(data: Uint8Array): PositionOwnerAccount {
  const raw = positionOwnerBody.decode(stripDiscriminator('PositionOwner', data))
  return {
    tokenId: hex32FromBytes(asBytes(raw.tokenId)),
    owner: raw.owner,
    marketId: hex32FromBytes(asBytes(raw.marketId)),
    bump: raw.bump,
  }
}
