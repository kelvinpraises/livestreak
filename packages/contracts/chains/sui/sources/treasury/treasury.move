// SPDX-License-Identifier: MIT

module livestreak::treasury;

use livestreak::lvst::{Self, LVST, LvstTreasuryCap};
use livestreak::side;
use livestreak::vault::{Self, VaultRegistry};
use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::event;
use sui::table::{Self, Table};

const ACC_SCALE: u256 = 1_000_000_000_000_000_000;
const USDC_ONE: u256 = 1_000_000;
const SKIM_BPS_DEFAULT: u256 = 200;
const MINT_START: u256 = 100_000_000_000;
const MINT_FLOOR: u256 = 1_000_000_000;
const MINT_KNEE: u256 = 10_000_000_000;

const E_ALREADY_CLAIMED: u64 = 1;
const E_NOTHING_LOST: u64 = 2;
const E_ZERO_STAKE: u64 = 3;
const E_INVALID_UNSTAKE: u64 = 4;

public struct TreasuryRegistry<phantom T> has key {
    id: UID,
    skim_bps: u256,
    mint_start: u256,
    mint_floor: u256,
    mint_knee: u256,
    total_skimmed: u256,
    total_staked: u128,
    acc_usdc_per_stake: u256,
    undistributed: u128,
    usdc: Balance<T>,
    staked_lvst: Balance<LVST>,
    stake_of: Table<address, u128>,
    reward_debt: Table<address, u256>,
    accrued_dividends: Table<address, u128>,
    loss_claimed: Table<LossClaimKey, bool>,
}

public struct LossClaimKey has copy, drop, store {
    account: u256,
    vault_id: vector<u8>,
    side: u8,
}

public struct Skimmed has copy, drop {
    amount: u256,
    total_skimmed: u256,
}

public struct LossLvstClaimed has copy, drop {
    user: address,
    vault_id: vector<u8>,
    side: u8,
    lost_usdc: u256,
    minted: u256,
}

public struct Staked has copy, drop {
    user: address,
    amount: u128,
}

public struct Unstaked has copy, drop {
    user: address,
    amount: u128,
}

public struct DividendsClaimed has copy, drop {
    user: address,
    amount: u128,
}

public fun create_registry<T>(ctx: &mut TxContext) {
    let registry = TreasuryRegistry<T> {
        id: object::new(ctx),
        skim_bps: SKIM_BPS_DEFAULT,
        mint_start: MINT_START,
        mint_floor: MINT_FLOOR,
        mint_knee: MINT_KNEE,
        total_skimmed: 0,
        total_staked: 0,
        acc_usdc_per_stake: 0,
        undistributed: 0,
        usdc: balance::zero<T>(),
        staked_lvst: balance::zero<LVST>(),
        stake_of: table::new(ctx),
        reward_debt: table::new(ctx),
        accrued_dividends: table::new(ctx),
        loss_claimed: table::new(ctx),
    };
    transfer::share_object(registry);
}

public fun skim_bps<T>(registry: &TreasuryRegistry<T>): u256 {
    registry.skim_bps
}

public fun total_skimmed<T>(registry: &TreasuryRegistry<T>): u256 {
    registry.total_skimmed
}

public fun mint_rate<T>(registry: &TreasuryRegistry<T>): u256 {
    registry.mint_floor
        + ((registry.mint_start - registry.mint_floor) * registry.mint_knee)
            / (registry.mint_knee + registry.total_skimmed)
}

public fun mint_start<T>(registry: &TreasuryRegistry<T>): u256 {
    registry.mint_start
}

public fun mint_floor<T>(registry: &TreasuryRegistry<T>): u256 {
    registry.mint_floor
}

public fun lvst_staked<T>(registry: &TreasuryRegistry<T>, user: address): u128 {
    if (table::contains(&registry.stake_of, user)) {
        *table::borrow(&registry.stake_of, user)
    } else {
        0
    }
}

