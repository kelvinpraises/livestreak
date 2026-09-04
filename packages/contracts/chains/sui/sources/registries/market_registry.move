// SPDX-License-Identifier: GPL-3.0-only

module livestreak::market_registry;

use sui::clock::{Self, Clock};
use sui::event;
use sui::table::{Self, Table};

const E_EMPTY_TITLE: u64 = 1;
const E_ZERO_STREAM_ID: u64 = 2;
const E_MARKET_EXISTS: u64 = 3;
const E_UNKNOWN_MARKET: u64 = 4;
const E_NOT_CREATOR: u64 = 5;
const E_BAD_ID_LENGTH: u64 = 6;
const E_STREAM_ENDED: u64 = 7;
const E_NOT_LIVE: u64 = 8;
const E_STREAM_LOCKED: u64 = 9;
const E_BAD_SCHEME: u64 = 10;

const STREAM_STATUS_NONE: u8 = 0;
const STREAM_STATUS_LIVE: u8 = 1;
const STREAM_STATUS_ENDED: u8 = 2;

const SCHEME_WALRUS_TESTNET: u8 = 0;
const SCHEME_WALRUS_MAINNET: u8 = 1;
const SCHEME_IPFS: u8 = 2;
const SCHEME_ARWEAVE: u8 = 3;

const STREAM_LOCK_GRACE: u64 = 86_400;

const E_INDEX_OOB: u64 = 10;

public struct MarketRegistry has key {
    id: UID,
    market_count: u64,
    markets: Table<vector<u8>, MarketData>,
    vault_ids_by_market: Table<vector<u8>, vector<vector<u8>>>,
    market_ids: vector<vector<u8>>,
    stream_states: Table<vector<u8>, StreamState>,
}

public struct MarketData has copy, drop, store {
    id: vector<u8>,
    title: vector<u8>,
    stream_id: vector<u8>,
    creator: address,
    created_at: u64,
    exists: bool,
}

public struct MarketRegistered has copy, drop {
    market_id: vector<u8>,
    creator: address,
    stream_id: vector<u8>,
    title: vector<u8>,
}

public struct VaultIndexed has copy, drop {
    market_id: vector<u8>,
    vault_id: vector<u8>,
}

public struct StreamState has copy, drop, store {
    status: u8,
    scheme: u8,
    id: vector<u8>,
    updated_at: u64,
    ended_at: u64,
}

public struct StreamLive has copy, drop {
    market_id: vector<u8>,
    scheme: u8,
    id: vector<u8>,
    updated_at: u64,
}

public struct StreamEnded has copy, drop {
    market_id: vector<u8>,
    scheme: u8,
    id: vector<u8>,
    ended_at: u64,
}

public fun create_registry(ctx: &mut TxContext) {
    let registry = MarketRegistry {
        id: object::new(ctx),
        market_count: 0,
        markets: table::new(ctx),
        vault_ids_by_market: table::new(ctx),
        market_ids: vector[],
        stream_states: table::new(ctx),
    };
    transfer::share_object(registry);
}

public fun compute_market_id(observer: address, stream_id: &vector<u8>): vector<u8> {
    let mut data = std::bcs::to_bytes(&observer);
    vector::append(&mut data, *stream_id);
    hash_to_vec(sui::hash::keccak256(&data))
}

public fun market_exists(registry: &MarketRegistry, market_id: &vector<u8>): bool {
    table::contains(&registry.markets, *market_id)
        && table::borrow(&registry.markets, *market_id).exists
}

public fun register_market(
    registry: &mut MarketRegistry,
    title: vector<u8>,
    stream_id: vector<u8>,
    clock: &sui::clock::Clock,
    ctx: &TxContext,
): vector<u8> {
    assert!(vector::length(&title) > 0, E_EMPTY_TITLE);
    assert!(vector::length(&stream_id) > 0, E_ZERO_STREAM_ID);

    let market_id = compute_market_id(ctx.sender(), &stream_id);
    assert!(!market_exists(registry, &market_id), E_MARKET_EXISTS);

    let created_at = sui::clock::timestamp_ms(clock) / 1000;
    let creator = ctx.sender();
    let data = MarketData {
        id: market_id,
        title,
        stream_id,
        creator,
        created_at,
        exists: true,
    };
    let emit_stream_id = data.stream_id;
    let emit_title = data.title;
    table::add(&mut registry.markets, market_id, data);
    table::add(&mut registry.vault_ids_by_market, market_id, vector[]);
    vector::push_back(&mut registry.market_ids, market_id);
    registry.market_count = registry.market_count + 1;

    event::emit(MarketRegistered {
        market_id,
        creator,
        stream_id: emit_stream_id,
        title: emit_title,
    });

    market_id
}

public(package) fun add_vault(
    registry: &mut MarketRegistry,
    market_id: vector<u8>,
    vault_id: vector<u8>,
) {
    assert!(market_exists(registry, &market_id), E_UNKNOWN_MARKET);
    let vaults = table::borrow_mut(&mut registry.vault_ids_by_market, market_id);
    vector::push_back(vaults, vault_id);
    event::emit(VaultIndexed { market_id, vault_id });
}

public fun market_count(registry: &MarketRegistry): u64 {
    registry.market_count
}

public fun market_id_at(registry: &MarketRegistry, index: u64): vector<u8> {
    assert!(index < registry.market_count, E_INDEX_OOB);
    *vector::borrow(&registry.market_ids, index)
}

public fun get_market(registry: &MarketRegistry, market_id: &vector<u8>): MarketData {
    assert!(market_exists(registry, market_id), E_UNKNOWN_MARKET);
    *table::borrow(&registry.markets, *market_id)
}

public fun market_title(data: &MarketData): &vector<u8> {
    &data.title
}

