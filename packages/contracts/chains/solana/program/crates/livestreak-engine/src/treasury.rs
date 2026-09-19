//! Treasury — 1:1 port of `treasury.move` (+ lvst.move's role): skim intake,
//! pool-driven LVST loss-mint curve (start 100 / floor 1 / knee $10k, cumulative
//! anti-dupe), MasterChef-style staking dividends. Pure ledger: the program layer
//! does the SPL mint/transfer CPIs with the amounts this module returns.

use ruint::aliases::U256;
use serde::{Deserialize, Serialize};

extern crate alloc;
use alloc::collections::BTreeMap;

use crate::state::AccountId;
use crate::vault::{VaultId, VaultRegistry};

pub const ACC_SCALE: u128 = 1_000_000_000_000_000_000;
pub const USDC_ONE: u128 = 1_000_000;
pub const SKIM_BPS_DEFAULT: u128 = 200;
pub const MINT_START: u128 = 100_000_000_000;
pub const MINT_FLOOR: u128 = 1_000_000_000;
pub const MINT_KNEE: u128 = 10_000_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TreasuryError {
    AlreadyClaimed,
    NothingLost,
    ZeroStake,
    InvalidUnstake,
}

pub type TreasuryResult<T> = Result<T, TreasuryError>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TreasuryRegistry {
    pub skim_bps: u128,
    pub mint_start: U256,
    pub mint_floor: U256,
    pub mint_knee: U256,
    pub total_skimmed: U256,
    pub total_staked: u128,
    pub acc_usdc_per_stake: U256,
    pub undistributed: u128,
    /// USDC the treasury escrow holds (program binds to its ATA).
    pub usdc_held: u128,
    /// Staked LVST the treasury escrow holds.
    pub staked_lvst_held: u128,
    pub stake_of: BTreeMap<[u8; 32], u128>,
    pub reward_debt: BTreeMap<[u8; 32], U256>,
    pub accrued_dividends: BTreeMap<[u8; 32], u128>,
    pub loss_claimed: BTreeMap<(AccountId, VaultId, u8), bool>,
}

impl Default for TreasuryRegistry {
    fn default() -> Self {
        Self {
            skim_bps: SKIM_BPS_DEFAULT,
            mint_start: U256::from(MINT_START),
            mint_floor: U256::from(MINT_FLOOR),
            mint_knee: U256::from(MINT_KNEE),
            total_skimmed: U256::ZERO,
            total_staked: 0,
            acc_usdc_per_stake: U256::ZERO,
            undistributed: 0,
            usdc_held: 0,
            staked_lvst_held: 0,
            stake_of: Default::default(),
            reward_debt: Default::default(),
            accrued_dividends: Default::default(),
            loss_claimed: Default::default(),
        }
    }
}

impl TreasuryRegistry {
    /// Pool-driven mint rate: floor + (start-floor)*knee / (knee + total_skimmed).
    pub fn mint_rate(&self) -> U256 {
        self.mint_floor
            + ((self.mint_start - self.mint_floor) * self.mint_knee)
                / (self.mint_knee + self.total_skimmed)
    }

    pub fn lvst_staked(&self, user: &[u8; 32]) -> u128 {
        self.stake_of.get(user).copied().unwrap_or(0)
    }

    pub fn pending_dividends(&self, user: &[u8; 32]) -> u128 {
        let accrued = self.accrued_dividends.get(user).copied().unwrap_or(0);
        let stake = self.stake_of.get(user).copied().unwrap_or(0);
        let debt = self.reward_debt.get(user).copied().unwrap_or(U256::ZERO);
        let unsettled = U256::from(stake) * self.acc_usdc_per_stake / U256::from(ACC_SCALE);
        if unsettled > debt {
            accrued + livestreak_math::wide::narrow(unsettled - debt, "dividends")
        } else {
            accrued
        }
    }

    /// Cumulative-pool accounting + dividend distribution (undistributed carries
    /// until someone stakes).
    pub fn notify_skim(&mut self, amount: U256) {
        self.total_skimmed += amount;
        let dist = amount + U256::from(self.undistributed);
        if self.total_staked > 0 {
            self.acc_usdc_per_stake += (dist * U256::from(ACC_SCALE)) / U256::from(self.total_staked);
            self.undistributed = 0;
        } else {
            self.undistributed = livestreak_math::wide::narrow(dist, "undistributed");
        }
    }

    /// Skim cash arrived at the treasury escrow.
    pub fn deposit_skim(&mut self, amount: u128) {
        self.usdc_held += amount;
    }

    /// EVM-parity trust boundary: the loss basis is READ FROM THE VAULT, never a
    /// caller-supplied literal. Returns the LVST amount the program must mint.
    pub fn mint_loss_lvst(
        &mut self,
        vault_registry: &VaultRegistry,
        account: AccountId,
        vault_id: &VaultId,
        side: u8,
    ) -> TreasuryResult<U256> {
        let key = (account, *vault_id, side);
        if self.loss_claimed.contains_key(&key) {
            return Err(TreasuryError::AlreadyClaimed);
        }
        let lost_usdc = vault_registry.loss_claimable(account, vault_id, side);
        if lost_usdc == U256::ZERO {
            return Err(TreasuryError::NothingLost);
        }
        self.loss_claimed.insert(key, true);
        Ok((lost_usdc * self.mint_rate()) / U256::from(USDC_ONE))
    }

