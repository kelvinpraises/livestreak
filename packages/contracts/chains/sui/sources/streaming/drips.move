// SPDX-License-Identifier: GPL-3.0-only

module livestreak::drips;

use livestreak::i128::{Self, I128};
use livestreak::streams::{Self, StreamReceiver, StreamsHistory, StreamsRegistry};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;
use sui::table::{Self, Table};

const DEFAULT_CYCLE_SECS: u64 = 10;
const MAX_TOTAL_BALANCE: u128 = 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF;

const E_TOTAL_BALANCE_TOO_HIGH: u64 = 1;
const E_TOKEN_BALANCE_TOO_LOW: u64 = 2;
const E_WITHDRAWAL_AMOUNT_TOO_HIGH: u64 = 3;

#[allow(lint(coin_field))]
public struct DripsRegistry<phantom T> has key {
    id: UID,
    streams_balance: u128,
    collectable_balance: u128,
    vault: Coin<T>,
    collectable_amts: Table<u256, u128>,
}

public struct DripsRegistryCreated<phantom T> has copy, drop {
    registry_id: ID,
}

public struct StreamsSet has copy, drop {
    account_id: u256,
    receiver_account_ids: vector<u256>,
    receiver_stream_ids: vector<u64>,
    receiver_amt_per_secs: vector<u256>,
    receiver_starts: vector<u64>,
    receiver_durations: vector<u64>,
    balance: u128,
    max_end: u64,
}

public struct Received has copy, drop {
    account_id: u256,
    amount: u128,
}

public struct Squeezed has copy, drop {
    account_id: u256,
    sender_id: u256,
    amount: u128,
}

public struct Collected has copy, drop {
    account_id: u256,
    amount: u128,
}

fun init(_ctx: &mut TxContext) {}

public fun create_drips_registry<T>(ctx: &mut TxContext) {
    streams::create_registry<T>(DEFAULT_CYCLE_SECS, ctx);

    let registry_id_obj = object::new(ctx);
    let registry_id = object::uid_to_inner(&registry_id_obj);

    let registry = DripsRegistry<T> {
        id: registry_id_obj,
        streams_balance: 0,
        collectable_balance: 0,
        vault: coin::zero<T>(ctx),
        collectable_amts: table::new(ctx),
    };

    event::emit(DripsRegistryCreated<T> { registry_id });
    transfer::share_object(registry);
}

public fun balances<T>(registry: &DripsRegistry<T>): (u128, u128) {
    (registry.streams_balance, registry.collectable_balance)
}

public fun held_balance<T>(registry: &DripsRegistry<T>): u128 {
    coin::value(&registry.vault) as u128
}

public fun collectable<T>(registry: &DripsRegistry<T>, account_id: u256): u128 {
    if (!table::contains(&registry.collectable_amts, account_id)) {
        0
    } else {
        *table::borrow(&registry.collectable_amts, account_id)
    }
}

public fun verify_balance_increase<T>(registry: &DripsRegistry<T>, amt: u128) {
    let new_total_balance =
        (registry.streams_balance as u256) + (registry.collectable_balance as u256) + (amt as u256);
    assert!(new_total_balance <= (MAX_TOTAL_BALANCE as u256), E_TOTAL_BALANCE_TOO_HIGH);
    let held_balance = token_balance(registry);
    assert!(new_total_balance <= (held_balance as u256), E_TOKEN_BALANCE_TOO_LOW);
}

public(package) fun deposit<T>(registry: &mut DripsRegistry<T>, coins: Coin<T>) {
    coin::join(&mut registry.vault, coins);
}

public(package) fun withdraw<T>(
    registry: &mut DripsRegistry<T>,
    _account_id: u256,
    receiver: address,
    amt: u128,
    ctx: &mut TxContext,
) {
    let payment = withdraw_coin(registry, amt, ctx);
    transfer::public_transfer(payment, receiver);
}

public(package) fun withdraw_coin<T>(
    registry: &mut DripsRegistry<T>,
    amt: u128,
    ctx: &mut TxContext,
): Coin<T> {
    let (streams_balance, collectable_balance) = balances(registry);
    let held_balance = token_balance(registry);
    let managed_balance = streams_balance + collectable_balance;
    let withdrawable = held_balance - managed_balance;
    assert!(amt <= withdrawable, E_WITHDRAWAL_AMOUNT_TOO_HIGH);
    coin::split(&mut registry.vault, (amt as u64), ctx)
}

public fun receive_streams<T>(
    drips_registry: &mut DripsRegistry<T>,
    streams_registry: &mut StreamsRegistry<T>,
    account_id: u256,
    max_cycles: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): u128 {
    let received_amt = streams::receive_streams(
        streams_registry,
        account_id,
        max_cycles,
        clock,
        ctx,
    );
    if (received_amt != 0) {
        bank_received(drips_registry, account_id, received_amt, ctx);
        event::emit(Received { account_id, amount: received_amt });
    };
    received_amt
}

public fun receivable_streams_cycles<T>(
    streams_registry: &StreamsRegistry<T>,
    account_id: u256,
    clock: &Clock,
): u64 {
    streams::receivable_streams_cycles(streams_registry, account_id, clock)
}

