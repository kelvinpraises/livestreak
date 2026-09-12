// SPDX-License-Identifier: GPL-3.0-only

module livestreak::market_driver;

use livestreak::driver_transfer_utils;
use livestreak::driver_utils::{Self, AccountMetadata};
use livestreak::i128::{Self, I128};
use livestreak::market_registry::{Self, MarketRegistry};
use livestreak::side;
use livestreak::streams::{Self, StreamReceiver, StreamsRegistry};
use livestreak::lvst::LvstTreasuryCap;
use livestreak::treasury::{Self, TreasuryRegistry};
use livestreak::vault::{Self, VaultRegistry};
use livestreak::vault_driver::{Self, VaultDriverRegistry};
use livestreak::drips::{Self, DripsRegistry};
use sui::clock::Clock;
use sui::coin::Coin;
use sui::display;
use sui::event;
use sui::package;
use sui::table::{Self, Table};

const MAX_LANES: u64 = 10;
const DRIVER_ID_SHIFT: u8 = 224;
const COLLECTION_DESCRIPTION: vector<u8> = b"LiveStreak market position NFT";
const COLLECTION_IMAGE: vector<u8> =
    b"data:image/svg+xml;charset=utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='400'><rect width='400' height='400' rx='28' fill='#0b1020'/><text x='200' y='186' fill='#ffffff' font-family='sans-serif' font-size='34' font-weight='700' text-anchor='middle'>LiveStreak</text><text x='200' y='226' fill='#7dd3fc' font-family='sans-serif' font-size='18' text-anchor='middle'>Market Position</text></svg>";

const E_SALT_USED: u64 = 1;
const E_UNKNOWN_MARKET: u64 = 2;
const E_ZERO_RATE: u64 = 3;
const E_BAD_DEPOSIT: u64 = 4;
const E_WRONG_MARKET: u64 = 5;
const E_VAULT_HAS_LANE: u64 = 6;
const E_TOO_MANY_LANES: u64 = 7;
const E_NO_LANE: u64 = 8;
const E_DUPLICATE_VAULT: u64 = 9;
// Retained (10) to document the EVM operator-redirect semantics gap; Sui object-ownership enforces
// the payee redirect, so it is no longer asserted (see `payee`).
#[allow(unused_const)]
const E_ONLY_OWNER_REDIRECT: u64 = 10;
const E_LENGTH_MISMATCH: u64 = 11;

public struct MARKET_DRIVER has drop {}

public struct MarketDriverRegistry has key {
    id: UID,
    driver_id: u32,
    minted_tokens: u64,
    used_salts: Table<SaltKey, bool>,
    market_id_of: Table<u256, vector<u8>>,
    lane_keys: Table<u256, vector<vector<u8>>>,
    lanes: Table<LaneKey, Lane>,
}

public struct SaltKey has copy, drop, store {
    minter: address,
    salt: u64,
}

public struct LaneKey has copy, drop, store {
    token_id: u256,
    vault_id: vector<u8>,
}

public struct Lane has copy, drop, store {
    vault_id: vector<u8>,
    side: u8,
    rate: u256,
}

public struct MarketPositionNFT has key, store {
    id: UID,
    token_id: u256,
}

public struct MarketNftMinted has copy, drop {
    token_id: u256,
    market_id: vector<u8>,
    to: address,
}

public struct LaneFunded has copy, drop {
    token_id: u256,
    vault_id: vector<u8>,
    side: u8,
    rate: u256,
    deposit: u128,
    max_end: u64,
}

public struct LaneStopped has copy, drop {
    token_id: u256,
    vault_id: vector<u8>,
    side: u8,
}

public struct AllLanesStopped has copy, drop {
    token_id: u256,
    refunded: u128,
}

public struct AccountMetadataEmitted has copy, drop {
    account_id: u256,
    key: vector<u8>,
    value: vector<u8>,
}

