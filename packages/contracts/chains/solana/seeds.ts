// PDA seed constants — must mirror programs/livestreak/src/{constants.rs,instructions/protocol.rs}.
// Pure data (browser-safe); derivation helpers live in @livestreak/wallet's solana barrel.
export const REGISTRY_SEED = "registry";
export const MARKET_SEED = "market";
export const MARKET_INDEX_SEED = "market_idx";
export const MARKET_STEWARD_SEED = "steward";
export const LVST_AUTHORITY_SEED = "lvst_authority";
export const LVST_ESCROW_SEED = "lvst_escrow";
export const PROTOCOL_SEED = "protocol";
export const ESCROW_SEED = "escrow";
export const POSITION_SEED = "position";

/** Blob layout: 8 discriminator + 32 market_id + 1 bump + 4 vec len, then the postcard payload. */
export const PROTOCOL_HEADER_LEN = 8 + 32 + 1 + 4;

// Stream lifecycle mirrors (market_registry.move parity).
export const STREAM_STATUS = { none: 0, live: 1, ended: 2 } as const;
export const POINTER_SCHEME = {
  walrusTestnet: 0,
  walrusMainnet: 1,
  ipfs: 2,
  arweave: 3,
} as const;
export const STREAM_LOCK_GRACE_SECS = 86_400;

export const SIDE_YES = 0;
export const SIDE_NO = 1;
