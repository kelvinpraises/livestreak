// Opaque 32-byte id plumbing for the livestreak program. Every id (market_id, vault_id,
// token_id) is a 0x-hex 32-byte value on every chain; these helpers bridge that to the
// raw seed/codec bytes and reproduce the program's two client-derivable ids.
import { getAddressEncoder, getU64Encoder, type Address } from '@solana/kit'
import { keccak_256 } from '@noble/hashes/sha3.js'

/** A 0x-prefixed 64-hex-char string — the cross-chain opaque 32-byte id shape. */
export type Hex32 = string

const addressEncoder = getAddressEncoder()
const u64le = getU64Encoder()
const textEncoder = new TextEncoder()

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

/** 0x-hex (32 bytes) -> raw 32-byte array for seeds/codecs. */
export function bytesFromHex32(hex: Hex32): Uint8Array {
  const raw = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
  if (raw.length !== 64) {
    throw new Error(`expected a 32-byte hex id (64 hex chars), got ${raw.length}`)
  }
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    const byte = Number.parseInt(raw.slice(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) throw new Error(`invalid hex in id: ${hex}`)
    out[i] = byte
  }
  return out
}

/** raw 32-byte array -> 0x-hex. */
export function hex32FromBytes(bytes: Uint8Array): Hex32 {
  if (bytes.length !== 32) throw new Error(`expected 32 bytes, got ${bytes.length}`)
  let s = '0x'
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

const pubkeyBytes = (a: Address): Uint8Array => new Uint8Array(addressEncoder.encode(a))

/**
 * market_id = keccak256(creator_pubkey ++ stream_id) — mirrors
 * register_market::compute_market_id (the raw pubkey bytes stand in for the Move
 * observer address). The register_market builder derives the market PDA from this.
 */
export function computeMarketId(creator: Address, streamId: Uint8Array): Hex32 {
  return hex32FromBytes(keccak_256(concatBytes(pubkeyBytes(creator), streamId)))
}

/**
 * token_id = keccak256("livestreak.pos" ++ minter ++ salt_le) — mirrors
 * Protocol::calc_token_id_with_salt. mint_position derives the position PDA from
 * this, and the same id is passed to fund/withdraw/stopAll afterwards.
 */
export function computePositionTokenId(minter: Address, salt: bigint): Hex32 {
  return hex32FromBytes(
    keccak_256(
      concatBytes(textEncoder.encode('livestreak.pos'), pubkeyBytes(minter), new Uint8Array(u64le.encode(salt))),
    ),
  )
}