fun init(otw: MARKET_DRIVER, ctx: &mut TxContext) {
    let registry = MarketDriverRegistry {
        id: object::new(ctx),
        driver_id: 0,
        minted_tokens: 0,
        used_salts: table::new(ctx),
        market_id_of: table::new(ctx),
        lane_keys: table::new(ctx),
        lanes: table::new(ctx),
    };
    transfer::share_object(registry);

    let publisher = package::claim(otw, ctx);
    let mut display_obj = display::new<MarketPositionNFT>(&publisher, ctx);
    display::add(
        &mut display_obj,
        std::string::utf8(b"name"),
        std::string::utf8(b"Market Position #{token_id}"),
    );
    display::add(
        &mut display_obj,
        std::string::utf8(b"description"),
        std::string::utf8(COLLECTION_DESCRIPTION),
    );
    display::add(&mut display_obj, std::string::utf8(b"image_url"), std::string::utf8(COLLECTION_IMAGE));
    display::update_version(&mut display_obj);
    transfer::public_transfer(publisher, ctx.sender());
    transfer::public_transfer(display_obj, ctx.sender());
}

public fun create_registry(driver_id: u32, ctx: &mut TxContext) {
    let registry = MarketDriverRegistry {
        id: object::new(ctx),
        driver_id,
        minted_tokens: 0,
        used_salts: table::new(ctx),
        market_id_of: table::new(ctx),
        lane_keys: table::new(ctx),
        lanes: table::new(ctx),
    };
    transfer::share_object(registry);
}

public fun set_driver_id(registry: &mut MarketDriverRegistry, driver_id: u32) {
    registry.driver_id = driver_id;
}

public fun next_token_id(registry: &MarketDriverRegistry): u256 {
    calc_token_id(registry.driver_id, @0x0, registry.minted_tokens)
}

public fun calc_token_id_with_salt(registry: &MarketDriverRegistry, minter: address, salt: u64): u256 {
    calc_token_id(registry.driver_id, minter, salt)
}

public fun is_salt_used(registry: &MarketDriverRegistry, minter: address, salt: u64): bool {
    table::contains(&registry.used_salts, SaltKey { minter, salt })
}

public fun lane_count(registry: &MarketDriverRegistry, token_id: u256): u64 {
    if (!table::contains(&registry.lane_keys, token_id)) {
        0
    } else {
        vector::length(table::borrow(&registry.lane_keys, token_id))
    }
}

public fun lane_vault_at(registry: &MarketDriverRegistry, token_id: u256, index: u64): vector<u8> {
    *vector::borrow(table::borrow(&registry.lane_keys, token_id), index)
}

public fun lane_at(
    registry: &MarketDriverRegistry,
    token_id: u256,
    vault_id: &vector<u8>,
): (u8, u256) {
    let lane = *table::borrow(&registry.lanes, LaneKey { token_id, vault_id: *vault_id });
    (lane.side, lane.rate)
}

public fun get_token_id(nft: &MarketPositionNFT): u256 {
    nft.token_id
}

public fun mint(
    registry: &mut MarketDriverRegistry,
    market_registry: &MarketRegistry,
    market_id: vector<u8>,
    to: address,
    metadata: vector<AccountMetadata>,
    ctx: &mut TxContext,
): u256 {
    assert!(market_registry::market_exists(market_registry, &market_id), E_UNKNOWN_MARKET);
    let token_id = calc_token_id(registry.driver_id, @0x0, registry.minted_tokens);
    registry.minted_tokens = registry.minted_tokens + 1;
    mint_internal(registry, market_id, to, token_id, metadata, ctx);
    token_id
}

public fun mint_with_salt(
    registry: &mut MarketDriverRegistry,
    market_registry: &MarketRegistry,
    market_id: vector<u8>,
    salt: u64,
    to: address,
    metadata: vector<AccountMetadata>,
    ctx: &mut TxContext,
) {
    assert!(market_registry::market_exists(market_registry, &market_id), E_UNKNOWN_MARKET);
    let minter = ctx.sender();
    assert!(!is_salt_used(registry, minter, salt), E_SALT_USED);
    table::add(&mut registry.used_salts, SaltKey { minter, salt }, true);
    let token_id = calc_token_id(registry.driver_id, minter, salt);
    mint_internal(registry, market_id, to, token_id, metadata, ctx);
}

