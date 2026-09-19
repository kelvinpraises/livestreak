//! Driver orchestration — 1:1 port of `vault_driver.move` + `market_driver.move`
//! + `driver_transfer_utils.move`, composed into one `Protocol` state (which is
//! also the program layer's per-market state blob — mirroring Sui's shape of a few
//! shared registry objects rather than PDA-per-entity sharding; documented v1).
//!
//! Token/receiver id schemes (engine-internal, never cross chains):
//! - position token ids: keccak-derived U256 (pubkeys can't pack into u256 like
//!   EVM addresses; deterministic from (minter, salt) so mintWithSalt-style
//!   client-side precomputation still works)
//! - receiver accounts: driver_id << 224 | pool_id (per vault-side), seed
//!   accounts add bit 127 + a keccak tag — byte-for-byte the Move scheme.

use ruint::aliases::U256;
use serde::{Deserialize, Serialize};
use sha3::{Digest, Keccak256};

extern crate alloc;
use alloc::collections::BTreeMap;
use alloc::vec::Vec;

use crate::drips::{DripsError, DripsRegistry};
use crate::treasury::TreasuryRegistry;
use crate::state::{AccountId, StreamConfig, StreamReceiver, AMT_PER_SEC_MULTIPLIER};
use crate::vault::{VaultError, VaultId, VaultRegistry};
use crate::StreamsRegistry;

pub const MAX_LANES: usize = 10;
const DRIVER_ID_SHIFT: u32 = 224;
const SEED_ACCOUNT_BIT: u128 = 1 << 127;
/// Move's `withdraw_all` sentinel (i128::neg_from(1e24) clamps to the balance).
const WITHDRAW_ALL: i128 = -1_000_000_000_000_000_000_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DriverError {
    SaltUsed,
    UnknownMarket,
    ZeroRate,
    BadDeposit,
    WrongMarket,
    VaultHasLane,
    TooManyLanes,
    NoLane,
    DuplicateVault,
    LengthMismatch,
    SeedExists,
    NoSeed,
    Vault(VaultError),
    Drips(DripsError),
}

impl From<VaultError> for DriverError {
    fn from(e: VaultError) -> Self {
        DriverError::Vault(e)
    }
}
impl From<DripsError> for DriverError {
    fn from(e: DripsError) -> Self {
        DriverError::Drips(e)
    }
}
impl From<crate::state::StreamsError> for DriverError {
    fn from(e: crate::state::StreamsError) -> Self {
        DriverError::Drips(DripsError::Streams(e))
    }
}

