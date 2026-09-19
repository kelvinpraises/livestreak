//! Engine state — transliterated from streams.move STORAGE & TYPES.

use ruint::aliases::U256;
use serde::{Deserialize, Serialize};

extern crate alloc;
use alloc::collections::BTreeMap;
use alloc::vec::Vec;

pub const MAX_STREAMS_RECEIVERS: usize = 100;
pub const AMT_PER_SEC_MULTIPLIER: u128 = 1_000_000_000;

pub type AccountId = U256;

/// Registry state for one token. Move: StreamsRegistry<T> with flat tables.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamsRegistry {
    pub cycle_secs: u64,
    /// ceil(AMT_PER_SEC_MULTIPLIER / cycle_secs) — 1 token per cycle.
    pub min_amt_per_sec: U256,
    pub states: BTreeMap<AccountId, StreamsState>,
    /// (account_id, cycle) -> delta.
    pub amt_deltas: BTreeMap<(AccountId, u64), AmtDelta>,
    /// (account_id, sender_account_id, config_index) -> next squeezed timestamp.
    pub next_squeezed: BTreeMap<(AccountId, AccountId, u64), u64>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct StreamsState {
    pub streams_history_hash: Vec<u8>,
    pub streams_hash: Vec<u8>,
    pub next_receivable_cycle: u64,
    pub update_time: u64,
    pub max_end: u64,
    pub balance: u128,
    pub curr_cycle_configs: u64,
}

/// Cycle delta buckets. Move: AmtDelta { this_cycle: I128, next_cycle: I128 }.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AmtDelta {
    pub this_cycle: i128,
    pub next_cycle: i128,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct StreamReceiver {
    pub account_id: AccountId,
    pub config: StreamConfig,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct StreamConfig {
    pub stream_id: u64,
    pub amt_per_sec: U256,
    pub start: u64,
    pub duration: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StreamsHistory {
    pub streams_hash: Vec<u8>,
    pub receivers: Vec<StreamReceiver>,
    pub update_time: u64,
    pub max_end: u64,
}

/// Preprocessed config window for balance/max_end math.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProcessedConfig {
    pub amt_per_sec: U256,
    pub start: u64,
    pub end: u64,
}

/// Engine errors — same meanings as the Move abort codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamsError {
    TooManyReceivers,
    ReceiversNotSorted,
    AmtPerSecTooLow,
    CycleSecsTooLow,
    InvalidStreamsReceivers,
    InvalidStreamsHistory,
    EntryWithHashAndReceivers,
    TimestampBeforeUpdate,
    BalanceTooHigh,
}

pub type StreamsResult<T> = Result<T, StreamsError>;
