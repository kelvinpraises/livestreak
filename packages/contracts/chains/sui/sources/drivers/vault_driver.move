// SPDX-License-Identifier: GPL-3.0-only

module livestreak::vault_driver;

use livestreak::driver_registry::{Self, DriverRegistry};
use livestreak::driver_transfer_utils;
use livestreak::i128::{Self, I128};
use livestreak::market_registry::{Self, MarketRegistry};
use livestreak::side;
use livestreak::streams::{Self, StreamReceiver, StreamsRegistry};
use livestreak::vault::{Self, VaultRegistry};
use livestreak::drips::{Self, DripsRegistry};
use livestreak::treasury::{Self, TreasuryRegistry};
use sui::clock::Clock;
use sui::coin::{Self, Coin};
use sui::event;
use sui::table::{Self, Table};

const SEED_ACCOUNT_BIT: u256 = 1 << 127;
const DRIVER_ID_SHIFT: u8 = 224;

const E_STREAMING_ALREADY_BOOTSTRAPPED: u64 = 1;
const E_ZERO_RATE: u64 = 2;
const E_BAD_DEPOSIT: u64 = 3;
const E_UNKNOWN_MARKET: u64 = 4;
const E_SEED_EXISTS: u64 = 5;
const E_NO_SEED: u64 = 6;

public struct VaultDriverRegistry has key {
    id: UID,
    driver_id: u32,
    bootstrapped: bool,
    next_pool_id: u64,
    pool_id_of: Table<PoolKey, u64>,
    seeds: Table<SeedKey, SeedLane>,
}

public struct PoolKey has copy, drop, store {
    vault_id: vector<u8>,
    side: u8,
}

public struct SeedKey has copy, drop, store {
    vault_id: vector<u8>,
    creator: address,
}

public struct SeedLane has copy, drop, store {
    side: u8,
    rate: u256,
    active: bool,
}

public struct StreamingSet has copy, drop {
    driver_id: u32,
}

public struct VaultCreated has copy, drop {
    market_id: vector<u8>,
    vault_id: vector<u8>,
    creator: address,
    question: vector<u8>,
}

public struct SeedOpened has copy, drop {
    vault_id: vector<u8>,
    creator: address,
    side: u8,
    rate: u256,
    deposit: u128,
    max_end: u64,
}

public struct SeedStopped has copy, drop {
    vault_id: vector<u8>,
    creator: address,
    side: u8,
}

public fun create_registry(ctx: &mut TxContext) {
    let registry = VaultDriverRegistry {
        id: object::new(ctx),
        driver_id: 0,
        bootstrapped: false,
        next_pool_id: 1,
        pool_id_of: table::new(ctx),
        seeds: table::new(ctx),
    };
    transfer::share_object(registry);
}

public fun bootstrap_streaming(
    registry: &mut VaultDriverRegistry,
    driver_registry: &mut DriverRegistry,
) {
    assert!(!registry.bootstrapped, E_STREAMING_ALREADY_BOOTSTRAPPED);
    let driver_id = driver_registry::register_driver(driver_registry);
    registry.driver_id = driver_id;
    registry.bootstrapped = true;
    event::emit(StreamingSet { driver_id });
}

public fun seed_account(registry: &VaultDriverRegistry, creator: address, vault_id: vector<u8>): u256 {
    let tag = seed_tag(creator, &vault_id);
    ((registry.driver_id as u256) << DRIVER_ID_SHIFT) | SEED_ACCOUNT_BIT | (tag as u256)
}

public fun receiver_account_view(registry: &VaultDriverRegistry, vault_id: vector<u8>, side: u8): u256 {
    side::assert_valid(side);
    let key = PoolKey { vault_id, side };
    let pool_id = if (table::contains(&registry.pool_id_of, key)) {
        *table::borrow(&registry.pool_id_of, key)
    } else {
        0
    };
    receiver_from_pool(registry.driver_id, pool_id)
}