public fun fund<T>(
    registry: &mut MarketDriverRegistry,
    nft: &MarketPositionNFT,
    vault_driver: &mut VaultDriverRegistry,
    vault_registry: &mut VaultRegistry<T>,
    drips_registry: &mut DripsRegistry<T>,
    streams_registry: &mut StreamsRegistry<T>,
    vault_id: vector<u8>,
    side: u8,
    rate: u256,
    deposit: u128,
    payment: Coin<T>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let token_id = nft.token_id;
    assert!(rate > 0, E_ZERO_RATE);
    assert!(deposit > 0, E_BAD_DEPOSIT);
    assert_market_vault(registry, vault_registry, token_id, &vault_id);

    let lane_key = LaneKey { token_id, vault_id };
    assert!(!table::contains(&registry.lanes, lane_key), E_VAULT_HAS_LANE);
    assert!(lane_count(registry, token_id) < MAX_LANES, E_TOO_MANY_LANES);

    let curr = build_receivers(registry, vault_driver, vault_registry, token_id);
    ensure_lane_keys(registry, token_id);
    let keys = table::borrow_mut(&mut registry.lane_keys, token_id);
    vector::push_back(keys, vault_id);
    table::add(
        &mut registry.lanes,
        lane_key,
        Lane { vault_id, side, rate },
    );

    let next = build_receivers(registry, vault_driver, vault_registry, token_id);
    let balance_delta = i128::from(deposit);
    driver_transfer_utils::set_streams_and_transfer(
        drips_registry,
        streams_registry,
        option::some(payment),
        token_id,
        &curr,
        balance_delta,
        &next,
        0,
        0,
        ctx.sender(),
        clock,
        ctx,
    );

    let (_, _, _, _, max_end) = streams::streams_state(streams_registry, token_id);
    vault::on_fund(vault_registry, token_id, vault_id, side, rate, max_end, clock, ctx);
    refresh_other_lanes(registry, vault_registry, token_id, vault_id, max_end, clock, ctx);

    event::emit(LaneFunded {
        token_id,
        vault_id,
        side,
        rate,
        deposit,
        max_end,
    });
}

public fun stop<T>(
    registry: &mut MarketDriverRegistry,
    nft: &MarketPositionNFT,
    vault_driver: &mut VaultDriverRegistry,
    vault_registry: &mut VaultRegistry<T>,
    drips_registry: &mut DripsRegistry<T>,
    streams_registry: &mut StreamsRegistry<T>,
    vault_id: vector<u8>,
    side: u8,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let token_id = nft.token_id;
    let lane_key = LaneKey { token_id, vault_id };
    assert!(table::contains(&registry.lanes, lane_key), E_NO_LANE);
    let lane = *table::borrow(&registry.lanes, lane_key);
    assert!(lane.rate > 0 && lane.side == side, E_NO_LANE);

    let curr = build_receivers(registry, vault_driver, vault_registry, token_id);
    remove_lane(registry, token_id, vault_id);
    let next = build_receivers(registry, vault_driver, vault_registry, token_id);

    drips::set_streams(
        drips_registry,
        streams_registry,
        token_id,
        &curr,
        i128::zero(),
        &next,
        0,
        0,
        clock,
        ctx,
    );

    vault::on_stop(vault_registry, token_id, vault_id, side, clock);
    let (_, _, _, _, max_end) = streams::streams_state(streams_registry, token_id);
    if (lane_count(registry, token_id) > 0) {
        refresh_all_lanes(registry, vault_registry, token_id, max_end, clock, ctx);
    };

    event::emit(LaneStopped { token_id, vault_id, side });
}

