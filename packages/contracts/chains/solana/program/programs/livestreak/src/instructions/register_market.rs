use anchor_lang::prelude::*;
use solana_keccak_hasher as keccak;

use crate::constants::{
    MARKET_INDEX_SEED, MARKET_SEED, MAX_STREAM_ID_LEN, MAX_TITLE_LEN, REGISTRY_SEED,
    STREAM_STATUS_NONE,
};
use crate::error::LivestreakError;
use crate::state::{Market, MarketIndex, Registry};

/// market_id = keccak256(creator ++ stream_id) — mirrors Move compute_market_id
/// (bcs(observer) is the 32 address bytes there; here the raw pubkey bytes).
pub fn compute_market_id(creator: &Pubkey, stream_id: &[u8]) -> [u8; 32] {
    keccak::hashv(&[creator.as_ref(), stream_id]).to_bytes()
}

#[derive(Accounts)]
#[instruction(title: Vec<u8>, stream_id: Vec<u8>)]
pub struct RegisterMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut, seeds = [REGISTRY_SEED], bump = registry.bump)]
    pub registry: Account<'info, Registry>,
    // init (not init_if_needed): a duplicate registration fails at the runtime level —
    // the E_MARKET_EXISTS assert is structural here.
    #[account(
        init,
        payer = creator,
        space = 8 + Market::INIT_SPACE,
        seeds = [MARKET_SEED, &compute_market_id(creator.key, &stream_id)],
        bump
    )]
    pub market: Account<'info, Market>,
    #[account(
        init,
        payer = creator,
        space = 8 + MarketIndex::INIT_SPACE,
        seeds = [MARKET_INDEX_SEED, &registry.market_count.to_le_bytes()],
        bump
    )]
    pub market_index: Account<'info, MarketIndex>,
    pub system_program: Program<'info, System>,
}

pub fn handle_register_market(ctx: Context<RegisterMarket>, title: Vec<u8>, stream_id: Vec<u8>) -> Result<()> {
    require!(!title.is_empty(), LivestreakError::EmptyTitle);
    require!(title.len() <= MAX_TITLE_LEN, LivestreakError::InputTooLong);
    require!(!stream_id.is_empty(), LivestreakError::ZeroStreamId);
    require!(stream_id.len() <= MAX_STREAM_ID_LEN, LivestreakError::InputTooLong);

    let market_id = compute_market_id(ctx.accounts.creator.key, &stream_id);
    let now = Clock::get()?.unix_timestamp;

    let market = &mut ctx.accounts.market;
    market.market_id = market_id;
    market.creator = ctx.accounts.creator.key();
    market.title = title;
    market.stream_id = stream_id;
    market.created_at = now;
    market.stream_status = STREAM_STATUS_NONE;
    market.stream_pointer = Vec::new();
    market.bump = ctx.bumps.market;

    let index = &mut ctx.accounts.market_index;
    index.market_id = market_id;
    index.bump = ctx.bumps.market_index;

    ctx.accounts.registry.market_count += 1;
    Ok(())
}
