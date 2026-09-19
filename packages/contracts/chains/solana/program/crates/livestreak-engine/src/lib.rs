//! Streams cycle engine — 1:1 port of `chains/sui/sources/streaming/streams.move`.
//!
//! Pure logic, no Anchor: storage is BTreeMaps mirroring the Move flat tables, so the
//! conservation-invariant suite (the spec) runs as plain `cargo test`. The on-chain
//! program adapts this state onto PDAs in a later phase; the engine semantics are
//! frozen here first.
//!
//! Width doctrine (context/solana-port-strategy.md §5): account ids and rates stay
//! U256 inside the engine — 1:1 with the Move u256 expressions. Cycle deltas are
//! native i128 (i128.move has no Rust counterpart). The program layer owns the
//! [u8;32] id encoding; the engine does not care what the 32 bytes mean.

pub mod drips;
pub mod drivers;
pub mod vault;
pub mod state;
pub mod treasury;
pub mod streams;

pub use drips::*;
pub use drivers::*;
pub use vault::*;
pub use state::*;
pub use treasury::*;
pub use streams::*;