public fun set_lanes<T>(
    registry: &mut MarketDriverRegistry,
    nft: &MarketPositionNFT,
    vault_driver: &mut VaultDriverRegistry,
    vault_registry: &mut VaultRegistry<T>,
    drips_registry: &mut DripsRegistry<T>,
    streams_registry: &mut StreamsRegistry<T>,
    desired_vault_ids: vector<vector<u8>>,
    desired_sides: vector<u8>,
    desired_rates: vector<u256>,
    add_deposit: u128,
    payment: Option<Coin<T>>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let token_id = nft.token_id;
    let desired_len = vector::length(&desired_vault_ids);
    assert!(desired_len <= MAX_LANES, E_TOO_MANY_LANES);
    assert!(
        desired_len == vector::length(&desired_sides) && desired_len == vector::length(&desired_rates),
        E_LENGTH_MISMATCH,
    );

    let market_id = *table::borrow(&registry.market_id_of, token_id);
    let mut i = 0;
    while (i < desired_len) {
        assert!(*vector::borrow(&desired_rates, i) > 0, E_ZERO_RATE);
        let vault_id = *vector::borrow(&desired_vault_ids, i);
        assert!(vault::market_id(vault_registry, &vault_id) == market_id, E_WRONG_MARKET);
        let mut j = 0;
        while (j < i) {
            assert!(*vector::borrow(&desired_vault_ids, j) != vault_id, E_DUPLICATE_VAULT);
            j = j + 1;
        };
        i = i + 1;
    };

    let curr = build_receivers(registry, vault_driver, vault_registry, token_id);
    let (removed_vaults, removed_sides, removed_n) = diff_removed(registry, token_id, &desired_vault_ids, &desired_sides, &desired_rates);
    let (added_vaults, added_sides, added_rates, added_n) = diff_added(registry, vault_registry, token_id, &desired_vault_ids, &desired_sides, &desired_rates, clock);

    clear_lanes(registry, token_id);
    let mut k = 0;
    while (k < desired_len) {
        let vault_id = *vector::borrow(&desired_vault_ids, k);
        let side = *vector::borrow(&desired_sides, k);
        let rate = *vector::borrow(&desired_rates, k);
        ensure_lane_keys(registry, token_id);
        vector::push_back(table::borrow_mut(&mut registry.lane_keys, token_id), vault_id);
        table::add(
            &mut registry.lanes,
            LaneKey { token_id, vault_id },
            Lane { vault_id, side, rate },
        );
        k = k + 1;
    };

    let next = build_receivers(registry, vault_driver, vault_registry, token_id);
    let balance_delta = if (add_deposit > 0) {
        i128::from(add_deposit)
    } else {
        i128::zero()
    };
    driver_transfer_utils::set_streams_and_transfer(
        drips_registry,
        streams_registry,
        payment,
        token_id,
        &curr,
        balance_delta,
        &next,
        0,
        0,
        ctx.sender(),
        clock,
        ctx,
    );

    let (_, _, _, _, max_end) = streams::streams_state(streams_registry, token_id);

    let mut r = 0;
    while (r < removed_n) {
        let vault_id = *vector::borrow(&removed_vaults, r);
        let side = *vector::borrow(&removed_sides, r);
        vault::on_stop(vault_registry, token_id, vault_id, side, clock);
        event::emit(LaneStopped { token_id, vault_id, side });
        r = r + 1;
    };

    let mut a = 0;
    while (a < added_n) {
        let vault_id = *vector::borrow(&added_vaults, a);
        let side = *vector::borrow(&added_sides, a);
        let rate = *vector::borrow(&added_rates, a);
        vault::on_fund(vault_registry, token_id, vault_id, side, rate, max_end, clock, ctx);
        event::emit(LaneFunded {
            token_id,
            vault_id,
            side,
            rate,
            deposit: 0,
            max_end,
        });
        a = a + 1;
    };

    if (desired_len > 0) {
        vault::refresh_max_ends(vault_registry, token_id, desired_vault_ids, desired_sides, max_end, clock, ctx);
    };
}

