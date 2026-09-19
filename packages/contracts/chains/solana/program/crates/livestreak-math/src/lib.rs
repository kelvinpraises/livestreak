//! LiveStreak fixed-point math core for the Solana port.
//!
//! Anchor-free by design: the on-chain program consumes this crate, and `cargo test`
//! exercises it host-side against the same EVM golden vectors the Sui port carries.
//! Port sources: `chains/sui/sources/vault/bonding_board.move` + OZ contracts-sui
//! `math/fixed_point` rev v1.3.0 (the exact ln the Sui leg runs).

#![no_std]

pub mod bonding;
pub mod ln;
pub mod wide;