pub type DriverResult<T> = Result<T, DriverError>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Lane {
    pub vault_id: VaultId,
    pub side: u8,
    pub rate: U256,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SeedLane {
    pub side: u8,
    pub rate: U256,
    pub active: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VaultDriverState {
    pub driver_id: u32,
    pub next_pool_id: u64,
    pub pool_id_of: BTreeMap<(VaultId, u8), u64>,
    pub seeds: BTreeMap<(VaultId, [u8; 32]), SeedLane>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MarketDriverState {
    pub driver_id: u32,
    pub minted_tokens: u64,
    pub used_salts: BTreeMap<([u8; 32], u64), bool>,
    pub market_id_of: BTreeMap<AccountId, [u8; 32]>,
    pub lane_keys: BTreeMap<AccountId, Vec<VaultId>>,
    pub lanes: BTreeMap<(AccountId, VaultId), Lane>,
}

/// The whole per-market protocol state: this is what the program serializes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Protocol {
    pub streams: StreamsRegistry,
    pub drips: DripsRegistry,
    pub vault: VaultRegistry,
    pub vault_driver: VaultDriverState,
    pub market_driver: MarketDriverState,
    pub treasury: TreasuryRegistry,
}

impl Default for Protocol {
    fn default() -> Self {
        let mut vault = VaultRegistry::default();
        // The composite always carries a treasury (Move: set_treasury_id at deploy).
        vault.treasury_set = true;
        Self {
            streams: StreamsRegistry::default(),
            drips: DripsRegistry::default(),
            vault,
            vault_driver: VaultDriverState::default(),
            market_driver: MarketDriverState::default(),
            treasury: TreasuryRegistry::default(),
        }
    }
}

impl Default for StreamsRegistry {
    fn default() -> Self {
        // Move drips DEFAULT_CYCLE_SECS = 10.
        StreamsRegistry::new(10).expect("default cycle")
    }
}

fn keccak(parts: &[&[u8]]) -> [u8; 32] {
    let mut h = Keccak256::new();
    for p in parts {
        h.update(p);
    }
    h.finalize().into()
}

fn u256_from_hash(hash: [u8; 32]) -> U256 {
    U256::from_be_bytes::<32>(hash)
}

impl VaultDriverState {
    pub fn seed_account(&self, creator: &[u8; 32], vault_id: &VaultId) -> AccountId {
        let hash = keccak(&[b"livestreak.seed", creator, vault_id]);
        let mut tag: u128 = 0;
        for byte in hash.iter().take(16) {
            tag = (tag << 8) | (*byte as u128);
        }
        (U256::from(self.driver_id) << DRIVER_ID_SHIFT) | U256::from(SEED_ACCOUNT_BIT | tag)
    }

    pub fn receiver_account_view(&self, vault_id: &VaultId, side: u8) -> AccountId {
        let pool_id = self.pool_id_of.get(&(*vault_id, side)).copied().unwrap_or(0);
        receiver_from_pool(self.driver_id, pool_id)
    }

    fn receiver_account(&mut self, vault: &VaultRegistry, vault_id: &VaultId, side: u8) -> DriverResult<AccountId> {
        if !vault.vault_exists(vault_id) {
            return Err(DriverError::UnknownMarket);
        }
        let key = (*vault_id, side);
        let pool_id = match self.pool_id_of.get(&key) {
            Some(pid) => *pid,
            None => {
                let pid = self.next_pool_id.max(1);
                self.next_pool_id = pid + 1;
                self.pool_id_of.insert(key, pid);
                pid
            }
        };
        Ok(receiver_from_pool(self.driver_id, pool_id))
    }
}

fn receiver_from_pool(driver_id: u32, pool_id: u64) -> AccountId {
    (U256::from(driver_id) << DRIVER_ID_SHIFT) | U256::from(pool_id)
}

fn recv(account: AccountId, rate: U256) -> StreamReceiver {
    StreamReceiver {
        account_id: account,
        config: StreamConfig {
            stream_id: 0,
            amt_per_sec: rate * U256::from(AMT_PER_SEC_MULTIPLIER),
            start: 0,
            duration: 0,
        },
    }
}

fn sort_receivers(receivers: &mut [StreamReceiver]) {
    receivers.sort_by(|a, b| a.account_id.cmp(&b.account_id));
}

impl Protocol {
    // ── driver_transfer_utils ──────────────────────────────────────────────────

    /// Deposit-on-positive-delta, set_streams, refund-on-negative-real-delta.
    /// `deposit_amt` is the payment the program layer already moved into the escrow.
    /// Returns (real_delta, refunded) — the program pays `refunded` back out.
    #[allow(clippy::too_many_arguments)]
    fn set_streams_and_transfer(
        &mut self,
        deposit_amt: u128,
        account_id: AccountId,
        curr: &[StreamReceiver],
        balance_delta: i128,
        next: &[StreamReceiver],
        now: u64,
    ) -> DriverResult<(i128, u128)> {
        if balance_delta >= 0 && deposit_amt > 0 {
            self.drips.deposit(deposit_amt);
        }
        let real = self.drips.set_streams(
            &mut self.streams,
            account_id,
            curr,
            balance_delta,
            next,
            0,
            0,
            now,
        )?;
        let mut refunded = 0u128;
        if real < 0 {
            refunded = real.unsigned_abs();
            if refunded > 0 {
                self.drips.withdraw(refunded)?;
            }
        }
        Ok((real, refunded))
    }

    // ── vault_driver entry points ─────────────────────────────────────────────

    /// create_vault + seed lane in one op (Move vault_driver::create_vault).
    /// `deposit` must equal the payment already moved into the escrow.
    #[allow(clippy::too_many_arguments)]
    pub fn create_vault_seeded(
        &mut self,
        market_id: [u8; 32],
        question: Vec<u8>,
        creator: [u8; 32],
        seed_side: u8,
        rate: U256,
        deposit: u128,
        now: u64,
    ) -> DriverResult<VaultId> {
        if rate == U256::ZERO {
            return Err(DriverError::ZeroRate);
        }
        if deposit == 0 {
            return Err(DriverError::BadDeposit);
        }
        let vault_id = self.vault.create_vault(market_id, question, creator, now)?;

        if self.vault_driver.seeds.contains_key(&(vault_id, creator)) {
            return Err(DriverError::SeedExists);
        }
        let account = self.vault_driver.seed_account(&creator, &vault_id);
        let receiver = self.vault_driver.receiver_account(&self.vault, &vault_id, seed_side)?;

        let next = [recv(receiver, rate)];
        self.set_streams_and_transfer(deposit, account, &[], deposit as i128, &next, now)?;

        let (_, _, _, _, max_end) = self.streams.streams_state(account);
        self.vault.on_fund(account, &vault_id, seed_side, rate, max_end, now)?;

        self.vault_driver
            .seeds
            .insert((vault_id, creator), SeedLane { side: seed_side, rate, active: true });
        Ok(vault_id)
    }

    /// Returns the refunded amount (program layer pays it to the creator).
    pub fn stop_seed(&mut self, vault_id: &VaultId, creator: [u8; 32], now: u64) -> DriverResult<u128> {
        let Some(lane) = self.vault_driver.seeds.get(&(*vault_id, creator)).copied() else {
            return Err(DriverError::NoSeed);
        };
        if !lane.active {
            return Err(DriverError::NoSeed);
        }
        let account = self.vault_driver.seed_account(&creator, vault_id);
        let receiver = self.vault_driver.receiver_account_view(vault_id, lane.side);
        let curr = [recv(receiver, lane.rate)];

        let (_, refunded) =
            self.set_streams_and_transfer(0, account, &curr, WITHDRAW_ALL, &[], now)?;
        self.vault.on_stop(account, vault_id, lane.side, now)?;
        self.vault_driver.seeds.get_mut(&(*vault_id, creator)).unwrap().active = false;
        Ok(refunded)
    }

    /// Pull one side's streamed cash into the vault escrow.
    pub fn harvest(&mut self, vault_id: &VaultId, side: u8, now: u64) -> u128 {
        let receiver = self.vault_driver.receiver_account_view(vault_id, side);
        if receiver == U256::ZERO {
            return 0;
        }
        self.drips.receive_streams(&mut self.streams, receiver, 0xFFFF_FFFF, now);
        let amt = self.drips.collect(receiver);
        if amt > 0 {
            self.drips.withdraw(amt).expect("collected is withdrawable");
            self.vault.join_usdc(amt);
        }
        amt
    }

    /// collect + skim drain. Returns the skim amount owed to the treasury (the
    /// program layer transfers it out of the vault escrow).
    pub fn collect_vault(&mut self, vault_id: &VaultId, now: u64) -> DriverResult<u128> {
        let yes_receiver = self.vault_driver.receiver_account_view(vault_id, crate::vault::SIDE_YES);
        let no_receiver = self.vault_driver.receiver_account_view(vault_id, crate::vault::SIDE_NO);
        let skim_bps = self.treasury.skim_bps;
        // Split borrows: vault.collect needs drips+streams mutably alongside itself.
        let Protocol { vault, drips, streams, .. } = self;
        vault.collect(drips, streams, vault_id, yes_receiver, no_receiver, skim_bps, now)?;
        let skimmed = self.vault.drain_skim(vault_id);
        let skim_amt = livestreak_math::wide::narrow(skimmed, "skim");
        if skim_amt > 0 {
            // Move collect_vault: deposit_skim + notify_skim (program transfers the cash).
            self.treasury.deposit_skim(skim_amt);
            self.treasury.notify_skim(skimmed);
        }
        Ok(skim_amt)
    }

    /// Seed creator's winnings+overage payout (program pays it to the creator).
    pub fn withdraw_seed(&mut self, vault_id: &VaultId, creator: [u8; 32], now: u64) -> DriverResult<u128> {
        let account = self.vault_driver.seed_account(&creator, vault_id);
        Ok(self.vault.withdraw(account, vault_id, now)?)
    }

    // ── market_driver entry points ────────────────────────────────────────────

    pub fn calc_token_id_with_salt(&self, minter: &[u8; 32], salt: u64) -> AccountId {
        u256_from_hash(keccak(&[b"livestreak.pos", minter, &salt.to_le_bytes()]))
    }

    pub fn mint(&mut self, market_id: [u8; 32], market_exists: bool) -> DriverResult<AccountId> {
        if !market_exists {
            return Err(DriverError::UnknownMarket);
        }
        let counter = self.market_driver.minted_tokens;
        let token_id =
            u256_from_hash(keccak(&[b"livestreak.pos.seq", &counter.to_le_bytes()]));
        self.market_driver.minted_tokens += 1;
        self.market_driver.market_id_of.insert(token_id, market_id);
        Ok(token_id)
    }

    pub fn mint_with_salt(
        &mut self,
        market_id: [u8; 32],
        market_exists: bool,
        minter: [u8; 32],
        salt: u64,
    ) -> DriverResult<AccountId> {
        if !market_exists {
            return Err(DriverError::UnknownMarket);
        }
        if self.market_driver.used_salts.contains_key(&(minter, salt)) {
            return Err(DriverError::SaltUsed);
        }
        self.market_driver.used_salts.insert((minter, salt), true);
        let token_id = self.calc_token_id_with_salt(&minter, salt);
        self.market_driver.market_id_of.insert(token_id, market_id);
        Ok(token_id)
    }

    fn assert_market_vault(&self, token_id: AccountId, vault_id: &VaultId) -> DriverResult<()> {
        let market_id = self
            .market_driver
            .market_id_of
            .get(&token_id)
            .ok_or(DriverError::UnknownMarket)?;
        if self.vault.market_id(vault_id)? != *market_id {
            return Err(DriverError::WrongMarket);
        }
        Ok(())
    }

    fn build_receivers(&mut self, token_id: AccountId) -> DriverResult<Vec<StreamReceiver>> {
        let Some(keys) = self.market_driver.lane_keys.get(&token_id).cloned() else {
            return Ok(Vec::new());
        };
        let mut receivers = Vec::new();
        for vault_id in keys {
            let lane = self.market_driver.lanes.get(&(token_id, vault_id)).copied().unwrap();
            let receiver =
                self.vault_driver.receiver_account(&self.vault, &vault_id, lane.side)?;
            receivers.push(recv(receiver, lane.rate));
        }
        sort_receivers(&mut receivers);
        Ok(receivers)
    }

    pub fn lane_count(&self, token_id: AccountId) -> usize {
        self.market_driver.lane_keys.get(&token_id).map(|k| k.len()).unwrap_or(0)
    }

    /// Fund one lane. `deposit` = payment already in the escrow.
    #[allow(clippy::too_many_arguments)]
    pub fn fund(
        &mut self,
        token_id: AccountId,
        vault_id: &VaultId,
        side: u8,
        rate: U256,
        deposit: u128,
        now: u64,
    ) -> DriverResult<u64> {
        if rate == U256::ZERO {
            return Err(DriverError::ZeroRate);
        }
        if deposit == 0 {
            return Err(DriverError::BadDeposit);
        }
        self.assert_market_vault(token_id, vault_id)?;
        if self.market_driver.lanes.contains_key(&(token_id, *vault_id)) {
            return Err(DriverError::VaultHasLane);
        }
        if self.lane_count(token_id) >= MAX_LANES {
            return Err(DriverError::TooManyLanes);
        }

        let curr = self.build_receivers(token_id)?;
        self.market_driver.lane_keys.entry(token_id).or_default().push(*vault_id);
        self.market_driver
            .lanes
            .insert((token_id, *vault_id), Lane { vault_id: *vault_id, side, rate });
        let next = self.build_receivers(token_id)?;

        self.set_streams_and_transfer(deposit, token_id, &curr, deposit as i128, &next, now)?;

        let (_, _, _, _, max_end) = self.streams.streams_state(token_id);
        self.vault.on_fund(token_id, vault_id, side, rate, max_end, now)?;
        self.refresh_other_lanes(token_id, vault_id, max_end, now)?;
        Ok(max_end)
    }

    pub fn stop(
        &mut self,
        token_id: AccountId,
        vault_id: &VaultId,
        side: u8,
        now: u64,
    ) -> DriverResult<()> {
        let Some(lane) = self.market_driver.lanes.get(&(token_id, *vault_id)).copied() else {
            return Err(DriverError::NoLane);
        };
        if lane.rate == U256::ZERO || lane.side != side {
            return Err(DriverError::NoLane);
        }

        let curr = self.build_receivers(token_id)?;
        self.remove_lane(token_id, vault_id);
        let next = self.build_receivers(token_id)?;

        self.set_streams_and_transfer(0, token_id, &curr, 0, &next, now)?;
        self.vault.on_stop(token_id, vault_id, side, now)?;

        let (_, _, _, _, max_end) = self.streams.streams_state(token_id);
        if self.lane_count(token_id) > 0 {
            self.refresh_all_lanes(token_id, max_end, now)?;
        }
        Ok(())
    }

    /// Declarative full-set reconfiguration (Move set_lanes). `add_deposit` = payment
    /// already in the escrow (0 for pure reshapes).
    pub fn set_lanes(
        &mut self,
        token_id: AccountId,
        desired: &[(VaultId, u8, U256)],
        add_deposit: u128,
        now: u64,
    ) -> DriverResult<()> {
        if desired.len() > MAX_LANES {
            return Err(DriverError::TooManyLanes);
        }
        let market_id = *self
            .market_driver
            .market_id_of
            .get(&token_id)
            .ok_or(DriverError::UnknownMarket)?;
        for (i, (vault_id, _, rate)) in desired.iter().enumerate() {
            if *rate == U256::ZERO {
                return Err(DriverError::ZeroRate);
            }
            if self.vault.market_id(vault_id)? != market_id {
                return Err(DriverError::WrongMarket);
            }
            for (prev, _, _) in desired.iter().take(i) {
                if prev == vault_id {
                    return Err(DriverError::DuplicateVault);
                }
            }
        }

        let curr = self.build_receivers(token_id)?;
        let removed = self.diff_removed(token_id, desired);
        let added = self.diff_added(token_id, desired, now);

        self.clear_lanes(token_id);
        for (vault_id, side, rate) in desired {
            self.market_driver.lane_keys.entry(token_id).or_default().push(*vault_id);
            self.market_driver
                .lanes
                .insert((token_id, *vault_id), Lane { vault_id: *vault_id, side: *side, rate: *rate });
        }
        let next = self.build_receivers(token_id)?;

        let delta = if add_deposit > 0 { add_deposit as i128 } else { 0 };
        self.set_streams_and_transfer(add_deposit, token_id, &curr, delta, &next, now)?;

        let (_, _, _, _, max_end) = self.streams.streams_state(token_id);

        for (vault_id, side) in &removed {
            self.vault.on_stop(token_id, vault_id, *side, now)?;
        }
        for (vault_id, side, rate) in &added {
            self.vault.on_fund(token_id, vault_id, *side, *rate, max_end, now)?;
        }
        if !desired.is_empty() {
            let entries: Vec<(VaultId, u8)> =
                desired.iter().map(|(v, s, _)| (*v, *s)).collect();
            self.vault.refresh_max_ends(token_id, &entries, max_end, now)?;
        }
        Ok(())
    }

    /// Stop everything + withdraw the whole balance. Returns the refund.
    pub fn stop_all(&mut self, token_id: AccountId, now: u64) -> DriverResult<u128> {
        let curr = self.build_receivers(token_id)?;
        self.stop_all_lanes_on_vault(token_id, now)?;
        let (_, refunded) =
            self.set_streams_and_transfer(0, token_id, &curr, WITHDRAW_ALL, &[], now)?;
        Ok(refunded)
    }

    /// Winnings + overage for one vault (program pays the returned amount out).
    pub fn withdraw(&mut self, token_id: AccountId, vault_id: &VaultId, now: u64) -> DriverResult<u128> {
        Ok(self.vault.withdraw(token_id, vault_id, now)?)
    }

    pub fn withdraw_many(
        &mut self,
        token_id: AccountId,
        vault_ids: &[VaultId],
        now: u64,
    ) -> DriverResult<u128> {
        let mut total = 0u128;
        for vault_id in vault_ids {
            total += self.vault.withdraw(token_id, vault_id, now)?;
        }
        Ok(total)
    }

    /// LVST amount to mint for a losing position (program does the SPL mint CPI).
    pub fn claim_loss_lvst(
        &mut self,
        token_id: AccountId,
        vault_id: &VaultId,
        side: u8,
    ) -> DriverResult<U256> {
        self.treasury
            .mint_loss_lvst(&self.vault, token_id, vault_id, side)
            .map_err(|_| DriverError::NoLane)
    }

    // ── market_driver helpers ─────────────────────────────────────────────────

    fn remove_lane(&mut self, token_id: AccountId, vault_id: &VaultId) {
        if let Some(keys) = self.market_driver.lane_keys.get_mut(&token_id) {
            if let Some(pos) = keys.iter().position(|v| v == vault_id) {
                keys.swap_remove(pos);
                self.market_driver.lanes.remove(&(token_id, *vault_id));
            }
        }
    }

    fn clear_lanes(&mut self, token_id: AccountId) {
        if let Some(keys) = self.market_driver.lane_keys.remove(&token_id) {
            for vault_id in keys {
                self.market_driver.lanes.remove(&(token_id, vault_id));
            }
        }
    }

    fn diff_removed(
        &self,
        token_id: AccountId,
        desired: &[(VaultId, u8, U256)],
    ) -> Vec<(VaultId, u8)> {
        let mut removed = Vec::new();
        let Some(keys) = self.market_driver.lane_keys.get(&token_id) else {
            return removed;
        };
        for vault_id in keys {
            let lane = self.market_driver.lanes.get(&(token_id, *vault_id)).unwrap();
            let exactly_in = desired
                .iter()
                .any(|(v, s, r)| v == vault_id && *s == lane.side && *r == lane.rate);
            if !exactly_in {
                removed.push((*vault_id, lane.side));
            }
        }
        removed
    }

    fn diff_added(
        &self,
        token_id: AccountId,
        desired: &[(VaultId, u8, U256)],
        now: u64,
    ) -> Vec<(VaultId, u8, U256)> {
        let mut added = Vec::new();
        for (vault_id, side, rate) in desired {
            let held = self.market_driver.lanes.get(&(token_id, *vault_id)).copied();
            let mut changed = match held {
                Some(l) => l.rate != *rate || l.side != *side,
                None => true,
            };
            // Re-open a run-dry lane even when bookkeeping looks unchanged (revival
            // parity): depletion lives in the Vault; and a lane past max_end on a
            // BEHIND board must also re-fund or a top-up's delivery strands.
            if !changed {
                let (p_rate, _, _, p_max_end, depleted, ..) =
                    self.vault.get_position(vault_id, *side, token_id);
                changed = depleted || (p_rate > U256::ZERO && p_max_end != 0 && p_max_end <= now);
            }
            if changed {
                added.push((*vault_id, *side, *rate));
            }
        }
        added
    }

    fn refresh_other_lanes(
        &mut self,
        token_id: AccountId,
        new_vault_id: &VaultId,
        max_end: u64,
        now: u64,
    ) -> DriverResult<()> {
        let Some(keys) = self.market_driver.lane_keys.get(&token_id).cloned() else {
            return Ok(());
        };
        if keys.len() <= 1 {
            return Ok(());
        }
        let entries: Vec<(VaultId, u8)> = keys
            .iter()
            .filter(|v| *v != new_vault_id)
            .map(|v| (*v, self.market_driver.lanes.get(&(token_id, *v)).unwrap().side))
            .collect();
        self.vault.refresh_max_ends(token_id, &entries, max_end, now)?;
        Ok(())
    }

    fn refresh_all_lanes(&mut self, token_id: AccountId, max_end: u64, now: u64) -> DriverResult<()> {
        let Some(keys) = self.market_driver.lane_keys.get(&token_id).cloned() else {
            return Ok(());
        };
        let entries: Vec<(VaultId, u8)> = keys
            .iter()
            .map(|v| (*v, self.market_driver.lanes.get(&(token_id, *v)).unwrap().side))
            .collect();
        self.vault.refresh_max_ends(token_id, &entries, max_end, now)?;
        Ok(())
    }

    fn stop_all_lanes_on_vault(&mut self, token_id: AccountId, now: u64) -> DriverResult<()> {
        let Some(keys) = self.market_driver.lane_keys.remove(&token_id) else {
            return Ok(());
        };
        for vault_id in &keys {
            let lane = self.market_driver.lanes.remove(&(token_id, *vault_id)).unwrap();
            self.vault.on_stop(token_id, vault_id, lane.side, now)?;
        }
        Ok(())
    }
}

impl Protocol {
    /// Program-layer codec (postcard: compact, deterministic, no_std).
    pub fn to_bytes(&self) -> Vec<u8> {
        postcard::to_allocvec(self).expect("protocol serialize")
    }

    pub fn from_bytes(bytes: &[u8]) -> Option<Self> {
        postcard::from_bytes(bytes).ok()
    }
}