public fun stop_all<T>(
    registry: &mut MarketDriverRegistry,
    nft: &MarketPositionNFT,
    vault_driver: &mut VaultDriverRegistry,
    vault_registry: &mut VaultRegistry<T>,
    drips_registry: &mut DripsRegistry<T>,
    streams_registry: &mut StreamsRegistry<T>,
    clock: &Clock,
    ctx: &mut TxContext,
): u128 {
    let token_id = nft.token_id;
    let curr = build_receivers(registry, vault_driver, vault_registry, token_id);
    stop_all_lanes_on_vault(registry, vault_registry, token_id, clock);

    let empty = vector[];
    let withdraw_all = i128::neg_from(1_000_000_000_000_000_000_000_000);
    let real_delta = drips::set_streams(
        drips_registry,
        streams_registry,
        token_id,
        &curr,
        withdraw_all,
        &empty,
        0,
        0,
        clock,
        ctx,
    );

    let mut refunded = 0u128;
    if (i128::is_neg(&real_delta)) {
        refunded = i128::as_u128(&i128::abs(&real_delta));
        drips::withdraw(drips_registry, token_id, ctx.sender(), refunded, ctx);
    };

    event::emit(AllLanesStopped { token_id, refunded });
    refunded
}

public fun withdraw<T>(
    _registry: &MarketDriverRegistry,
    nft: &MarketPositionNFT,
    vault_registry: &mut VaultRegistry<T>,
    vault_id: vector<u8>,
    to: address,
    clock: &Clock,
    ctx: &mut TxContext,
): u128 {
    let token_id = nft.token_id;
    let payee = payee(nft, to, ctx);
    vault::withdraw(vault_registry, token_id, vault_id, payee, clock, ctx)
}

/// Pull winnings + overage for many vaults in one call (batch form).
/// Same ownership / redirect rules as the single-vault `withdraw`.
/// The caller builds `vault_ids` from `vault::account_vault_ids`.
public fun withdraw_many<T>(
    _registry: &MarketDriverRegistry,
    nft: &MarketPositionNFT,
    vault_registry: &mut VaultRegistry<T>,
    vault_ids: vector<vector<u8>>,
    to: address,
    clock: &Clock,
    ctx: &mut TxContext,
): u128 {
    let token_id = nft.token_id;
    let payee = payee(nft, to, ctx);
    let len = vector::length(&vault_ids);
    let mut total = 0u128;
    let mut i = 0;
    while (i < len) {
        let vault_id = *vector::borrow(&vault_ids, i);
        total = total + vault::withdraw(vault_registry, token_id, vault_id, payee, clock, ctx);
        i = i + 1;
    };
    total
}

public fun claim_loss_lvst<T>(
    _registry: &MarketDriverRegistry,
    nft: &MarketPositionNFT,
    treasury: &mut TreasuryRegistry<T>,
    lvst_cap: &mut LvstTreasuryCap,
    vault_registry: &VaultRegistry<T>,
    vault_id: vector<u8>,
    side: u8,
    to: address,
    ctx: &mut TxContext,
): u256 {
    let token_id = nft.token_id;
    let payee = payee(nft, to, ctx);
    // CON.S2: Treasury now reads the claimable loss from the Vault itself (EVM-identical trust
    // boundary). We pass the &VaultRegistry instead of a caller-computed `lost_usdc` basis.
    treasury::mint_loss_lvst(
        treasury,
        lvst_cap,
        vault_registry,
        token_id,
        payee,
        vault_id,
        side,
        ctx,
    )
}

// --- helpers ---

fun mint_internal(
    registry: &mut MarketDriverRegistry,
    market_id: vector<u8>,
    to: address,
    token_id: u256,
    metadata: vector<AccountMetadata>,
    ctx: &mut TxContext,
) {
    table::add(&mut registry.market_id_of, token_id, market_id);
    let nft = MarketPositionNFT {
        id: object::new(ctx),
        token_id,
    };
    emit_metadata(token_id, metadata);
    event::emit(MarketNftMinted { token_id, market_id, to });
    transfer::public_transfer(nft, to);
}