public fun pending_dividends<T>(registry: &TreasuryRegistry<T>, user: address): u128 {
    let accrued = if (table::contains(&registry.accrued_dividends, user)) {
        *table::borrow(&registry.accrued_dividends, user)
    } else {
        0
    };
    let stake = if (table::contains(&registry.stake_of, user)) {
        *table::borrow(&registry.stake_of, user)
    } else {
        0
    };
    let debt = if (table::contains(&registry.reward_debt, user)) {
        *table::borrow(&registry.reward_debt, user)
    } else {
        0
    };
    let unsettled = (stake as u256) * registry.acc_usdc_per_stake / ACC_SCALE;
    if (unsettled > debt) {
        accrued + ((unsettled - debt) as u128)
    } else {
        accrued
    }
}

public fun treasury_usdc_balance<T>(registry: &TreasuryRegistry<T>): u128 {
    balance::value(&registry.usdc) as u128
}

public(package) fun notify_skim<T>(registry: &mut TreasuryRegistry<T>, amount: u256) {
    registry.total_skimmed = registry.total_skimmed + amount;
    let dist = amount + (registry.undistributed as u256);
    if (registry.total_staked > 0) {
        registry.acc_usdc_per_stake =
            registry.acc_usdc_per_stake + (dist * ACC_SCALE) / (registry.total_staked as u256);
        registry.undistributed = 0;
    } else {
        registry.undistributed = dist as u128;
    };
    event::emit(Skimmed { amount, total_skimmed: registry.total_skimmed });
}

public(package) fun deposit_skim<T>(registry: &mut TreasuryRegistry<T>, payment: Coin<T>) {
    balance::join(&mut registry.usdc, coin::into_balance(payment));
}

// EVM-parity trust boundary (Treasury._mintLoss): the Treasury reads the claimable loss from the
// Vault itself rather than trusting a `lost_usdc` literal supplied by the caller. The driver can no
// longer express an inflated basis — the param is gone, so it is a compile-time guarantee.
public(package) fun mint_loss_lvst<T>(
    registry: &mut TreasuryRegistry<T>,
    lvst_cap: &mut LvstTreasuryCap,
    vault_registry: &VaultRegistry<T>,
    account: u256,
    to: address,
    vault_id: vector<u8>,
    side: u8,
    ctx: &mut TxContext,
): u256 {
    side::assert_valid(side);
    let key = LossClaimKey { account, vault_id, side };
    assert!(!table::contains(&registry.loss_claimed, key), E_ALREADY_CLAIMED);
    let lost_usdc = vault::loss_claimable(vault_registry, account, &vault_id, side);
    assert!(lost_usdc > 0, E_NOTHING_LOST);
    table::add(&mut registry.loss_claimed, key, true);
    let minted = (lost_usdc * mint_rate(registry)) / USDC_ONE;
    lvst::mint(lvst_cap, minted as u128, to, ctx);
    event::emit(LossLvstClaimed {
        user: to,
        vault_id,
        side,
        lost_usdc,
        minted,
    });
    minted
}

#[test_only]
public fun set_mint_params_for_test<T>(
    registry: &mut TreasuryRegistry<T>,
    start: u256,
    floor: u256,
    knee: u256,
) {
    registry.mint_start = start;
    registry.mint_floor = floor;
    registry.mint_knee = knee;
}

#[test_only]
public fun mint_loss_lvst_for_test<T>(
    registry: &mut TreasuryRegistry<T>,
    vault_registry: &VaultRegistry<T>,
    account: u256,
    to: address,
    vault_id: vector<u8>,
    side: u8,
    ctx: &mut TxContext,
): u256 {
    side::assert_valid(side);
    let key = LossClaimKey { account, vault_id, side };
    assert!(!table::contains(&registry.loss_claimed, key), E_ALREADY_CLAIMED);
    let lost_usdc = vault::loss_claimable(vault_registry, account, &vault_id, side);
    assert!(lost_usdc > 0, E_NOTHING_LOST);
    table::add(&mut registry.loss_claimed, key, true);
    let minted = (lost_usdc * mint_rate(registry)) / USDC_ONE;
    lvst::mint_for_test(minted as u128, to, ctx);
    event::emit(LossLvstClaimed {
        user: to,
        vault_id,
        side,
        lost_usdc,
        minted,
    });
    minted
}

