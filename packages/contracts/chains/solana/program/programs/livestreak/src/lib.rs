//! LiveStreak on Solana. Ported from the Sui Move sources (chains/sui/sources) —
//! Move already de-EVM'd the design, so parity claims trace to Move first, EVM second.
//!
//! Phase 1: market registry (register/enumerate/stream-lifecycle) + steward config.
//! Hot/dispute/resolve land in Phase 2 with the vault module (they gate on the
//! vault -> market link, which does not exist until vaults do).

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("CZnAfgbnbVtuXDRQynwL9XMHqeQ7wngbodRihGLbErK8");

#[program]
pub mod livestreak {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, default_steward: Pubkey) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, default_steward)
    }

    pub fn register_market(
        ctx: Context<RegisterMarket>,
        title: Vec<u8>,
        stream_id: Vec<u8>,
    ) -> Result<()> {
        instructions::register_market::handle_register_market(ctx, title, stream_id)
    }

    pub fn go_live(ctx: Context<StreamLifecycle>, scheme: u8, pointer: Vec<u8>) -> Result<()> {
        instructions::stream_lifecycle::handle_go_live(ctx, scheme, pointer)
    }

    pub fn set_ended(ctx: Context<StreamLifecycle>, scheme: u8, pointer: Vec<u8>) -> Result<()> {
        instructions::stream_lifecycle::handle_set_ended(ctx, scheme, pointer)
    }

    pub fn set_market_steward(ctx: Context<SetMarketSteward>, steward: Pubkey) -> Result<()> {
        instructions::steward::handle_set_market_steward(ctx, steward)
    }

    pub fn init_protocol(ctx: Context<InitProtocol>, capacity: u16) -> Result<()> {
        instructions::protocol::handle_init_protocol(ctx, capacity)
    }

    pub fn create_vault_seeded(
        ctx: Context<UserEngineOp>,
        question: Vec<u8>,
        seed_side: u8,
        rate: u64,
        deposit: u64,
    ) -> Result<Vec<u8>> {
        instructions::protocol::handle_create_vault_seeded(ctx, question, seed_side, rate, deposit)
    }

    pub fn mint_position(ctx: Context<MintPosition>, salt: u64) -> Result<()> {
        instructions::protocol::handle_mint_position(ctx, salt)
    }

    pub fn fund(
        ctx: Context<PositionEngineOp>,
        vault_id: [u8; 32],
        side: u8,
        rate: u64,
        deposit: u64,
    ) -> Result<()> {
        instructions::protocol::handle_fund(ctx, vault_id, side, rate, deposit)
    }

    pub fn stop_all(ctx: Context<PositionEngineOp>) -> Result<()> {
        instructions::protocol::handle_stop_all(ctx)
    }

    pub fn withdraw(ctx: Context<PositionEngineOp>, vault_id: [u8; 32]) -> Result<()> {
        instructions::protocol::handle_withdraw(ctx, vault_id)
    }

    pub fn stop_seed(ctx: Context<UserEngineOp>, vault_id: [u8; 32]) -> Result<()> {
        instructions::protocol::handle_stop_seed(ctx, vault_id)
    }

    pub fn withdraw_seed(ctx: Context<UserEngineOp>, vault_id: [u8; 32]) -> Result<()> {
        instructions::protocol::handle_withdraw_seed(ctx, vault_id)
    }

    pub fn advance(ctx: Context<EngineOp>, vault_id: [u8; 32], side: u8, max_steps: u64) -> Result<()> {
        instructions::protocol::handle_advance(ctx, vault_id, side, max_steps)
    }

    pub fn collect(ctx: Context<EngineOp>, vault_id: [u8; 32]) -> Result<()> {
        instructions::protocol::handle_collect(ctx, vault_id)
    }

    pub fn resolve(ctx: Context<Resolve>, vault_id: [u8; 32], winning_side: u8) -> Result<()> {
        instructions::protocol::handle_resolve(ctx, vault_id, winning_side)
    }
}
