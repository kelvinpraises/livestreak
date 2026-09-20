//! Drips custody ledger — 1:1 port of `chains/sui/sources/streaming/drips.move`.
//! `held` models the Coin<T> vault value; the Anchor layer binds it to the escrow
//! token account (SPL ATA) and keeps the two in lockstep. Events are the program
//! layer's job. Invariant: streams_balance + collectable_balance <= held.

use ruint::aliases::U256;
use serde::{Deserialize, Serialize};

extern crate alloc;
use alloc::collections::BTreeMap;
use alloc::vec::Vec;

use crate::state::{AccountId, StreamsHistory, StreamReceiver};
use crate::StreamsRegistry;

/// i128::MAX as u128 — total managed balance must stay signable.
pub const MAX_TOTAL_BALANCE: u128 = i128::MAX as u128;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DripsError {
    TotalBalanceTooHigh,
    TokenBalanceTooLow,
    WithdrawalAmountTooHigh,
    Streams(crate::state::StreamsError),
}

impl From<crate::state::StreamsError> for DripsError {
    fn from(e: crate::state::StreamsError) -> Self {
        DripsError::Streams(e)
    }
}

pub type DripsResult<T> = Result<T, DripsError>;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DripsRegistry {
    pub streams_balance: u128,
    pub collectable_balance: u128,
    /// Token units actually held by the escrow (Coin<T> value on Sui).
    pub held: u128,
    pub collectable_amts: BTreeMap<AccountId, u128>,
}

impl DripsRegistry {
    pub fn balances(&self) -> (u128, u128) {
        (self.streams_balance, self.collectable_balance)
    }

    pub fn collectable(&self, account_id: AccountId) -> u128 {
        self.collectable_amts.get(&account_id).copied().unwrap_or(0)
    }

    pub fn verify_balance_increase(&self, amt: u128) -> DripsResult<()> {
        let new_total = U256::from(self.streams_balance)
            + U256::from(self.collectable_balance)
            + U256::from(amt);
        if new_total > U256::from(MAX_TOTAL_BALANCE) {
            return Err(DripsError::TotalBalanceTooHigh);
        }
        if new_total > U256::from(self.held) {
            return Err(DripsError::TokenBalanceTooLow);
        }
        Ok(())
    }

    /// Coin joined into the vault (program layer: tokens arrived at the escrow ATA).
    pub fn deposit(&mut self, amt: u128) {
        self.held += amt;
    }

    /// Split out of the vault, only from the unmanaged surplus.
    pub fn withdraw(&mut self, amt: u128) -> DripsResult<()> {
        let managed = self.streams_balance + self.collectable_balance;
        let withdrawable = self.held - managed;
        if amt > withdrawable {
            return Err(DripsError::WithdrawalAmountTooHigh);
        }
        self.held -= amt;
        Ok(())
    }

    pub fn receive_streams(
        &mut self,
        streams: &mut StreamsRegistry,
        account_id: AccountId,
        max_cycles: u64,
        now: u64,
    ) -> u128 {
        let received = streams.receive_streams(account_id, max_cycles, now);
        if received != 0 {
            self.bank_received(account_id, received);
        }
        received
    }

    pub fn squeeze_streams(
        &mut self,
        streams: &mut StreamsRegistry,
        account_id: AccountId,
        sender_id: AccountId,
        history_hash: Vec<u8>,
        streams_history: &[StreamsHistory],
        now: u64,
    ) -> DripsResult<u128> {
        let squeezed =
            streams.squeeze_streams(account_id, sender_id, history_hash, streams_history, now)?;
        if squeezed != 0 {
            self.bank_received(account_id, squeezed);
        }
        Ok(squeezed)
    }

    /// Positive delta reserves custody BEFORE the engine applies it; the engine's
    /// capped (real) negative delta releases custody AFTER. Same order as Move.
    #[allow(clippy::too_many_arguments)]
    pub fn set_streams(
        &mut self,
        streams: &mut StreamsRegistry,
        account_id: AccountId,
        curr_receivers: &[StreamReceiver],
        balance_delta: i128,
        new_receivers: &[StreamReceiver],
        max_end_hint1: u64,
        max_end_hint2: u64,
        now: u64,
    ) -> DripsResult<i128> {
        if balance_delta >= 0 {
            self.increase_streams_balance(balance_delta as u128)?;
        }

        let real_balance_delta = streams.set_streams(
            account_id,
            curr_receivers,
            balance_delta,
            new_receivers,
            max_end_hint1,
            max_end_hint2,
            now,
        )?;

        if real_balance_delta < 0 {
            self.decrease_streams_balance(real_balance_delta.unsigned_abs());
        }

        Ok(real_balance_delta)
    }