public fun squeeze_streams<T>(
    drips_registry: &mut DripsRegistry<T>,
    streams_registry: &mut StreamsRegistry<T>,
    account_id: u256,
    sender_id: u256,
    history_hash: vector<u8>,
    streams_history: &vector<StreamsHistory>,
    clock: &Clock,
    ctx: &mut TxContext,
): u128 {
    let squeezed_amt = streams::squeeze_streams(
        streams_registry,
        account_id,
        sender_id,
        history_hash,
        streams_history,
        clock,
        ctx,
    );
    if (squeezed_amt != 0) {
        bank_received(drips_registry, account_id, squeezed_amt, ctx);
        event::emit(Squeezed { account_id, sender_id, amount: squeezed_amt });
    };
    squeezed_amt
}

public(package) fun set_streams<T>(
    drips_registry: &mut DripsRegistry<T>,
    streams_registry: &mut StreamsRegistry<T>,
    account_id: u256,
    curr_receivers: &vector<StreamReceiver>,
    balance_delta: I128,
    new_receivers: &vector<StreamReceiver>,
    max_end_hint1: u64,
    max_end_hint2: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): I128 {
    if (!i128::is_neg(&balance_delta)) {
        increase_streams_balance(drips_registry, i128::as_u128(&balance_delta));
    };

    let real_balance_delta = streams::set_streams(
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
        let abs_delta = i128::abs(&real_balance_delta);
        decrease_streams_balance(drips_registry, i128::as_u128(&abs_delta));
    };

    real_balance_delta
}

public(package) fun collect<T>(
    drips_registry: &mut DripsRegistry<T>,
    account_id: u256,
    _ctx: &mut TxContext,
): u128 {
    if (!table::contains(&drips_registry.collectable_amts, account_id)) {
        return 0
    };
    let amt = *table::borrow(&drips_registry.collectable_amts, account_id);
    if (amt != 0) {
        *table::borrow_mut(&mut drips_registry.collectable_amts, account_id) = 0u128;
        drips_registry.collectable_balance = drips_registry.collectable_balance - amt;
        event::emit(Collected { account_id, amount: amt });
    };
    amt
}

public(package) fun emit_streams_set(
    account_id: u256,
    receiver_account_ids: vector<u256>,
    receiver_stream_ids: vector<u64>,
    receiver_amt_per_secs: vector<u256>,
    receiver_starts: vector<u64>,
    receiver_durations: vector<u64>,
    balance: u128,
    max_end: u64,
) {
    event::emit(StreamsSet {
        account_id,
        receiver_account_ids,
        receiver_stream_ids,
        receiver_amt_per_secs,
        receiver_starts,
        receiver_durations,
        balance,
        max_end,
    });
}

public(package) fun emit_streams_set_from_receivers(
    account_id: u256,
    receivers: vector<StreamReceiver>,
    balance: u128,
    max_end: u64,
) {
    let len = vector::length(&receivers);
    let mut receiver_account_ids = vector::empty<u256>();
    let mut receiver_stream_ids = vector::empty<u64>();
    let mut receiver_amt_per_secs = vector::empty<u256>();
    let mut receiver_starts = vector::empty<u64>();
    let mut receiver_durations = vector::empty<u64>();

    let mut i = 0;
    while (i < len) {
        let receiver = vector::borrow(&receivers, i);
        vector::push_back(&mut receiver_account_ids, streams::stream_receiver_account_id(receiver));
        vector::push_back(&mut receiver_stream_ids, streams::stream_receiver_stream_id(receiver));
        vector::push_back(&mut receiver_amt_per_secs, streams::stream_receiver_amt_per_sec(receiver));
        vector::push_back(&mut receiver_starts, streams::stream_receiver_start(receiver));
        vector::push_back(&mut receiver_durations, streams::stream_receiver_duration(receiver));
        i = i + 1;
    };

    emit_streams_set(
        account_id,
        receiver_account_ids,
        receiver_stream_ids,
        receiver_amt_per_secs,
        receiver_starts,
        receiver_durations,
        balance,
        max_end,
    );
}

// --- helpers ---

fun token_balance<T>(registry: &DripsRegistry<T>): u128 {
    (coin::value(&registry.vault) as u128)
}

fun increase_streams_balance<T>(registry: &mut DripsRegistry<T>, amt: u128) {
    if (amt == 0) { return };
    verify_balance_increase(registry, amt);
    registry.streams_balance = registry.streams_balance + amt;
}

fun decrease_streams_balance<T>(registry: &mut DripsRegistry<T>, amt: u128) {
    if (amt == 0) { return };
    registry.streams_balance = registry.streams_balance - amt;
}

fun bank_received<T>(
    registry: &mut DripsRegistry<T>,
    account_id: u256,
    amt: u128,
    _ctx: &mut TxContext,
) {
    registry.streams_balance = registry.streams_balance - amt;
    registry.collectable_balance = registry.collectable_balance + amt;
    if (!table::contains(&registry.collectable_amts, account_id)) {
        table::add(&mut registry.collectable_amts, account_id, amt);
    } else {
        let entry = table::borrow_mut(&mut registry.collectable_amts, account_id);
        *entry = *entry + amt;
    };
}
