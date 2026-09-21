//! Vault/board/position core — 1:1 port of `chains/sui/sources/vault/vault.move`.
//! Pure logic over BTreeMaps; `usdc_held` models the registry's Balance<T> the way
//! drips models its Coin vault. Events are the program layer's job.

use ruint::aliases::U256;
use serde::{Deserialize, Serialize};

extern crate alloc;
use alloc::collections::BTreeMap;
use alloc::vec::Vec;

use crate::state::AccountId;

pub const MAX_STEPS: u64 = 64;
pub const BPS_DENOM: u128 = 10_000;
pub const UNLIMITED_STEPS: u64 = 1_000_000;

/// Ceiling on the boundary-pops an *implicit* catch-up (the fund / stop / refresh /
/// collect / withdraw paths that touch a vault) will replay in a single instruction
/// before bailing out with [`VaultError::BoardBehind`]. The explicit
/// permissionless `advance(vault_id, side, max_steps)` entrypoint is the *uncapped*
/// drain: a caller that hits this error advances the backlog down with repeated
/// bounded `advance` calls, then retries the op.
///
/// Unit of work: a "step" here is one boundary-pop in `advance_internal` — one
/// scheduled funder `max_end` settled, each *live* one costing a `seg_math`
/// (the ~59-iteration u128 `ln` kernel + U256 curve/settle math, the dominant per-op
/// CU term). Elapsed wall-clock time is NOT a step: a board with no pending
/// boundaries catches up in one tail `seg_math` no matter how many hours it idled, so
/// the runaway cost the Phase-3 OOMs hit is the *count of elapsed funder boundaries*,
/// not the number of 10s cycles.
///
/// Value = `MAX_STEPS` (64): exactly one `advance_internal` batch. That batch size is
/// the CU envelope the engine already trusts to fit one instruction (it is the
/// per-call cap `advance_internal`/`settle` run under today, proven green on real
/// sbpf-v3), so an implicit catch-up bounded to a single batch per side inherits that
/// proven envelope rather than inventing a new CU assumption. `collect`/`withdraw`
/// touch both sides, i.e. at most two batches per instruction — still a small
/// multiple of one proven-safe `advance_internal`, comfortably inside the 1.4M CU /
/// 256KB heap ceiling alongside state (de)serialization and the receiver harvest.
/// Realistic markets settle with single- to low-double-digit elapsed boundaries per
/// side (the existing suites warp 60–120s with a handful of funders → a few
/// boundaries), so 64 clears every normal test/demo with margin and only a
/// pathological market with dozens+ of elapsed funder boundaries on one side trips it.
pub const MAX_IMPLICIT_CATCHUP_STEPS: u64 = MAX_STEPS;

pub const STATUS_OPEN: u8 = 0;
pub const STATUS_LOCKED: u8 = 2;
pub const STATUS_RESOLVED: u8 = 3;

pub const OUTCOME_PENDING: u8 = 0;
pub const OUTCOME_YES: u8 = 1;
pub const OUTCOME_NO: u8 = 2;

pub type VaultId = [u8; 32];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultError {
    EmptyQuestion,
    ZeroCreator,
    UnknownVault,
    NotOpen,
    ZeroRate,
    AlreadyFunding,
    LengthMismatch,
    NotResolvable,
    NotResolved,
    BoardBehind,
    DivZero,
    InsufficientUsdc,
}

