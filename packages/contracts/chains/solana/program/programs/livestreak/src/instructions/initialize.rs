use anchor_lang::prelude::*;

use crate::constants::REGISTRY_SEED;
use crate::state::Registry;

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Registry::INIT_SPACE,
        seeds = [REGISTRY_SEED],
        bump
    )]
    pub registry: Account<'info, Registry>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(
    ctx: Context<Initialize>,
    default_steward: Pubkey,
    lvst_mint: Pubkey,
) -> Result<()> {
    let registry = &mut ctx.accounts.registry;
    registry.market_count = 0;
    registry.default_steward = default_steward;
    registry.bump = ctx.bumps.registry;
    registry.lvst_mint = lvst_mint;
    Ok(())
}