fun diff_removed(
    registry: &MarketDriverRegistry,
    token_id: u256,
    desired_vault_ids: &vector<vector<u8>>,
    desired_sides: &vector<u8>,
    desired_rates: &vector<u256>,
): (vector<vector<u8>>, vector<u8>, u64) {
    let mut removed_vaults = vector[];
    let mut removed_sides = vector[];
    let mut removed_n = 0u64;
    if (!table::contains(&registry.lane_keys, token_id)) {
        return (removed_vaults, removed_sides, removed_n)
    };
    let keys = table::borrow(&registry.lane_keys, token_id);
    let len = vector::length(keys);
    let mut i = 0;
    while (i < len) {
        let vault_id = *vector::borrow(keys, i);
        let lane = *table::borrow(&registry.lanes, LaneKey { token_id, vault_id });
        if (!exactly_in(desired_vault_ids, desired_sides, desired_rates, &lane)) {
            vector::push_back(&mut removed_vaults, vault_id);
            vector::push_back(&mut removed_sides, lane.side);
            removed_n = removed_n + 1;
        };
        i = i + 1;
    };
    (removed_vaults, removed_sides, removed_n)
}

fun diff_added<T>(
    registry: &MarketDriverRegistry,
    vault_registry: &VaultRegistry<T>,
    token_id: u256,
    desired_vault_ids: &vector<vector<u8>>,
    desired_sides: &vector<u8>,
    desired_rates: &vector<u256>,
    clock: &Clock,
): (vector<vector<u8>>, vector<u8>, vector<u256>, u64) {
    let mut added_vaults = vector[];
    let mut added_sides = vector[];
    let mut added_rates = vector[];
    let mut added_n = 0u64;
    let len = vector::length(desired_vault_ids);
    let mut k = 0;
    while (k < len) {
        let vault_id = *vector::borrow(desired_vault_ids, k);
        let side = *vector::borrow(desired_sides, k);
        let rate = *vector::borrow(desired_rates, k);
        let held = if (table::contains(&registry.lanes, LaneKey { token_id, vault_id })) {
            *table::borrow(&registry.lanes, LaneKey { token_id, vault_id })
        } else {
            Lane { vault_id, side: side::yes(), rate: 0 }
        };
        let mut changed = held.rate != rate || held.side != side;
        // Re-open a run-dry position even when bookkeeping looks unchanged (parity with the EVM revival
        // fix): depletion lives in the Vault and isn't mirrored here, so a same-rate re-fund must still
        // on_fund — the only path that clears `depleted`. Also re-open when the lane has run dry
        // (max_end passed) but the Board is merely BEHIND on that boundary — on an idle chain nothing
        // pokes advance, so `depleted` reads false while the deposit is already spent. Skipping on_fund
        // there leaves refresh_max_ends to no-op on the about-to-deplete lane, so a top-up's Drips
        // delivery is booked nowhere and strands at resolution. Treat max_end<=now as run-dry.
        if (!changed) {
            let (p_rate, _, _, p_max_end, depleted, _, _) =
                vault::get_position(vault_registry, &vault_id, side, token_id);
            let now = sui::clock::timestamp_ms(clock) / 1000;
            changed = depleted || (p_rate > 0 && p_max_end != 0 && p_max_end <= now);
        };
        if (changed) {
            vector::push_back(&mut added_vaults, vault_id);
            vector::push_back(&mut added_sides, side);
            vector::push_back(&mut added_rates, rate);
            added_n = added_n + 1;
        };
        k = k + 1;
    };
    (added_vaults, added_sides, added_rates, added_n)
}

fun exactly_in(
    desired_vault_ids: &vector<vector<u8>>,
    desired_sides: &vector<u8>,
    desired_rates: &vector<u256>,
    lane: &Lane,
): bool {
    let len = vector::length(desired_vault_ids);
    let mut i = 0;
    while (i < len) {
        if (
            *vector::borrow(desired_vault_ids, i) == lane.vault_id
                && *vector::borrow(desired_sides, i) == lane.side
                && *vector::borrow(desired_rates, i) == lane.rate
        ) {
            return true
        };
        i = i + 1;
    };
    false
}

