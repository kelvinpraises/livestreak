use anchor_lang::prelude::*;

use crate::constants::{MARKET_SEED, MARKET_STEWARD_SEED, REGISTRY_SEED};
use crate::error::LivestreakError;
use crate::state::{Market, MarketSteward, Registry};

/// Only the current default steward may set a per-market override (mirrors the Move
/// set_market_steward gate). init_if_needed: overrides are upserts by design.
#[derive(Accounts)]
pub struct SetMarketSteward<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [REGISTRY_SEED],
        bump = registry.bump,
        constraint = registry.default_steward == authority.key() @ LivestreakError::NotCreator
    )]
    pub registry: Account<'info, Registry>,
    #[account(seeds = [MARKET_SEED, &market.market_id], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + MarketSteward::INIT_SPACE,
        seeds = [MARKET_STEWARD_SEED, &market.market_id],
        bump
    )]
    pub market_steward: Account<'info, MarketSteward>,
    pub system_program: Program<'info, System>,
}

pub fn handle_set_market_steward(ctx: Context<SetMarketSteward>, steward: Pubkey) -> Result<()> {
    let account = &mut ctx.accounts.market_steward;
    account.steward = steward;
    account.bump = ctx.bumps.market_steward;
    Ok(())
}