public(package) fun receiver_account<T>(
    registry: &mut VaultDriverRegistry,
    vault: &VaultRegistry<T>,
    vault_id: vector<u8>,
    side: u8,
): u256 {
    side::assert_valid(side);
    assert!(vault::vault_exists(vault, &vault_id), E_UNKNOWN_MARKET);
    let key = PoolKey { vault_id, side };
    let pool_id = if (table::contains(&registry.pool_id_of, key)) {
        *table::borrow(&registry.pool_id_of, key)
    } else {
        let pid = registry.next_pool_id;
        registry.next_pool_id = pid + 1;
        table::add(&mut registry.pool_id_of, key, pid);
        pid
    };
    receiver_from_pool(registry.driver_id, pool_id)
}

public fun create_vault<T>(
    registry: &mut VaultDriverRegistry,
    vault_registry: &mut VaultRegistry<T>,
    market_registry: &mut MarketRegistry,
    drips_registry: &mut DripsRegistry<T>,
    streams_registry: &mut StreamsRegistry<T>,
    market_id: vector<u8>,
    question: vector<u8>,
    seed_side: u8,
    rate: u256,
    deposit: u128,
    payment: Coin<T>,
    clock: &Clock,
    ctx: &mut TxContext,
): vector<u8> {
    assert!(rate > 0, E_ZERO_RATE);
    assert!(deposit > 0, E_BAD_DEPOSIT);
    assert!(market_registry::market_exists(market_registry, &market_id), E_UNKNOWN_MARKET);

    let creator = ctx.sender();
    let emit_question = question;
    let vault_id = vault::create_vault(vault_registry, market_id, question, creator, clock);
    let indexed_market_id = vault::market_id(vault_registry, &vault_id);
    market_registry::add_vault(market_registry, indexed_market_id, vault_id);

    event::emit(VaultCreated {
        market_id: indexed_market_id,
        vault_id,
        creator,
        question: emit_question,
    });

    let seed_key = SeedKey { vault_id, creator };
    assert!(!table::contains(&registry.seeds, seed_key), E_SEED_EXISTS);

    let account = seed_account(registry, creator, vault_id);
    let receiver = receiver_account(registry, vault_registry, vault_id, seed_side);

    let amt_mul = streams::amt_per_sec_multiplier();
    let amt_per_sec = rate * amt_mul;
    let mut recv = vector[streams::new_stream_receiver(receiver, 0, amt_per_sec, 0, 0)];
    let empty = vector[];
    let balance_delta = i128::from(deposit);

    driver_transfer_utils::set_streams_and_transfer(
        drips_registry,
        streams_registry,
        option::some(payment),
        account,
        &empty,
        balance_delta,
        &recv,
        0,
        0,
        creator,
        clock,
        ctx,
    );

    let (_, _, _, _, max_end) = streams::streams_state(streams_registry, account);
    vault::on_fund(vault_registry, account, vault_id, seed_side, rate, max_end, clock, ctx);

    table::add(
        &mut registry.seeds,
        seed_key,
        SeedLane { side: seed_side, rate, active: true },
    );

    event::emit(SeedOpened {
        vault_id,
        creator,
        side: seed_side,
        rate,
        deposit,
        max_end,
    });

    vault_id
}