fun clear_lanes(registry: &mut MarketDriverRegistry, token_id: u256) {
    if (!table::contains(&registry.lane_keys, token_id)) {
        return
    };
    let keys = *table::borrow(&registry.lane_keys, token_id);
    let len = vector::length(&keys);
    let mut i = 0;
    while (i < len) {
        let vault_id = *vector::borrow(&keys, i);
        table::remove(&mut registry.lanes, LaneKey { token_id, vault_id });
        i = i + 1;
    };
    table::remove(&mut registry.lane_keys, token_id);
}

fun calc_token_id(driver_id: u32, minter: address, salt: u64): u256 {
    let mut token_id = (driver_id as u256);
    token_id = (token_id << 160) | addr_to_u160(minter);
    token_id = (token_id << 64) | (salt as u256);
    token_id
}

fun addr_to_u160(addr: address): u256 {
    let bytes = std::bcs::to_bytes(&addr);
    let mut result: u256 = 0;
    let mut i = 0;
    while (i < 32) {
        result = (result << 8) | (*vector::borrow(&bytes, i) as u256);
        i = i + 1;
    };
    result & 0x000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
}

fun assert_market_vault<T>(
    registry: &MarketDriverRegistry,
    vault_registry: &VaultRegistry<T>,
    token_id: u256,
    vault_id: &vector<u8>,
) {
    let market_id = *table::borrow(&registry.market_id_of, token_id);
    assert!(vault::market_id(vault_registry, vault_id) == market_id, E_WRONG_MARKET);
}

fun ensure_lane_keys(registry: &mut MarketDriverRegistry, token_id: u256) {
    if (!table::contains(&registry.lane_keys, token_id)) {
        table::add(&mut registry.lane_keys, token_id, vector[]);
    };
}

fun build_receivers<T>(
    registry: &MarketDriverRegistry,
    vault_driver: &mut VaultDriverRegistry,
    vault_registry: &VaultRegistry<T>,
    token_id: u256,
): vector<StreamReceiver> {
    build_receivers_impl(registry, vault_driver, vault_registry, token_id)
}

fun build_receivers_impl<T>(
    registry: &MarketDriverRegistry,
    vault_driver: &mut VaultDriverRegistry,
    vault_registry: &VaultRegistry<T>,
    token_id: u256,
): vector<StreamReceiver> {
    if (!table::contains(&registry.lane_keys, token_id)) {
        return vector[]
    };
    let keys = table::borrow(&registry.lane_keys, token_id);
    let len = vector::length(keys);
    let mut receivers = vector[];
    let amt_mul = streams::amt_per_sec_multiplier();
    let mut i = 0;
    while (i < len) {
        let vault_id = *vector::borrow(keys, i);
        let lane_key = LaneKey { token_id, vault_id };
        let lane = table::borrow(&registry.lanes, lane_key);
        let recv = vault_driver::receiver_account(vault_driver, vault_registry, vault_id, lane.side);
        vector::push_back(
            &mut receivers,
            streams::new_stream_receiver(recv, 0, lane.rate * amt_mul, 0, 0),
        );
        i = i + 1;
    };
    sort_receivers(&mut receivers);
    receivers
}

fun sort_receivers(receivers: &mut vector<StreamReceiver>) {
    let n = vector::length(receivers);
    let mut i = 1;
    while (i < n) {
        let x = *vector::borrow(receivers, i);
        let x_acct = streams::stream_receiver_account_id(&x);
        let mut j = i;
        while (j > 0) {
            let prev = vector::borrow(receivers, j - 1);
            if (streams::stream_receiver_account_id(prev) <= x_acct) {
                break
            };
            *vector::borrow_mut(receivers, j) = *vector::borrow(receivers, j - 1);
            j = j - 1;
        };
        *vector::borrow_mut(receivers, j) = x;
        i = i + 1;
    };
}

fun remove_lane(registry: &mut MarketDriverRegistry, token_id: u256, vault_id: vector<u8>) {
    let keys = table::borrow_mut(&mut registry.lane_keys, token_id);
    let len = vector::length(keys);
    let mut i = 0;
    while (i < len) {
        if (*vector::borrow(keys, i) == vault_id) {
            *vector::borrow_mut(keys, i) = *vector::borrow(keys, len - 1);
            vector::pop_back(keys);
            let lane_key = LaneKey { token_id, vault_id };
            table::remove(&mut registry.lanes, lane_key);
            return
        };
        i = i + 1;
    };
}

