use anchor_lang::prelude::*;

use crate::constants::{
    MARKET_SEED, MAX_POINTER_LEN, SCHEME_ARWEAVE, SCHEME_IPFS, SCHEME_WALRUS_MAINNET,
    SCHEME_WALRUS_TESTNET, STREAM_LOCK_GRACE, STREAM_STATUS_ENDED, STREAM_STATUS_LIVE,
    STREAM_STATUS_NONE,
};
use crate::error::LivestreakError;
use crate::state::Market;

#[derive(Accounts)]
pub struct StreamLifecycle<'info> {
    pub creator: Signer<'info>,
    #[account(
        mut,
        seeds = [MARKET_SEED, &market.market_id],
        bump = market.bump,
        has_one = creator @ LivestreakError::NotCreator
    )]
    pub market: Account<'info, Market>,
}

fn validate_pointer(scheme: u8, pointer: &[u8]) -> Result<()> {
    require!(
        !pointer.is_empty() && pointer.len() <= MAX_POINTER_LEN,
        LivestreakError::InputTooLong
    );
    require!(
        matches!(
            scheme,
            SCHEME_WALRUS_TESTNET | SCHEME_WALRUS_MAINNET | SCHEME_IPFS | SCHEME_ARWEAVE
        ),
        LivestreakError::BadScheme
    );
    Ok(())
}

pub fn handle_go_live(ctx: Context<StreamLifecycle>, scheme: u8, pointer: Vec<u8>) -> Result<()> {
    validate_pointer(scheme, &pointer)?;
    let market = &mut ctx.accounts.market;
    require!(
        market.stream_status != STREAM_STATUS_ENDED,
        LivestreakError::StreamEnded
    );
    market.stream_status = STREAM_STATUS_LIVE;
    market.stream_scheme = scheme;
    market.stream_pointer = pointer;
    market.stream_updated_at = Clock::get()?.unix_timestamp;
    Ok(())
}

pub fn handle_set_ended(ctx: Context<StreamLifecycle>, scheme: u8, pointer: Vec<u8>) -> Result<()> {
    validate_pointer(scheme, &pointer)?;
    let market = &mut ctx.accounts.market;
    require!(
        market.stream_status != STREAM_STATUS_NONE,
        LivestreakError::NotLive
    );

    let now = Clock::get()?.unix_timestamp;
    // Evidence lock: once ended + grace elapsed, the pointer is frozen (Move stream_is_locked).
    if market.stream_status == STREAM_STATUS_ENDED {
        require!(
            now <= market.stream_ended_at + STREAM_LOCK_GRACE,
            LivestreakError::StreamLocked
        );
    } else {
        market.stream_status = STREAM_STATUS_ENDED;
        market.stream_ended_at = now;
    }
    market.stream_scheme = scheme;
    market.stream_pointer = pointer;
    market.stream_updated_at = now;
    Ok(())
}
