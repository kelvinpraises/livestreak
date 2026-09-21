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

// The default SBF allocator is a BUMP allocator: nothing is ever freed, so every postcard
// decode/encode temporary and BTreeMap node stays allocated for the whole transaction. Engine
// ops churn far more than they retain — live state is small, transient churn is not — so a
// freeing (first-fit linked-list) allocator over the full 256KB heap frame is what makes
// engine instructions viable at all (and lets ops repeat within one tx). Clients MUST pair
// this with ComputeBudget::RequestHeapFrame(256KB) — buildLivestreakTransaction and the
// litesvm harness both do; a default 32KB frame would fault past the mapped region.
#[cfg(target_os = "solana")]
mod allocator {
    use core::alloc::{GlobalAlloc, Layout};
    use core::{mem, ptr};
    use linked_list_allocator::Heap;

    const HEAP_START: usize = 0x3_0000_0000;
    const HEAP_LEN: usize = 256 * 1024;
    const MAGIC: usize = 0x11FE_57AE;

    // The control block lives INSIDE the heap region (Solana's own bump allocator does the same):
    // program .bss/.data statics get GC'd by the SBF linker, and the heap region arrives zeroed,
    // so a magic word doubles as the once-init flag.
    unsafe fn heap() -> &'static mut Heap {
        let flag = HEAP_START as *mut usize;
        let control = (HEAP_START + mem::size_of::<usize>()) as *mut Heap;
        if *flag != MAGIC {
            ptr::write(control, Heap::empty());
            let data = HEAP_START + mem::size_of::<usize>() + mem::size_of::<Heap>();
            let data = (data + 15) & !15;
            (*control).init(data as *mut u8, HEAP_LEN - (data - HEAP_START));
            *flag = MAGIC;
        }
        &mut *control
    }

    struct FreeingHeap;

    unsafe impl GlobalAlloc for FreeingHeap {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            heap()
                .allocate_first_fit(layout)
                .map(|p| p.as_ptr())
                .unwrap_or(ptr::null_mut())
        }
        unsafe fn dealloc(&self, ptr_: *mut u8, layout: Layout) {
            heap().deallocate(ptr::NonNull::new_unchecked(ptr_), layout)
        }
    }

    #[global_allocator]
    static ALLOCATOR: FreeingHeap = FreeingHeap;
}

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("CZnAfgbnbVtuXDRQynwL9XMHqeQ7wngbodRihGLbErK8");

#[program]
pub mod livestreak {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        default_steward: Pubkey,
        lvst_mint: Pubkey,
    ) -> Result<()> {
        instructions::initialize::handle_initialize(ctx, default_steward, lvst_mint)
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

    pub fn set_default_steward(ctx: Context<SetDefaultSteward>, steward: Pubkey) -> Result<()> {
        instructions::steward::handle_set_default_steward(ctx, steward)
    }

    pub fn init_protocol(ctx: Context<InitProtocol>, capacity: u16) -> Result<()> {
        instructions::protocol::handle_init_protocol(ctx, capacity)
    }

    pub fn grow_protocol(ctx: Context<GrowProtocol>) -> Result<()> {
        instructions::protocol::handle_grow_protocol(ctx)
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

    pub fn transfer_position(ctx: Context<TransferPosition>, new_owner: Pubkey) -> Result<()> {
        instructions::protocol::handle_transfer_position(ctx, new_owner)
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

    pub fn stop_funding(ctx: Context<PositionStateOp>, vault_id: [u8; 32], side: u8) -> Result<()> {
        instructions::protocol::handle_stop_funding(ctx, vault_id, side)
    }

    pub fn set_lanes(
        ctx: Context<PositionEngineOp>,
        lanes: Vec<LaneArg>,
        add_deposit: u64,
    ) -> Result<()> {
        instructions::protocol::handle_set_lanes(ctx, lanes, add_deposit)
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

    pub fn claim_loss_lvst(ctx: Context<ClaimLossLvst>, vault_id: [u8; 32], side: u8) -> Result<()> {
        instructions::protocol::handle_claim_loss_lvst(ctx, vault_id, side)
    }

    pub fn stake_lvst(ctx: Context<StakeLvst>, amount: u64) -> Result<()> {
        instructions::protocol::handle_stake_lvst(ctx, amount)
    }

    pub fn unstake_lvst(ctx: Context<UnstakeLvst>, amount: u64) -> Result<()> {
        instructions::protocol::handle_unstake_lvst(ctx, amount)
    }

    pub fn claim_dividends(ctx: Context<ClaimDividends>) -> Result<()> {
        instructions::protocol::handle_claim_dividends(ctx)
    }
}
