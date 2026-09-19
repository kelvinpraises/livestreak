// PDA seeds.
pub const REGISTRY_SEED: &[u8] = b"registry";
pub const MARKET_SEED: &[u8] = b"market";
pub const MARKET_INDEX_SEED: &[u8] = b"market_idx";
pub const MARKET_STEWARD_SEED: &[u8] = b"steward";

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