    /// `amount` LVST already moved into the treasury escrow by the program.
    pub fn stake_lvst(&mut self, user: [u8; 32], amount: u128) -> TreasuryResult<()> {
        if amount == 0 {
            return Err(TreasuryError::ZeroStake);
        }
        self.settle_dividends(&user);
        self.staked_lvst_held += amount;
        *self.stake_of.entry(user).or_insert(0) += amount;
        self.total_staked += amount;
        let stake = self.stake_of[&user];
        self.reward_debt
            .insert(user, U256::from(stake) * self.acc_usdc_per_stake / U256::from(ACC_SCALE));
        Ok(())
    }

    /// Returns the LVST amount the program must transfer back to the user.
    pub fn unstake_lvst(&mut self, user: [u8; 32], amount: u128) -> TreasuryResult<u128> {
        let stake_val = self.stake_of.get(&user).copied().unwrap_or(0);
        if amount == 0 || stake_val < amount {
            return Err(TreasuryError::InvalidUnstake);
        }
        self.settle_dividends(&user);
        self.stake_of.insert(user, stake_val - amount);
        self.total_staked -= amount;
        let new_stake = self.stake_of[&user];
        self.reward_debt
            .insert(user, U256::from(new_stake) * self.acc_usdc_per_stake / U256::from(ACC_SCALE));
        self.staked_lvst_held -= amount;
        Ok(amount)
    }

    /// Returns the USDC dividends the program must pay the user.
    pub fn claim_dividends(&mut self, user: [u8; 32]) -> u128 {
        self.settle_dividends(&user);
        let amount = self.accrued_dividends.get(&user).copied().unwrap_or(0);
        if amount > 0 {
            self.accrued_dividends.insert(user, 0);
            self.usdc_held -= amount;
        }
        amount
    }

    fn settle_dividends(&mut self, user: &[u8; 32]) {
        let Some(stake) = self.stake_of.get(user).copied() else {
            return;
        };
        let acc = U256::from(stake) * self.acc_usdc_per_stake / U256::from(ACC_SCALE);
        let debt = self.reward_debt.get(user).copied().unwrap_or(U256::ZERO);
        if acc > debt {
            *self.accrued_dividends.entry(*user).or_insert(0) +=
                livestreak_math::wide::narrow(acc - debt, "dividend settle");
        }
        self.reward_debt.insert(*user, acc);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Golden mint-curve points (LVST_DECIMALS=9-scale rates per USDC-1e6):
    /// empty pool -> 100 LVST per USDC; at knee ($10k skimmed) -> ~50.5; huge pool -> floor 1.
    #[test]
    fn mint_curve_golden_points() {
        let mut t = TreasuryRegistry::default();
        assert_eq!(t.mint_rate(), U256::from(MINT_START));

        t.total_skimmed = U256::from(MINT_KNEE); // $10k skimmed
        // floor + (start-floor)/2 = 1e9 + 49.5e9 = 50.5e9
        assert_eq!(t.mint_rate(), U256::from(50_500_000_000u128));

        t.total_skimmed = U256::from(MINT_KNEE * 1_000_000);
        let near_floor = t.mint_rate();
        assert!(near_floor >= U256::from(MINT_FLOOR) && near_floor < U256::from(MINT_FLOOR + 100_000));
    }

    #[test]
    fn staking_dividends_masterchef_accounting() {
        let mut t = TreasuryRegistry::default();
        let alice = [1u8; 32];
        let bob = [2u8; 32];

        // Skim before any stake parks as undistributed.
        t.deposit_skim(1_000);
        t.notify_skim(U256::from(1_000u32));
        assert_eq!(t.undistributed, 1_000);

        // Alice stakes 100: next skim distributes 1000 (carried) + 500.
        t.stake_lvst(alice, 100).unwrap();
        t.deposit_skim(500);
        t.notify_skim(U256::from(500u32));
        assert_eq!(t.pending_dividends(&alice), 1_500);

        // Bob stakes 300; another 400 skims: alice 1500+100, bob 300.
        t.stake_lvst(bob, 300).unwrap();
        t.deposit_skim(400);
        t.notify_skim(U256::from(400u32));
        assert_eq!(t.pending_dividends(&alice), 1_600);
        assert_eq!(t.pending_dividends(&bob), 300);

        // Claims pay out exactly and zero the ledgers.
        assert_eq!(t.claim_dividends(alice), 1_600);
        assert_eq!(t.claim_dividends(bob), 300);
        assert_eq!(t.usdc_held, 0);
        assert_eq!(t.pending_dividends(&alice), 0);

        // Unstake returns the LVST.
        assert_eq!(t.unstake_lvst(alice, 100).unwrap(), 100);
        assert_eq!(t.unstake_lvst(bob, 400).unwrap_err(), TreasuryError::InvalidUnstake);
    }
}
