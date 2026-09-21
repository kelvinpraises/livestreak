// PDA seeds.
pub const REGISTRY_SEED: &[u8] = b"registry";
pub const MARKET_SEED: &[u8] = b"market";
pub const MARKET_INDEX_SEED: &[u8] = b"market_idx";
pub const MARKET_STEWARD_SEED: &[u8] = b"steward";
// Protocol-wide LVST reward-token mint authority — one PDA across all markets
// (LVST is a single token; loss-mint + staking dividends land in later chunks).
pub const LVST_AUTHORITY_SEED: &[u8] = b"lvst_authority";
// Per-market LVST staking escrow token account. The staking ledger (TreasuryRegistry)
// lives inside each market's Protocol blob, so staked-LVST custody is per-market too:
// one escrow at ["lvst_escrow", market_id], authority = that market's protocol_state.
pub const LVST_ESCROW_SEED: &[u8] = b"lvst_escrow";

// Stream status (mirrors market_registry.move).
pub const STREAM_STATUS_NONE: u8 = 0;
pub const STREAM_STATUS_LIVE: u8 = 1;
pub const STREAM_STATUS_ENDED: u8 = 2;

// Storage pointer schemes (mirrors market_registry.move).
pub const SCHEME_WALRUS_TESTNET: u8 = 0;
pub const SCHEME_WALRUS_MAINNET: u8 = 1;
pub const SCHEME_IPFS: u8 = 2;
pub const SCHEME_ARWEAVE: u8 = 3;

// setEnded is refused this many seconds after the stream ended (evidence lock).
pub const STREAM_LOCK_GRACE: i64 = 86_400;

pub const MAX_TITLE_LEN: usize = 200;
pub const MAX_STREAM_ID_LEN: usize = 64;
pub const MAX_POINTER_LEN: usize = 64;

// Hard ceiling on a market's ProtocolState blob payload (excludes PROTOCOL_HEADER).
// InitProtocol caps the initial account at ~10_240 bytes (a CPI-created account cannot
// exceed MAX_PERMITTED_DATA_INCREASE); grow_protocol then reallocs one 10_240-byte rung
// at a time up to PROTOCOL_HEADER + this cap. Bounded so a runaway market cannot rent-drain
// the payer topping up each grow. 10 rungs (~102_400 bytes) before Phase-4 sharding supersedes.
pub const MAX_PROTOCOL_BYTES: usize = 10 * 10_240;