pub type VaultResult<T> = Result<T, VaultError>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VaultData {
    pub id: VaultId,
    pub market_id: [u8; 32],
    pub question: Vec<u8>,
    pub creator: [u8; 32],
    pub status: u8,
    pub outcome: u8,
    pub resolved_at: u64,
    pub exists: bool,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Board {
    pub pool: U256,
    pub side_rate: U256,
    pub g: U256,
    pub last_advance: u64,
    pub side_shares: U256,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Position {
    pub rate: U256,
    pub g_paid: U256,
    pub shares_accrued: U256,
    pub max_end: u64,
    pub depleted: bool,
    pub fund_start: u64,
    pub lost_usdc: U256,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Boundary {
    pub max_end: u64,
    pub account: AccountId,
}

/// Registry state (Move VaultRegistry<T>, flat tables -> maps).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VaultRegistry {
    /// Balance<T> the registry actually holds (program layer binds to escrow ATA).
    pub usdc_held: u128,
    pub treasury_set: bool,
    pub nonce: u64,
    pub vaults: BTreeMap<VaultId, VaultData>,
    pub boards: BTreeMap<(VaultId, u8), Board>,
    pub positions: BTreeMap<(VaultId, u8, AccountId), Position>,
    pub boundaries: BTreeMap<(VaultId, u8), Vec<Boundary>>,
    pub boundary_heads: BTreeMap<(VaultId, u8), u64>,
    pub pot: BTreeMap<VaultId, U256>,
    pub collected: BTreeMap<VaultId, bool>,
    pub claimed: BTreeMap<(VaultId, u8, AccountId), bool>,
    pub overage_owed: BTreeMap<(VaultId, u8, AccountId), U256>,
    pub overage_paid: BTreeMap<(VaultId, u8, AccountId), U256>,
    pub account_vaults: BTreeMap<AccountId, Vec<VaultId>>,
    pub account_in_vault: BTreeMap<(AccountId, VaultId), bool>,
    pub skim_owed: BTreeMap<VaultId, U256>,
}

pub const SIDE_YES: u8 = 0;
pub const SIDE_NO: u8 = 1;

pub fn assert_valid_side(side: u8) -> VaultResult<()> {
    if side == SIDE_YES || side == SIDE_NO {
        Ok(())
    } else {
        Err(VaultError::NotOpen) // Move aborts E_INVALID_SIDE in the side module
    }
}

fn full_mul_div(a: U256, b: U256, denom: U256) -> U256 {
    // Move full_mul_div over u256 — direct in U256 (wide-by-default).
    a * b / denom
}

impl VaultRegistry {
    pub fn vault_exists(&self, vault_id: &VaultId) -> bool {
        self.vaults.get(vault_id).map(|v| v.exists).unwrap_or(false)
    }

    pub fn market_id(&self, vault_id: &VaultId) -> VaultResult<[u8; 32]> {
        if !self.vault_exists(vault_id) {
            return Err(VaultError::UnknownVault);
        }
        Ok(self.vaults.get(vault_id).unwrap().market_id)
    }

    pub fn get_vault(&self, vault_id: &VaultId) -> VaultResult<VaultData> {
        if !self.vault_exists(vault_id) {
            return Err(VaultError::UnknownVault);
        }
        Ok(self.vaults.get(vault_id).unwrap().clone())
    }

    /// Append-only share ledger: every vault the account ever funded.
    pub fn get_account_vault_ids(&self, account: AccountId) -> Vec<VaultId> {
        self.account_vaults.get(&account).cloned().unwrap_or_default()
    }

    pub fn pot(&self, vault_id: &VaultId) -> U256 {
        self.pot.get(vault_id).copied().unwrap_or(U256::ZERO)
    }

    pub fn get_position(
        &self,
        vault_id: &VaultId,
        side: u8,
        account: AccountId,
    ) -> (U256, U256, U256, u64, bool, u64, U256) {
        match self.positions.get(&(*vault_id, side, account)) {
            None => (U256::ZERO, U256::ZERO, U256::ZERO, 0, false, 0, U256::ZERO),
            Some(p) => (
                p.rate, p.g_paid, p.shares_accrued, p.max_end, p.depleted, p.fund_start,
                p.lost_usdc,
            ),
        }
    }

    pub fn get_board(&self, vault_id: &VaultId, side: u8) -> (U256, U256, U256, u64) {
        match self.boards.get(&(*vault_id, side)) {
            None => (U256::ZERO, U256::ZERO, U256::ZERO, 0),
            Some(b) => (b.pool, b.side_rate, b.g, b.last_advance),
        }
    }

    pub fn pending_boundaries(&self, vault_id: &VaultId, side: u8) -> u64 {
        let key = (*vault_id, side);
        let Some(list) = self.boundaries.get(&key) else {
            return 0;
        };
        let head = self.boundary_heads.get(&key).copied().unwrap_or(0);
        list.len() as u64 - head
    }

    /// Unsettled funder depletion schedule: (max_ends, rates) of still-active streams,
    /// same validity gate advance/preview use — rates sum to side_rate.
    pub fn get_boundaries(&self, vault_id: &VaultId, side: u8) -> (Vec<u64>, Vec<U256>) {
        let key = (*vault_id, side);
        let mut max_ends = Vec::new();
        let mut rates = Vec::new();
        let Some(list) = self.boundaries.get(&key) else {
            return (max_ends, rates);
        };
        let head = self.boundary_heads.get(&key).copied().unwrap_or(0) as usize;
        for boundary in list.iter().skip(head) {
            if let Some(p) = self.positions.get(&(*vault_id, side, boundary.account)) {
                if p.rate > U256::ZERO && !p.depleted && p.max_end == boundary.max_end {
                    max_ends.push(boundary.max_end);
                    rates.push(p.rate);
                }
            }
        }
        (max_ends, rates)
    }

    pub fn get_vault_pools(&self, vault_id: &VaultId) -> VaultResult<(U256, U256, U256, U256)> {
        if !self.vault_exists(vault_id) {
            return Err(VaultError::UnknownVault);
        }
        let wad = U256::from(livestreak_math::bonding::WAD);
        let (yes_pool, ..) = self.get_board(vault_id, SIDE_YES);
        let (no_pool, ..) = self.get_board(vault_id, SIDE_NO);
        let yes_shares = self.boards.get(&(*vault_id, SIDE_YES)).map(|b| b.side_shares).unwrap_or_default() / wad;
        let no_shares = self.boards.get(&(*vault_id, SIDE_NO)).map(|b| b.side_shares).unwrap_or_default() / wad;
        Ok((yes_pool, no_pool, yes_shares, no_shares))
    }

    pub fn loss_claimable(&self, account: AccountId, vault_id: &VaultId, side: u8) -> U256 {
        if !self.vault_exists(vault_id) {
            return U256::ZERO;
        }
        let data = self.vaults.get(vault_id).unwrap();
        if data.status != STATUS_RESOLVED {
            return U256::ZERO;
        }
        let winning = if data.outcome == OUTCOME_YES { SIDE_YES } else { SIDE_NO };
        if side == winning {
            return U256::ZERO;
        }
        match self.positions.get(&(*vault_id, side, account)) {
            None => U256::ZERO,
            Some(p) => loss_usdc(p, data.resolved_at),
        }
    }

    /// Preview of withdraw's payout: 0 until resolved AND collected; 0 for losers,
    /// non-funders, or already-claimed positions.
    pub fn claimable(&self, account: AccountId, vault_id: &VaultId, side: u8) -> U256 {
        if !self.vault_exists(vault_id) {
            return U256::ZERO;
        }
        let data = self.vaults.get(vault_id).unwrap();
        if data.status != STATUS_RESOLVED {
            return U256::ZERO;
        }
        if !self.collected.get(vault_id).copied().unwrap_or(false) {
            return U256::ZERO;
        }
        let winning = if data.outcome == OUTCOME_YES { SIDE_YES } else { SIDE_NO };
        if side != winning {
            return U256::ZERO;
        }
        let claim_key = (*vault_id, side, account);
        if self.claimed.get(&claim_key).copied().unwrap_or(false) {
            return U256::ZERO;
        }
        let Some(b) = self.boards.get(&(*vault_id, side)) else {
            return U256::ZERO;
        };
        if b.side_shares == U256::ZERO {
            return U256::ZERO;
        }
        let Some(p) = self.positions.get(&claim_key) else {
            return U256::ZERO;
        };
        let shares = p.shares_accrued + p.rate * (b.g - p.g_paid);
        if shares == U256::ZERO {
            return U256::ZERO;
        }
        full_mul_div(self.pot(vault_id), shares, b.side_shares)
    }
}

fn loss_usdc(p: &Position, resolved_at: u64) -> U256 {
    let mut total = p.lost_usdc;
    if p.rate > U256::ZERO {
        let end = p.max_end.min(resolved_at);
        if end > p.fund_start {
            total += p.rate * U256::from(end - p.fund_start);
        }
    }
    total
}

impl VaultRegistry {
    /// g projected to cap_ts from the board's last advance (single segment; the
    /// caller has already bounded cap_ts by position max_end / resolved_at).
    fn preview_g_at(&self, vault_id: &VaultId, side: u8, cap_ts: u64) -> U256 {
        let Some(board) = self.boards.get(&(*vault_id, side)) else {
            return U256::ZERO;
        };
        let last = board.last_advance;
        if last == 0 || cap_ts <= last || board.side_rate == U256::ZERO {
            return board.g;
        }
        let (_, d_g) = seg_math_wide(board.pool, board.side_rate, U256::from(cap_ts - last));
        board.g + d_g
    }

    pub fn pending_shares(
        &self,
        vault_id: &VaultId,
        side: u8,
        account: AccountId,
        now: u64,
    ) -> U256 {
        let Some(p) = self.positions.get(&(*vault_id, side, account)) else {
            return U256::ZERO;
        };
        let mut cap_ts = now;
        let data = self.vaults.get(vault_id).expect("position implies vault");
        if data.resolved_at != 0 && data.resolved_at < cap_ts {
            cap_ts = data.resolved_at;
        }
        if !p.depleted && p.max_end != 0 && p.max_end < cap_ts {
            cap_ts = p.max_end;
        }
        let g_now = self.preview_g_at(vault_id, side, cap_ts);
        p.shares_accrued + p.rate * (g_now - p.g_paid)
    }
}

/// bonding_board::seg_math over U256 inputs (the math crate stores u128; the board
/// state is economically bounded so the narrow is the same abort Move's `as u128`
/// casts would be).
fn seg_math_wide(pool: U256, side_rate: U256, dt: U256) -> (U256, U256) {
    let (new_pool, d_g) = livestreak_math::bonding::seg_math(
        livestreak_math::wide::narrow(pool, "board pool"),
        livestreak_math::wide::narrow(side_rate, "side rate"),
        livestreak_math::wide::narrow(dt, "dt"),
    );
    (U256::from(new_pool), U256::from(d_g))
}

// ── Lifecycle + funding + settlement (Move create_vault .. withdraw + helpers) ──

use crate::drips::DripsRegistry;
use crate::StreamsRegistry;
use sha3::{Digest, Keccak256};

fn empty_position() -> Position {
    Position {
        rate: U256::ZERO,
        g_paid: U256::ZERO,
        shares_accrued: U256::ZERO,
        max_end: 0,
        depleted: false,
        fund_start: 0,
        lost_usdc: U256::ZERO,
    }
}

/// keccak256(market_id ++ question ++ nonce_le ++ ts_le) — Move bcs u64 is LE too.
fn compute_vault_id(market_id: &[u8; 32], question: &[u8], nonce: u64, timestamp: u64) -> VaultId {
    let mut h = Keccak256::new();
    h.update(market_id);
    h.update(question);
    h.update(nonce.to_le_bytes());
    h.update(timestamp.to_le_bytes());
    h.finalize().into()
}

impl VaultRegistry {
    pub fn create_vault(
        &mut self,
        market_id: [u8; 32],
        question: Vec<u8>,
        creator: [u8; 32],
        now: u64,
    ) -> VaultResult<VaultId> {
        if question.is_empty() {
            return Err(VaultError::EmptyQuestion);
        }
        if creator == [0u8; 32] {
            return Err(VaultError::ZeroCreator);
        }
        let vault_id = compute_vault_id(&market_id, &question, self.nonce, now);
        self.nonce += 1;
        self.vaults.insert(
            vault_id,
            VaultData {
                id: vault_id,
                market_id,
                question,
                creator,
                status: STATUS_OPEN,
                outcome: OUTCOME_PENDING,
                resolved_at: 0,
                exists: true,
            },
        );
        Ok(vault_id)
    }

    pub fn resolve(&mut self, vault_id: &VaultId, winning_side: u8, now: u64) -> VaultResult<()> {
        assert_valid_side(winning_side)?;
        if !self.vault_exists(vault_id) {
            return Err(VaultError::UnknownVault);
        }
        let data = self.vaults.get_mut(vault_id).unwrap();
        if data.status != STATUS_OPEN && data.status != STATUS_LOCKED {
            return Err(VaultError::NotResolvable);
        }
        data.status = STATUS_RESOLVED;
        data.outcome = if winning_side == SIDE_YES { OUTCOME_YES } else { OUTCOME_NO };
        data.resolved_at = now;
        Ok(())
    }

    pub fn on_fund(
        &mut self,
        account: AccountId,
        vault_id: &VaultId,
        side: u8,
        rate: U256,
        max_end: u64,
        now: u64,
    ) -> VaultResult<()> {
        assert_valid_side(side)?;
        if !self.vault_exists(vault_id) {
            return Err(VaultError::UnknownVault);
        }
        if self.vaults.get(vault_id).unwrap().status != STATUS_OPEN {
            return Err(VaultError::NotOpen);
        }
        if rate == U256::ZERO {
            return Err(VaultError::ZeroRate);
        }

        self.track_account_vault(account, vault_id);
        self.advance_to_now(vault_id, side, now)?;
        self.ensure_board(vault_id, side, now);

        let key = (*vault_id, side, account);
        let p = self.positions.entry(key).or_insert_with(empty_position);
        // A drained side is re-fundable: rate==0 still blocks double-funding an ACTIVE
        // side, while clearing `depleted` re-opens a run-dry lane (banked shares +
        // loss basis carry over).
        if p.rate != U256::ZERO {
            return Err(VaultError::AlreadyFunding);
        }
        p.depleted = false;

        let g = self.boards.get(&(*vault_id, side)).unwrap().g;
        let p = self.positions.get_mut(&key).unwrap();
        p.rate = rate;
        p.g_paid = g;
        p.max_end = max_end;
        p.fund_start = now;

        self.boards.get_mut(&(*vault_id, side)).unwrap().side_rate += rate;
        self.schedule_boundary(vault_id, side, max_end, account);
        Ok(())
    }

    pub fn on_stop(
        &mut self,
        account: AccountId,
        vault_id: &VaultId,
        side: u8,
        now: u64,
    ) -> VaultResult<()> {
        assert_valid_side(side)?;
        self.advance_to_now(vault_id, side, now)?;

        let key = (*vault_id, side, account);
        if !self.positions.contains_key(&key) {
            return Ok(());
        }
        self.settle_internal(vault_id, side, account);

        let resolved_at = self.vaults.get(vault_id).map(|v| v.resolved_at).unwrap_or(0);
        let p = *self.positions.get(&key).unwrap();

        let mut over_amount = U256::ZERO;
        if p.rate > U256::ZERO && !p.depleted {
            let mut loss_end = p.max_end.min(now);
            if resolved_at != 0 && resolved_at < loss_end {
                loss_end = resolved_at;
            }
            let mut new_lost = p.lost_usdc;
            if loss_end > p.fund_start {
                new_lost += p.rate * U256::from(loss_end - p.fund_start);
            }

            if resolved_at != 0 && now > resolved_at {
                let over_end = p.max_end.min(now);
                if over_end > resolved_at {
                    over_amount = p.rate * U256::from(over_end - resolved_at);
                }
            }

            self.boards.get_mut(&(*vault_id, side)).unwrap().side_rate -= p.rate;
            let p = self.positions.get_mut(&key).unwrap();
            p.lost_usdc = new_lost;
            p.rate = U256::ZERO;
        }

        if over_amount > U256::ZERO {
            *self.overage_owed.entry(key).or_insert(U256::ZERO) += over_amount;
        }
        Ok(())
    }

    pub fn refresh_max_ends(
        &mut self,
        account: AccountId,
        entries: &[(VaultId, u8)],
        new_max_end: u64,
        now: u64,
    ) -> VaultResult<()> {
        for (vault_id, side) in entries {
            assert_valid_side(*side)?;
            self.advance_to_now(vault_id, *side, now)?;
            self.settle_internal(vault_id, *side, account);
            let key = (*vault_id, *side, account);
            let update = match self.positions.get(&key) {
                Some(p) => p.rate > U256::ZERO && !p.depleted && new_max_end != p.max_end,
                None => false,
            };
            if update {
                self.positions.get_mut(&key).unwrap().max_end = new_max_end;
                self.schedule_boundary(vault_id, *side, new_max_end, account);
            }
        }
        Ok(())
    }

    pub fn advance(
        &mut self,
        vault_id: &VaultId,
        side: u8,
        max_steps: u64,
        now: u64,
    ) -> VaultResult<()> {
        assert_valid_side(side)?;
        let steps = if max_steps == 0 { MAX_STEPS } else { max_steps };
        self.advance_internal(vault_id, side, steps, now);
        Ok(())
    }

    pub fn settle(
        &mut self,
        vault_id: &VaultId,
        side: u8,
        account: AccountId,
        now: u64,
    ) -> VaultResult<()> {
        assert_valid_side(side)?;
        self.advance_internal(vault_id, side, MAX_STEPS, now);
        self.settle_internal(vault_id, side, account);
        Ok(())
    }

    /// Finalize the pot (once) + harvest both receivers' streamed cash into the vault.
    #[allow(clippy::too_many_arguments)]
    pub fn collect(
        &mut self,
        drips: &mut DripsRegistry,
        streams: &mut StreamsRegistry,
        vault_id: &VaultId,
        yes_receiver: AccountId,
        no_receiver: AccountId,
        skim_bps: u128,
        now: u64,
    ) -> VaultResult<()> {
        if !self.vault_exists(vault_id) {
            return Err(VaultError::UnknownVault);
        }
        if self.vaults.get(vault_id).unwrap().status != STATUS_RESOLVED {
            return Err(VaultError::NotResolved);
        }

        self.catch_up_side(vault_id, SIDE_YES, now)?;
        self.catch_up_side(vault_id, SIDE_NO, now)?;

        if !self.collected.get(vault_id).copied().unwrap_or(false) {
            self.collected.insert(*vault_id, true);
            self.finalize_pot(vault_id, skim_bps);
        }

        self.harvest_receiver(drips, streams, yes_receiver, now);
        self.harvest_receiver(drips, streams, no_receiver, now);
        Ok(())
    }

    /// Returns the drained skim amount (program layer pays it to the treasury).
    pub fn drain_skim(&mut self, vault_id: &VaultId) -> U256 {
        let owed = self.skim_owed.get(vault_id).copied().unwrap_or(U256::ZERO);
        if owed == U256::ZERO {
            return U256::ZERO;
        }
        if U256::from(self.usdc_held) < owed {
            return U256::ZERO;
        }
        self.skim_owed.insert(*vault_id, U256::ZERO);
        self.usdc_held -= livestreak_math::wide::narrow(owed, "skim");
        owed
    }

    /// Pay out winnings + overage on both sides. Returns the total paid (the program
    /// layer transfers this from the escrow to the payee).
    pub fn withdraw(
        &mut self,
        account: AccountId,
        vault_id: &VaultId,
        now: u64,
    ) -> VaultResult<u128> {
        if !self.vault_exists(vault_id) {
            return Ok(0);
        }
        let data = self.vaults.get(vault_id).unwrap();
        if data.status != STATUS_RESOLVED {
            return Ok(0);
        }
        if !self.collected.get(vault_id).copied().unwrap_or(false) {
            return Ok(0);
        }
        let winning = if data.outcome == OUTCOME_YES { SIDE_YES } else { SIDE_NO };
        let resolved_at = data.resolved_at;

        self.catch_up_side(vault_id, SIDE_YES, now)?;
        self.catch_up_side(vault_id, SIDE_NO, now)?;

        let mut total = self.pay_winnings(account, vault_id, SIDE_YES, winning)?;
        total += self.pay_winnings(account, vault_id, SIDE_NO, winning)?;
        total += self.pay_overage(account, vault_id, SIDE_YES, resolved_at, now)?;
        total += self.pay_overage(account, vault_id, SIDE_NO, resolved_at, now)?;
        Ok(total)
    }

    pub fn join_usdc(&mut self, amount: u128) {
        self.usdc_held += amount;
    }

    /// Settled-state compaction: delete storage that can PROVABLY never be read
    /// again. Idempotent and view-preserving — every surviving read (engine + wasm
    /// views) returns byte-identical results. Only the two classes below are dead;
    /// positions/boards/boundary-suffix stay (they still back loss-mint, winnings,
    /// overage, and the get_boundaries live-pool view).
    pub fn compact(&mut self) {
        // (1) Boundary-queue prefix [0, head). Once advance_internal moves a board's
        //     boundary head past an entry it is unreachable: advance_internal iterates
        //     from `head` (advance loop + more_due check), get_boundaries does
        //     `skip(head)`, pending_boundaries is `len - head`, and schedule_boundary
        //     only bubble-sorts new entries within [head, len). Dropping the prefix and
        //     resetting head to 0 leaves the live suffix — and every view over it —
        //     unchanged. This is the boundary analog of receive_streams' amt_deltas
        //     delete; the schedule grows monotonically as funders deplete / refresh
        //     max_ends, so the dead prefix is the dominant lingering crumb.
        let heads: Vec<((VaultId, u8), u64)> = self
            .boundary_heads
            .iter()
            .filter(|(_, &h)| h > 0)
            .map(|(k, &h)| (*k, h))
            .collect();
        for (key, head) in heads {
            if let Some(list) = self.boundaries.get_mut(&key) {
                let head = (head as usize).min(list.len());
                list.drain(0..head);
            }
            self.boundary_heads.insert(key, 0);
        }

        // (2) Fully-settled overage crumbs. A ZERO overage_owed marks a rate==0
        //     position whose post-resolution overage was paid in full: on_stop only
        //     ever inserts a POSITIVE owed, and pay_overage zeroes it after paying the
        //     whole entitlement. pay_overage's rate==0 branch reads overage_owed and
        //     overage_paid via unwrap_or(ZERO), and a resolved vault can never re-fund
        //     (on_fund requires STATUS_OPEN), so both maps read identically whether the
        //     entry is ZERO or absent — the pair is dead. rate>0 positions keep
        //     overage_paid: their entitlement still grows with time.
        let dead: Vec<(VaultId, u8, AccountId)> = self
            .overage_owed
            .iter()
            .filter(|(_, v)| **v == U256::ZERO)
            .map(|(k, _)| *k)
            .filter(|k| self.positions.get(k).map(|p| p.rate == U256::ZERO).unwrap_or(true))
            .collect();
        for key in dead {
            self.overage_owed.remove(&key);
            self.overage_paid.remove(&key);
        }
    }
}

// ── Internal helpers (Move segment/settle/boundary/advance/pot machinery) ───────

fn segment(board: &mut Board, t0: u64, t1: u64) {
    if t1 <= t0 || board.side_rate == U256::ZERO {
        return;
    }
    let (new_pool, d_g) = seg_math_wide(board.pool, board.side_rate, U256::from(t1 - t0));
    board.side_shares += board.side_rate * d_g;
    board.pool = new_pool;
    board.g += d_g;
}

fn settle_at_g(p: &mut Position, g: U256) {
    if p.g_paid == g {
        return;
    }
    let d = p.rate * (g - p.g_paid);
    p.shares_accrued += d;
    p.g_paid = g;
}

impl VaultRegistry {
    fn track_account_vault(&mut self, account: AccountId, vault_id: &VaultId) {
        if self.account_in_vault.contains_key(&(account, *vault_id)) {
            return;
        }
        self.account_in_vault.insert((account, *vault_id), true);
        self.account_vaults.entry(account).or_default().push(*vault_id);
    }

    fn ensure_board(&mut self, vault_id: &VaultId, side: u8, now: u64) {
        let key = (*vault_id, side);
        if !self.boards.contains_key(&key) {
            self.boards.insert(
                key,
                Board { pool: U256::ZERO, side_rate: U256::ZERO, g: U256::ZERO, last_advance: now, side_shares: U256::ZERO },
            );
            self.boundaries.insert(key, Vec::new());
            self.boundary_heads.insert(key, 0);
        }
    }

    fn board_caught_up(&self, vault_id: &VaultId, side: u8, now: u64) -> bool {
        let Some(board) = self.boards.get(&(*vault_id, side)) else {
            return true;
        };
        if board.last_advance == 0 {
            return true;
        }
        let mut target = now;
        let resolved_at = self.vaults.get(vault_id).map(|v| v.resolved_at).unwrap_or(0);
        if resolved_at != 0 && resolved_at < target {
            target = resolved_at;
        }
        board.last_advance == target
    }

    pub fn caught_up(&self, vault_id: &VaultId, side: u8, now: u64) -> bool {
        self.board_caught_up(vault_id, side, now)
    }

    /// Boundary-pops an implicit catch-up would replay to reach `now` — the exact step
    /// count `advance_internal` executes (one pop per scheduled `max_end` at or before
    /// the capped target; the queue is sorted ascending past the head, so the due
    /// entries are a contiguous prefix). Pure read, no board mutation — cheap enough to
    /// gate on *before* committing to the replay, which is what keeps a cap-exceeding
    /// call free of partial mutation.
    fn pending_catchup_steps(&self, vault_id: &VaultId, side: u8, now: u64) -> u64 {
        let key = (*vault_id, side);
        let Some(board) = self.boards.get(&key) else {
            return 0;
        };
        // A fresh board's first advance only initializes last_advance; it pops nothing.
        if board.last_advance == 0 {
            return 0;
        }
        let resolved_at = self.vaults.get(vault_id).map(|v| v.resolved_at).unwrap_or(0);
        let mut now_cap = now;
        if resolved_at != 0 && resolved_at < now_cap {
            now_cap = resolved_at;
        }
        let Some(list) = self.boundaries.get(&key) else {
            return 0;
        };
        let head = self.boundary_heads.get(&key).copied().unwrap_or(0) as usize;
        let mut count = 0u64;
        for boundary in list.iter().skip(head) {
            if boundary.max_end > now_cap {
                break;
            }
            count += 1;
        }
        count
    }

    /// Bounded implicit catch-up used by every vault-touching op (fund/stop/refresh/
    /// collect/withdraw). Refuses — typed `BoardBehind`, board byte-identical — when
    /// the replay would exceed [`MAX_IMPLICIT_CATCHUP_STEPS`]; the caller drains the
    /// backlog first via the uncapped `advance(max_steps)` entrypoint. Because the
    /// step count is read *before* any `advance_internal` call, a cap-exceeding op
    /// escapes with no partial mutation.
    fn advance_to_now(&mut self, vault_id: &VaultId, side: u8, now: u64) -> VaultResult<()> {
        self.catch_up_side(vault_id, side, now)
    }

    fn catch_up_side(&mut self, vault_id: &VaultId, side: u8, now: u64) -> VaultResult<()> {
        // Gate on the pending-work count BEFORE mutating: a badly-behind board bails
        // here with the board untouched, rather than half-advancing then erroring.
        if self.pending_catchup_steps(vault_id, side, now) > MAX_IMPLICIT_CATCHUP_STEPS {
            return Err(VaultError::BoardBehind);
        }
        let mut guard = 0u64;
        while !self.board_caught_up(vault_id, side, now) && guard < UNLIMITED_STEPS {
            self.advance_internal(vault_id, side, MAX_STEPS, now);
            guard += 1;
        }
        // Abort clearly rather than finalize on a half-advanced board; the brick-free
        // drain is the permissionless bounded `advance` entrypoint.
        if !self.board_caught_up(vault_id, side, now) {
            return Err(VaultError::BoardBehind);
        }
        Ok(())
    }

    fn advance_internal(&mut self, vault_id: &VaultId, side: u8, max_steps: u64, now: u64) {
        let board_key = (*vault_id, side);
        if !self.boards.contains_key(&board_key) {
            return;
        }

        let resolved_at = self.vaults.get(vault_id).map(|v| v.resolved_at).unwrap_or(0);
        let mut now_cap = now;
        if resolved_at != 0 && resolved_at < now_cap {
            now_cap = resolved_at;
        }

        let last_advance = self.boards.get(&board_key).unwrap().last_advance;
        if last_advance == 0 {
            self.boards.get_mut(&board_key).unwrap().last_advance = now;
            return;
        }

        let mut t = last_advance;
        let mut head = self.boundary_heads.get(&board_key).copied().unwrap_or(0) as usize;
        let len = self.boundaries.get(&board_key).map(|b| b.len()).unwrap_or(0);
        let mut steps = 0u64;

        while steps < max_steps && head < len {
            let boundary = self.boundaries.get(&board_key).unwrap()[head];
            if boundary.max_end > now_cap {
                break;
            }
            let pos_key = (*vault_id, side, boundary.account);
            let (rate, depleted, max_end) = match self.positions.get(&pos_key) {
                Some(p) => (p.rate, p.depleted, p.max_end),
                None => (U256::ZERO, false, 0),
            };

            if rate > U256::ZERO && !depleted && max_end == boundary.max_end {
                {
                    let board = self.boards.get_mut(&board_key).unwrap();
                    segment(board, t, boundary.max_end);
                }
                let g = self.boards.get(&board_key).unwrap().g;
                if let Some(p) = self.positions.get_mut(&pos_key) {
                    settle_at_g(p, g);
                    if boundary.max_end > p.fund_start {
                        p.lost_usdc += p.rate * U256::from(boundary.max_end - p.fund_start);
                    }
                    let stream_rate = p.rate;
                    p.rate = U256::ZERO;
                    p.depleted = true;
                    self.boards.get_mut(&board_key).unwrap().side_rate -= stream_rate;
                }
                t = boundary.max_end;
            }

            head += 1;
            steps += 1;
        }
        self.boundary_heads.insert(board_key, head as u64);

        let more_due = head < len
            && self.boundaries.get(&board_key).unwrap()[head].max_end <= now_cap;
        if !more_due && t < now_cap {
            let board = self.boards.get_mut(&board_key).unwrap();
            segment(board, t, now_cap);
            t = now_cap;
        }
        self.boards.get_mut(&board_key).unwrap().last_advance = t;
    }

    fn settle_internal(&mut self, vault_id: &VaultId, side: u8, account: AccountId) {
        let Some(board) = self.boards.get(&(*vault_id, side)) else {
            return;
        };
        let g = board.g;
        if let Some(p) = self.positions.get_mut(&(*vault_id, side, account)) {
            settle_at_g(p, g);
        }
    }

    /// Sorted insert past the drained head (stable for equal max_ends).
    fn schedule_boundary(&mut self, vault_id: &VaultId, side: u8, max_end: u64, account: AccountId) {
        let key = (*vault_id, side);
        self.boundaries.entry(key).or_default();
        self.boundary_heads.entry(key).or_insert(0);
        let head = self.boundary_heads.get(&key).copied().unwrap_or(0) as usize;
        let arr = self.boundaries.get_mut(&key).unwrap();
        arr.push(Boundary { max_end, account });
        let mut i = arr.len() - 1;
        while i > head {
            if arr[i - 1].max_end <= arr[i].max_end {
                break;
            }
            arr.swap(i, i - 1);
            i -= 1;
        }
    }

    fn finalize_pot(&mut self, vault_id: &VaultId, skim_bps: u128) {
        let data = self.vaults.get(vault_id).unwrap();
        let winning = if data.outcome == OUTCOME_YES { SIDE_YES } else { SIDE_NO };
        let losing = if winning == SIDE_YES { SIDE_NO } else { SIDE_YES };

        let win_pool = self.boards.get(&(*vault_id, winning)).map(|b| b.pool).unwrap_or_default();
        let lose_pool = self.boards.get(&(*vault_id, losing)).map(|b| b.pool).unwrap_or_default();
        let win_shares =
            self.boards.get(&(*vault_id, winning)).map(|b| b.side_shares).unwrap_or_default();

        let (pot_amt, skim_amt) = if win_shares == U256::ZERO && self.treasury_set {
            (U256::ZERO, win_pool + lose_pool)
        } else {
            let skim = if self.treasury_set && lose_pool > U256::ZERO {
                (lose_pool * U256::from(skim_bps)) / U256::from(BPS_DENOM)
            } else {
                U256::ZERO
            };
            (win_pool + lose_pool - skim, skim)
        };

        self.pot.insert(*vault_id, pot_amt);
        self.skim_owed.insert(*vault_id, skim_amt);
    }

    fn harvest_receiver(
        &mut self,
        drips: &mut DripsRegistry,
        streams: &mut StreamsRegistry,
        receiver: AccountId,
        now: u64,
    ) {
        if receiver == U256::ZERO {
            return;
        }
        drips.receive_streams(streams, receiver, 0xFFFF_FFFF, now);
        let amt = drips.collect(receiver);
        if amt > 0 {
            // withdraw_coin from drips escrow, join into the vault registry escrow.
            drips.withdraw(amt).expect("collected amount is always withdrawable");
            self.usdc_held += amt;
        }
    }

    fn pay_winnings(
        &mut self,
        account: AccountId,
        vault_id: &VaultId,
        side: u8,
        winning: u8,
    ) -> VaultResult<u128> {
        if side != winning {
            return Ok(0);
        }
        let key = (*vault_id, side, account);
        if self.claimed.get(&key).copied().unwrap_or(false) {
            return Ok(0);
        }

        self.settle_internal(vault_id, side, account);

        let shares = self.positions.get(&key).map(|p| p.shares_accrued).unwrap_or_default();
        if shares == U256::ZERO {
            return Ok(0);
        }
        let side_total =
            self.boards.get(&(*vault_id, side)).map(|b| b.side_shares).unwrap_or_default();
        if side_total == U256::ZERO {
            return Ok(0);
        }
        let payout = full_mul_div(self.pot(vault_id), shares, side_total);
        if payout == U256::ZERO {
            return Ok(0);
        }
        self.claimed.insert(key, true);
        self.pay_usdc(payout)?;
        Ok(livestreak_math::wide::narrow(payout, "winnings"))
    }

    fn pay_overage(
        &mut self,
        account: AccountId,
        vault_id: &VaultId,
        side: u8,
        resolved_at: u64,
        now: u64,
    ) -> VaultResult<u128> {
        let key = (*vault_id, side, account);
        let Some(p) = self.positions.get(&key) else {
            return Ok(0);
        };
        let entitlement = if p.rate > U256::ZERO {
            let end = p.max_end.min(now);
            if end > resolved_at {
                p.rate * U256::from(end - resolved_at)
            } else {
                U256::ZERO
            }
        } else {
            self.overage_owed.get(&key).copied().unwrap_or(U256::ZERO)
        };

        let already = self.overage_paid.get(&key).copied().unwrap_or(U256::ZERO);
        if entitlement <= already {
            return Ok(0);
        }
        let amt = entitlement - already;
        self.overage_paid.insert(key, entitlement);
        if self.positions.get(&key).unwrap().rate == U256::ZERO {
            if let Some(owed) = self.overage_owed.get_mut(&key) {
                *owed = U256::ZERO;
            }
        }
        self.pay_usdc(amt)?;
        Ok(livestreak_math::wide::narrow(amt, "overage"))
    }

    /// The transfer_usdc ledger op: the program layer moves real tokens to the payee.
    fn pay_usdc(&mut self, amount: U256) -> VaultResult<()> {
        if amount == U256::ZERO {
            return Err(VaultError::InsufficientUsdc);
        }
        let amt = livestreak_math::wide::narrow(amount, "usdc payout");
        if self.usdc_held < amt {
            return Err(VaultError::InsufficientUsdc);
        }
        self.usdc_held -= amt;
        Ok(())
    }
}
