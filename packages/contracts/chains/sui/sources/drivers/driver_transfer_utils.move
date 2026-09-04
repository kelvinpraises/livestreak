// SPDX-License-Identifier: GPL-3.0-only

module livestreak::driver_transfer_utils;

use livestreak::drips::{Self, DripsRegistry};
use livestreak::i128::{Self, I128};
use livestreak::streams::{StreamReceiver, StreamsRegistry};
use sui::clock::Clock;
use sui::coin::Coin;

public fun collect_and_transfer<T>(
    drips_registry: &mut DripsRegistry<T>,
    account_id: u256,
    transfer_to: address,
    ctx: &mut TxContext,
): u128 {
    let amt = drips::collect(drips_registry, account_id, ctx);
    if (amt > 0) {
        drips::withdraw(drips_registry, account_id, transfer_to, amt, ctx);
    };
    amt
}

public fun set_streams_and_transfer<T>(
    drips_registry: &mut DripsRegistry<T>,
    streams_registry: &mut StreamsRegistry<T>,
    mut payment: Option<Coin<T>>,
    account_id: u256,
    curr_receivers: &vector<StreamReceiver>,
    balance_delta: I128,
    new_receivers: &vector<StreamReceiver>,
    max_end_hint1: u64,
    max_end_hint2: u64,
    transfer_to: address,
    clock: &Clock,
    ctx: &mut TxContext,
): I128 {
    if (!i128::is_neg(&balance_delta)) {
        let deposit_amt = i128::as_u128(&balance_delta);
        if (deposit_amt > 0) {
            let coin = option::extract(&mut payment);
            drips::deposit(drips_registry, coin);
        };
    };

    option::destroy_none(payment);

    let real_balance_delta = drips::set_streams(
        drips_registry,
        streams_registry,
        account_id,
        curr_receivers,
        balance_delta,
        new_receivers,
        max_end_hint1,
        max_end_hint2,
        clock,
        ctx,
    );

    if (i128::is_neg(&real_balance_delta)) {
        let neg_delta = i128::neg(&real_balance_delta);
        let withdraw_amt = i128::as_u128(&neg_delta);
        if (withdraw_amt > 0) {
            drips::withdraw(drips_registry, account_id, transfer_to, withdraw_amt, ctx);
        };
    };

    real_balance_delta
}