public fun stake_lvst<T>(
    registry: &mut TreasuryRegistry<T>,
    payment: Coin<LVST>,
    ctx: &TxContext,
) {
    let user = ctx.sender();
    let amount = coin::value(&payment) as u128;
    assert!(amount > 0, E_ZERO_STAKE);
    settle_dividends(registry, user);
    balance::join(&mut registry.staked_lvst, coin::into_balance(payment));
    if (!table::contains(&registry.stake_of, user)) {
        table::add(&mut registry.stake_of, user, amount);
    } else {
        let entry = table::borrow_mut(&mut registry.stake_of, user);
        *entry = *entry + amount;
    };
    registry.total_staked = registry.total_staked + amount;
    let stake = *table::borrow(&registry.stake_of, user);
    if (!table::contains(&registry.reward_debt, user)) {
        table::add(
            &mut registry.reward_debt,
            user,
            (stake as u256) * registry.acc_usdc_per_stake / ACC_SCALE,
        );
    } else {
        *table::borrow_mut(&mut registry.reward_debt, user) =
            (stake as u256) * registry.acc_usdc_per_stake / ACC_SCALE;
    };
    event::emit(Staked { user, amount });
}

public fun unstake_lvst<T>(
    registry: &mut TreasuryRegistry<T>,
    amount: u128,
    ctx: &mut TxContext,
) {
    let user = ctx.sender();
    assert!(amount > 0 && table::contains(&registry.stake_of, user), E_INVALID_UNSTAKE);
    let stake_val = *table::borrow(&registry.stake_of, user);
    assert!(stake_val >= amount, E_INVALID_UNSTAKE);
    settle_dividends(registry, user);
    *table::borrow_mut(&mut registry.stake_of, user) = stake_val - amount;
    registry.total_staked = registry.total_staked - amount;
    let new_stake = *table::borrow(&registry.stake_of, user);
    *table::borrow_mut(&mut registry.reward_debt, user) =
        (new_stake as u256) * registry.acc_usdc_per_stake / ACC_SCALE;
    let payment = coin::from_balance(balance::split(&mut registry.staked_lvst, (amount as u64)), ctx);
    transfer::public_transfer(payment, user);
    event::emit(Unstaked { user, amount });
}

public fun claim_dividends<T>(registry: &mut TreasuryRegistry<T>, ctx: &mut TxContext): u128 {
    let user = ctx.sender();
    settle_dividends(registry, user);
    let amount = if (table::contains(&registry.accrued_dividends, user)) {
        *table::borrow(&registry.accrued_dividends, user)
    } else {
        0
    };
    if (amount > 0) {
        *table::borrow_mut(&mut registry.accrued_dividends, user) = 0;
        let payment = coin::from_balance(balance::split(&mut registry.usdc, (amount as u64)), ctx);
        transfer::public_transfer(payment, user);
        event::emit(DividendsClaimed { user, amount });
    };
    amount
}

// --- helpers ---

fun settle_dividends<T>(registry: &mut TreasuryRegistry<T>, user: address) {
    if (!table::contains(&registry.stake_of, user)) {
        return
    };
    let stake = *table::borrow(&registry.stake_of, user);
    let acc = (stake as u256) * registry.acc_usdc_per_stake / ACC_SCALE;
    let debt = if (table::contains(&registry.reward_debt, user)) {
        *table::borrow(&registry.reward_debt, user)
    } else {
        0
    };
    if (acc > debt) {
        if (!table::contains(&registry.accrued_dividends, user)) {
            table::add(&mut registry.accrued_dividends, user, 0);
        };
        let entry = table::borrow_mut(&mut registry.accrued_dividends, user);
        *entry = *entry + ((acc - debt) as u128);
    };
    if (!table::contains(&registry.reward_debt, user)) {
        table::add(&mut registry.reward_debt, user, acc);
    } else {
        *table::borrow_mut(&mut registry.reward_debt, user) = acc;
    };
}