fun refresh_other_lanes<T>(
    registry: &MarketDriverRegistry,
    vault_registry: &mut VaultRegistry<T>,
    token_id: u256,
    new_vault_id: vector<u8>,
    max_end: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    if (!table::contains(&registry.lane_keys, token_id)) {
        return
    };
    let keys = table::borrow(&registry.lane_keys, token_id);
    let len = vector::length(keys);
    if (len <= 1) {
        return
    };
    let mut vault_ids = vector[];
    let mut sides = vector[];
    let mut i = 0;
    while (i < len) {
        let vault_id = *vector::borrow(keys, i);
        if (vault_id != new_vault_id) {
            let lane = table::borrow(&registry.lanes, LaneKey { token_id, vault_id });
            vector::push_back(&mut vault_ids, vault_id);
            vector::push_back(&mut sides, lane.side);
        };
        i = i + 1;
    };
    vault::refresh_max_ends(vault_registry, token_id, vault_ids, sides, max_end, clock, ctx);
}

fun refresh_all_lanes<T>(
    registry: &MarketDriverRegistry,
    vault_registry: &mut VaultRegistry<T>,
    token_id: u256,
    max_end: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    if (!table::contains(&registry.lane_keys, token_id)) {
        return
    };
    let keys = table::borrow(&registry.lane_keys, token_id);
    let len = vector::length(keys);
    let mut vault_ids = vector[];
    let mut sides = vector[];
    let mut i = 0;
    while (i < len) {
        let vault_id = *vector::borrow(keys, i);
        let lane = table::borrow(&registry.lanes, LaneKey { token_id, vault_id });
        vector::push_back(&mut vault_ids, vault_id);
        vector::push_back(&mut sides, lane.side);
        i = i + 1;
    };
    vault::refresh_max_ends(vault_registry, token_id, vault_ids, sides, max_end, clock, ctx);
}

fun stop_all_lanes_on_vault<T>(
    registry: &mut MarketDriverRegistry,
    vault_registry: &mut VaultRegistry<T>,
    token_id: u256,
    clock: &Clock,
) {
    if (!table::contains(&registry.lane_keys, token_id)) {
        return
    };
    let keys = *table::borrow(&registry.lane_keys, token_id);
    let len = vector::length(&keys);
    let mut i = 0;
    while (i < len) {
        let vault_id = *vector::borrow(&keys, i);
        let lane = *table::borrow(&registry.lanes, LaneKey { token_id, vault_id });
        vault::on_stop(vault_registry, token_id, vault_id, lane.side, clock);
        i = i + 1;
    };
    table::remove(&mut registry.lane_keys, token_id);
    let mut j = 0;
    while (j < len) {
        let vault_id = *vector::borrow(&keys, j);
        table::remove(&mut registry.lanes, LaneKey { token_id, vault_id });
        j = j + 1;
    };
}

fun payee(_nft: &MarketPositionNFT, to: address, ctx: &TxContext): address {
    let owner = ctx.sender();
    if (to == @0x0 || to == owner) {
        owner
    } else {
        // EVM gates redirect on ERC721 owner/approved (operator-redirect). On Sui the NFT is an owned
        // object: only its owner can pass it into this PTB, so object-ownership already enforces the
        // gate — the old `assert!(ctx.sender() == owner)` was a tautology (owner == ctx.sender()).
        // Kept as a deliberate marker of the EVM operator-redirect semantics gap (no approve on Sui).
        to
    }
}

fun emit_metadata(token_id: u256, metadata: vector<AccountMetadata>) {
    let len = vector::length(&metadata);
    let mut i = 0;
    while (i < len) {
        let meta = vector::borrow(&metadata, i);
        event::emit(AccountMetadataEmitted {
            account_id: token_id,
            key: driver_utils::account_metadata_key(meta),
            value: driver_utils::account_metadata_value(meta),
        });
        i = i + 1;
    };
}