    /// Zero the account's collectable and return it (program layer pays it out).
    pub fn collect(&mut self, account_id: AccountId) -> u128 {
        let Some(entry) = self.collectable_amts.get_mut(&account_id) else {
            return 0;
        };
        let amt = *entry;
        if amt != 0 {
            *entry = 0;
            self.collectable_balance -= amt;
        }
        amt
    }

    fn increase_streams_balance(&mut self, amt: u128) -> DripsResult<()> {
        if amt == 0 {
            return Ok(());
        }
        self.verify_balance_increase(amt)?;
        self.streams_balance += amt;
        Ok(())
    }

    fn decrease_streams_balance(&mut self, amt: u128) {
        if amt != 0 {
            self.streams_balance -= amt;
        }
    }

    fn bank_received(&mut self, account_id: AccountId, amt: u128) {
        self.streams_balance -= amt;
        self.collectable_balance += amt;
        *self.collectable_amts.entry(account_id).or_insert(0) += amt;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::StreamConfig;

    fn acct(n: u64) -> AccountId {
        U256::from(n)
    }

    fn recv(n: u64, units_per_sec: u128) -> StreamReceiver {
        StreamReceiver {
            account_id: acct(n),
            config: StreamConfig {
                stream_id: 0,
                amt_per_sec: U256::from(units_per_sec * crate::state::AMT_PER_SEC_MULTIPLIER),
                start: 0,
                duration: 0,
            },
        }
    }

    /// Full custody loop: deposit -> stream -> receive -> collect -> withdraw surplus,
    /// with the held/managed invariant intact at every step.
    #[test]
    fn custody_ledger_conserves_and_gates_withdrawals() {
        let mut streams = StreamsRegistry::new(10).unwrap();
        let mut drips = DripsRegistry::default();

        drips.deposit(1_000_000);
        // Can't reserve more than held.
        assert_eq!(
            drips
                .set_streams(&mut streams, acct(1), &[], 1_000_001, &[recv(2, 7)], 0, 0, 0)
                .unwrap_err(),
            DripsError::TokenBalanceTooLow
        );

        let applied = drips
            .set_streams(&mut streams, acct(1), &[], 800_000, &[recv(2, 7)], 0, 0, 0)
            .unwrap();
        assert_eq!(applied, 800_000);
        assert_eq!(drips.balances(), (800_000, 0));

        // Surplus is withdrawable; managed funds are not.
        assert_eq!(
            drips.withdraw(200_001).unwrap_err(),
            DripsError::WithdrawalAmountTooHigh
        );
        drips.withdraw(200_000).unwrap();
        assert_eq!(drips.held, 800_000);

        // Stream some, receive, collect: streams -> collectable -> paid out.
        let received = drips.receive_streams(&mut streams, acct(2), u64::MAX, 50);
        assert!(received > 0);
        assert_eq!(drips.balances(), (800_000 - received, received));
        assert_eq!(drips.collectable(acct(2)), received);

        let collected = drips.collect(acct(2));
        assert_eq!(collected, received);
        assert_eq!(drips.collectable_balance, 0);
        // Program layer pays out: held decreases via withdraw of the collected amt.
        drips.withdraw(collected).unwrap();

        // Ledger closes: held == streams_balance (all that remains managed).
        assert_eq!(drips.held, drips.streams_balance + drips.collectable_balance + 0);
    }

    /// Sender withdrawal caps at the live balance and releases custody exactly.
    #[test]
    fn capped_withdrawal_releases_custody_exactly() {
        let mut streams = StreamsRegistry::new(10).unwrap();
        let mut drips = DripsRegistry::default();
        drips.deposit(500_000);
        drips
            .set_streams(&mut streams, acct(1), &[], 500_000, &[recv(2, 3)], 0, 0, 0)
            .unwrap();

        // At t=100, 300 units streamed; ask to withdraw everything — engine caps.
        let applied = drips
            .set_streams(&mut streams, acct(1), &[recv(2, 3)], i128::MIN + 1, &[], 0, 0, 100)
            .unwrap();
        assert_eq!(applied, -(500_000 - 300));
        assert_eq!(drips.streams_balance, 300);
    }
}