public fun market_stream_id(data: &MarketData): &vector<u8> {
    &data.stream_id
}

public fun market_creator(data: &MarketData): address {
    data.creator
}

public fun market_created_at(data: &MarketData): u64 {
    data.created_at
}

public fun market_data_exists(data: &MarketData): bool {
    data.exists
}

public fun market_data_id(data: &MarketData): &vector<u8> {
    &data.id
}

public fun get_vault_ids(registry: &MarketRegistry, market_id: &vector<u8>): &vector<vector<u8>> {
    assert!(market_exists(registry, market_id), E_UNKNOWN_MARKET);
    table::borrow(&registry.vault_ids_by_market, *market_id)
}

public fun go_live(
    registry: &mut MarketRegistry,
    market_id: vector<u8>,
    scheme: u8,
    id: vector<u8>,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_market_creator(registry, &market_id, ctx);
    assert!(vector::length(&id) > 0 && vector::length(&id) <= 64, E_BAD_ID_LENGTH);
    assert_valid_scheme(scheme);
    let s = borrow_stream_state(registry, &market_id);
    assert!(s.status != STREAM_STATUS_ENDED, E_STREAM_ENDED);
    let updated_at = clock::timestamp_ms(clock) / 1000;
    let emit_id = id;
    s.status = STREAM_STATUS_LIVE;
    s.scheme = scheme;
    s.id = id;
    s.updated_at = updated_at;
    event::emit(StreamLive { market_id, scheme, id: emit_id, updated_at });
}

public fun set_ended(
    registry: &mut MarketRegistry,
    market_id: vector<u8>,
    scheme: u8,
    id: vector<u8>,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert_market_creator(registry, &market_id, ctx);
    assert!(vector::length(&id) > 0 && vector::length(&id) <= 64, E_BAD_ID_LENGTH);
    assert_valid_scheme(scheme);
    let s = borrow_stream_state(registry, &market_id);
    assert!(s.status != STREAM_STATUS_NONE, E_NOT_LIVE);
    assert!(!stream_is_locked(s, clock), E_STREAM_LOCKED);
    let updated_at = clock::timestamp_ms(clock) / 1000;
    let emit_id = id;
    if (s.status != STREAM_STATUS_ENDED) {
        s.status = STREAM_STATUS_ENDED;
        s.ended_at = updated_at;
    };
    s.scheme = scheme;
    s.id = id;
    s.updated_at = updated_at;
    let ended_at = s.ended_at;
    event::emit(StreamEnded { market_id, scheme, id: emit_id, ended_at });
}

public fun is_locked(registry: &MarketRegistry, market_id: &vector<u8>, clock: &Clock): bool {
    if (!table::contains(&registry.stream_states, *market_id)) {
        return false
    };
    stream_is_locked(table::borrow(&registry.stream_states, *market_id), clock)
}

public fun stream_state(registry: &MarketRegistry, market_id: &vector<u8>): StreamState {
    if (!table::contains(&registry.stream_states, *market_id)) {
        return StreamState {
            status: STREAM_STATUS_NONE,
            scheme: SCHEME_IPFS,
            id: vector[],
            updated_at: 0,
            ended_at: 0,
        }
    };
    *table::borrow(&registry.stream_states, *market_id)
}

public fun stream_status(s: &StreamState): u8 {
    s.status
}

public fun stream_scheme(s: &StreamState): u8 {
    s.scheme
}

public fun stream_content_id(s: &StreamState): &vector<u8> {
    &s.id
}

public fun stream_updated_at(s: &StreamState): u64 {
    s.updated_at
}

public fun stream_ended_at(s: &StreamState): u64 {
    s.ended_at
}

public fun status_none(): u8 {
    STREAM_STATUS_NONE
}

public fun status_live(): u8 {
    STREAM_STATUS_LIVE
}

public fun status_ended(): u8 {
    STREAM_STATUS_ENDED
}

public fun scheme_walrus_testnet(): u8 {
    SCHEME_WALRUS_TESTNET
}

public fun scheme_arweave(): u8 {
    SCHEME_ARWEAVE
}

public fun scheme_ipfs(): u8 {
    SCHEME_IPFS
}

// --- helpers ---

fun borrow_stream_state(registry: &mut MarketRegistry, market_id: &vector<u8>): &mut StreamState {
    if (!table::contains(&registry.stream_states, *market_id)) {
        table::add(
            &mut registry.stream_states,
            *market_id,
            StreamState {
                status: STREAM_STATUS_NONE,
                scheme: SCHEME_IPFS,
                id: vector[],
                updated_at: 0,
                ended_at: 0,
            },
        );
    };
    table::borrow_mut(&mut registry.stream_states, *market_id)
}

fun assert_market_creator(registry: &MarketRegistry, market_id: &vector<u8>, ctx: &TxContext) {
    assert!(market_exists(registry, market_id), E_UNKNOWN_MARKET);
    let market = table::borrow(&registry.markets, *market_id);
    assert!(market.creator == ctx.sender(), E_NOT_CREATOR);
}

fun assert_valid_scheme(scheme: u8) {
    assert!(
        scheme == SCHEME_WALRUS_TESTNET
            || scheme == SCHEME_WALRUS_MAINNET
            || scheme == SCHEME_IPFS
            || scheme == SCHEME_ARWEAVE,
        E_BAD_SCHEME,
    );
}

fun stream_is_locked(s: &StreamState, clock: &Clock): bool {
    if (s.status != STREAM_STATUS_ENDED) {
        return false
    };
    let now = clock::timestamp_ms(clock) / 1000;
    now > s.ended_at + STREAM_LOCK_GRACE
}

fun hash_to_vec(hash: vector<u8>): vector<u8> {
    hash
}