public fun stop_seed<T>(
    registry: &mut VaultDriverRegistry,
    vault_registry: &mut VaultRegistry<T>,
    drips_registry: &mut DripsRegistry<T>,
    streams_registry: &mut StreamsRegistry<T>,
    vault_id: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
): u128 {
    let creator = ctx.sender();
    let seed_key = SeedKey { vault_id, creator };
    assert!(table::contains(&registry.seeds, seed_key), E_NO_SEED);
    let lane = *table::borrow(&registry.seeds, seed_key);
    assert!(lane.active, E_NO_SEED);

    let account = seed_account(registry, creator, vault_id);
    let receiver = receiver_account_view(registry, vault_id, lane.side);
    let amt_mul = streams::amt_per_sec_multiplier();
    let mut curr = vector[streams::new_stream_receiver(receiver, 0, lane.rate * amt_mul, 0, 0)];
    let empty = vector[];
    let withdraw_all = i128::neg_from(1_000_000_000_000_000_000_000_000);

    let real_delta = drips::set_streams(
        drips_registry,
        streams_registry,
        account,
        &curr,
        withdraw_all,
        &empty,
        0,
        0,
        clock,
        ctx,
    );

    vault::on_stop(vault_registry, account, vault_id, lane.side, clock);
    let seed = table::borrow_mut(&mut registry.seeds, seed_key);
    seed.active = false;

    let mut refunded = 0u128;
    if (i128::is_neg(&real_delta)) {
        refunded = i128::as_u128(&i128::abs(&real_delta));
        drips::withdraw(drips_registry, account, creator, refunded, ctx);
    };

    event::emit(SeedStopped { vault_id, creator, side: lane.side });
    refunded
}

public fun harvest<T>(
    registry: &VaultDriverRegistry,
    vault_registry: &mut VaultRegistry<T>,
    drips_registry: &mut DripsRegistry<T>,
    streams_registry: &mut StreamsRegistry<T>,
    vault_id: vector<u8>,
    side: u8,
    clock: &Clock,
    ctx: &mut TxContext,
): u128 {
    side::assert_valid(side);
    let receiver = receiver_account_view(registry, vault_id, side);
    if (receiver == 0) {
        return 0
    };
    drips::receive_streams(
        drips_registry,
        streams_registry,
        receiver,
        0xFFFFFFFF,
        clock,
        ctx,
    );
    let amt = drips::collect(drips_registry, receiver, ctx);
    if (amt > 0) {
        let payment = drips::withdraw_coin(drips_registry, amt, ctx);
        vault::join_usdc(vault_registry, payment);
    };
    amt
}

public fun withdraw_seed<T>(
    vault_registry: &mut VaultRegistry<T>,
    registry: &VaultDriverRegistry,
    vault_id: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
): u128 {
    let creator = ctx.sender();
    let account = seed_account(registry, creator, vault_id);
    vault::withdraw(vault_registry, account, vault_id, creator, clock, ctx) as u128
}

public fun collect_vault<T>(
    registry: &VaultDriverRegistry,
    vault_registry: &mut VaultRegistry<T>,
    drips_registry: &mut DripsRegistry<T>,
    streams_registry: &mut StreamsRegistry<T>,
    treasury: &mut TreasuryRegistry<T>,
    vault_id: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let yes_receiver = receiver_account_view(registry, vault_id, side::yes());
    let no_receiver = receiver_account_view(registry, vault_id, side::no());
    let skim_bps = treasury::skim_bps(treasury);
    vault::collect(
        vault_registry,
        drips_registry,
        streams_registry,
        vault_id,
        yes_receiver,
        no_receiver,
        skim_bps,
        clock,
        ctx,
    );
    let (payment, owed) = vault::drain_skim(vault_registry, vault_id, ctx);
    if (owed > 0) {
        treasury::deposit_skim(treasury, payment);
        treasury::notify_skim(treasury, owed);
    } else {
        coin::destroy_zero(payment);
    };
}

// --- helpers ---

fun receiver_from_pool(driver_id: u32, pool_id: u64): u256 {
    ((driver_id as u256) << DRIVER_ID_SHIFT) | (pool_id as u256)
}

fun seed_tag(creator: address, vault_id: &vector<u8>): u128 {
    let mut data = b"livestreak.seed";
    vector::append(&mut data, std::bcs::to_bytes(&creator));
    vector::append(&mut data, *vault_id);
    let hash = sui::hash::keccak256(&data);
    let mut tag: u128 = 0;
    let mut i = 0;
    while (i < 16) {
        tag = (tag << 8) | (*vector::borrow(&hash, i) as u128);
        i = i + 1;
    };
    tag
}
