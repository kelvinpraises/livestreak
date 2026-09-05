// SPDX-License-Identifier: GPL-3.0-only

module livestreak::vault;

use livestreak::bonding_board;
use livestreak::drips::{Self, DripsRegistry};
use livestreak::side;
use livestreak::streams::StreamsRegistry;
use sui::clock::Clock;
use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::event;
use sui::table::{Self, Table};

const MAX_STEPS: u64 = 64;
const BPS_DENOM: u256 = 10_000;
const UNLIMITED_STEPS: u64 = 1_000_000;

const STATUS_OPEN: u8 = 0;
const STATUS_LOCKED: u8 = 2;
const STATUS_RESOLVED: u8 = 3;

const OUTCOME_PENDING: u8 = 0;
const OUTCOME_YES: u8 = 1;
const OUTCOME_NO: u8 = 2;

const E_EMPTY_QUESTION: u64 = 1;
const E_ZERO_CREATOR: u64 = 2;
const E_UNKNOWN_VAULT: u64 = 3;
const E_NOT_OPEN: u64 = 4;
const E_ZERO_RATE: u64 = 5;
const E_ALREADY_FUNDING: u64 = 6;
const E_LENGTH_MISMATCH: u64 = 7;
const E_NOT_RESOLVABLE: u64 = 8;
const E_NOT_RESOLVED: u64 = 10;
const E_BOARD_BEHIND: u64 = 11;
const E_DIV_ZERO: u64 = 12;
const E_INSUFFICIENT_USDC: u64 = 13;

public struct VaultRegistry<phantom T> has key {
    id: UID,
    usdc: Balance<T>,
    treasury_id: Option<ID>,
    nonce: u64,
    vaults: Table<vector<u8>, VaultData>,
    boards: Table<BoardKey, Board>,
    positions: Table<PositionKey, Position>,
    boundaries: Table<BoardKey, vector<Boundary>>,
    boundary_heads: Table<BoardKey, u64>,
    pot: Table<vector<u8>, u256>,
    collected: Table<vector<u8>, bool>,
    claimed: Table<PositionKey, bool>,
    overage_owed: Table<PositionKey, u256>,
    overage_paid: Table<PositionKey, u256>,
    account_vaults: Table<u256, vector<vector<u8>>>,
    account_in_vault: Table<AccountVaultKey, bool>,
    skim_owed: Table<vector<u8>, u256>,
}

public struct VaultData has copy, drop, store {
    id: vector<u8>,
    market_id: vector<u8>,
    question: vector<u8>,
    creator: address,
    status: u8,
    outcome: u8,
    resolved_at: u64,
    exists: bool,
}

public struct Board has copy, drop, store {
    pool: u256,
    side_rate: u256,
    g: u256,
    last_advance: u64,
    side_shares: u256,
}

public struct Position has copy, drop, store {
    rate: u256,
    g_paid: u256,
    shares_accrued: u256,
    max_end: u64,
    depleted: bool,
    fund_start: u64,
    lost_usdc: u256,
}

public struct Boundary has copy, drop, store {
    max_end: u64,
    account: u256,
}

public struct BoardKey has copy, drop, store {
    vault_id: vector<u8>,
    side: u8,
}

public struct PositionKey has copy, drop, store {
    vault_id: vector<u8>,
    side: u8,
    account: u256,
}

public struct AccountVaultKey has copy, drop, store {
    account: u256,
    vault_id: vector<u8>,
}

public struct VaultOpened has copy, drop {
    vault_id: vector<u8>,
    market_id: vector<u8>,
    creator: address,
    question: vector<u8>,
}

public struct VaultResolved has copy, drop {
    vault_id: vector<u8>,
    outcome: u8,
}

public struct Funded has copy, drop {
    vault_id: vector<u8>,
    side: u8,
    account: u256,
    rate: u256,
    max_end: u64,
}

public struct Stopped has copy, drop {
    vault_id: vector<u8>,
    side: u8,
    account: u256,
    shares_accrued: u256,
}

public struct Collected has copy, drop {
    vault_id: vector<u8>,
    pot: u256,
}

public struct Claimed has copy, drop {
    vault_id: vector<u8>,
    side: u8,
    account: u256,
    shares: u256,
    payout: u256,
}

public struct OverageRecorded has copy, drop {
    vault_id: vector<u8>,
    side: u8,
    account: u256,
    amount: u256,
}

public struct OverageReclaimed has copy, drop {
    vault_id: vector<u8>,
    side: u8,
    account: u256,
    amount: u256,
}

public struct Withdrawn has copy, drop {
    vault_id: vector<u8>,
    account: u256,
    payee: address,
    amount: u256,
}

public struct Skimmed has copy, drop {
    vault_id: vector<u8>,
    amount: u256,
}

public fun create_registry<T>(ctx: &mut TxContext) {
    let registry = VaultRegistry<T> {
        id: object::new(ctx),
        usdc: balance::zero<T>(),
        treasury_id: option::none(),
        nonce: 0,
        vaults: table::new(ctx),
        boards: table::new(ctx),
        positions: table::new(ctx),
        boundaries: table::new(ctx),
        boundary_heads: table::new(ctx),
        pot: table::new(ctx),
        collected: table::new(ctx),
        claimed: table::new(ctx),
        overage_owed: table::new(ctx),
        overage_paid: table::new(ctx),
        account_vaults: table::new(ctx),
        account_in_vault: table::new(ctx),
        skim_owed: table::new(ctx),
    };
    transfer::share_object(registry);
}

public fun set_treasury_id<T>(registry: &mut VaultRegistry<T>, treasury_id: Option<ID>) {
    registry.treasury_id = treasury_id;
}

public fun vault_exists<T>(registry: &VaultRegistry<T>, vault_id: &vector<u8>): bool {
    table::contains(&registry.vaults, *vault_id)
        && table::borrow(&registry.vaults, *vault_id).exists
}

public fun market_id<T>(registry: &VaultRegistry<T>, vault_id: &vector<u8>): vector<u8> {
    assert!(vault_exists(registry, vault_id), E_UNKNOWN_VAULT);
    table::borrow(&registry.vaults, *vault_id).market_id
}

public fun get_vault<T>(registry: &VaultRegistry<T>, vault_id: &vector<u8>): VaultData {
    assert!(vault_exists(registry, vault_id), E_UNKNOWN_VAULT);
    *table::borrow(&registry.vaults, *vault_id)
}

public fun vault_status(data: &VaultData): u8 {
    data.status
}

public fun vault_outcome(data: &VaultData): u8 {
    data.outcome
}

public fun vault_resolved_at(data: &VaultData): u64 {
    data.resolved_at
}

public fun pot<T>(registry: &VaultRegistry<T>, vault_id: &vector<u8>): u256 {
    if (!table::contains(&registry.pot, *vault_id)) {
        0
    } else {
        *table::borrow(&registry.pot, *vault_id)
    }
}

public fun usdc_balance<T>(registry: &VaultRegistry<T>): u128 {
    balance::value(&registry.usdc) as u128
}

public fun pending_shares<T>(
    registry: &VaultRegistry<T>,
    vault_id: &vector<u8>,
    side: u8,
    account: u256,
    clock: &Clock,
): u256 {
    side::assert_valid(side);
    let key = PositionKey { vault_id: *vault_id, side, account };
    if (!table::contains(&registry.positions, key)) {
        return 0
    };
    let p = table::borrow(&registry.positions, key);
    let mut cap_ts = timestamp_secs(clock);
    let data = table::borrow(&registry.vaults, *vault_id);
    if (data.resolved_at != 0 && (data.resolved_at as u64) < cap_ts) {
        cap_ts = data.resolved_at;
    };
    if (!p.depleted && p.max_end != 0 && p.max_end < cap_ts) {
        cap_ts = p.max_end;
    };
    let g_now = preview_g_at(registry, vault_id, side, cap_ts);
    p.shares_accrued + p.rate * (g_now - p.g_paid)
}

public fun get_position<T>(
    registry: &VaultRegistry<T>,
    vault_id: &vector<u8>,
    side: u8,
    account: u256,
): (u256, u256, u256, u64, bool, u64, u256) {
    side::assert_valid(side);
    let key = PositionKey { vault_id: *vault_id, side, account };
    if (!table::contains(&registry.positions, key)) {
        return (0, 0, 0, 0, false, 0, 0)
    };
    let p = table::borrow(&registry.positions, key);
    (p.rate, p.g_paid, p.shares_accrued, p.max_end, p.depleted, p.fund_start, p.lost_usdc)
}

public fun get_board<T>(
    registry: &VaultRegistry<T>,
    vault_id: &vector<u8>,
    side: u8,
): (u256, u256, u256, u64) {
    side::assert_valid(side);
    let key = BoardKey { vault_id: *vault_id, side };
    if (!table::contains(&registry.boards, key)) {
        return (0, 0, 0, 0)
    };
    let b = table::borrow(&registry.boards, key);
    (b.pool, b.side_rate, b.g, b.last_advance)
}

public fun caught_up<T>(
    registry: &VaultRegistry<T>,
    vault_id: &vector<u8>,
    side: u8,
    clock: &Clock,
): bool {
    side::assert_valid(side);
    board_caught_up(registry, vault_id, side, clock)
}

/// Count of un-drained depletion boundaries on (vault_id, side) — for pre-advance planning before fund.
public fun pending_boundaries<T>(registry: &VaultRegistry<T>, vault_id: &vector<u8>, side: u8): u64 {
    let key = BoardKey { vault_id: *vault_id, side };
    if (!table::contains(&registry.boundaries, key)) {
        return 0
    };
    let len = vector::length(table::borrow(&registry.boundaries, key));
    let head = if (table::contains(&registry.boundary_heads, key)) {
        *table::borrow(&registry.boundary_heads, key)
    } else {
        0
    };
    len - head
}

public fun status_resolved(): u8 {
    STATUS_RESOLVED
}

public fun get_vault_pools<T>(
    registry: &VaultRegistry<T>,
    vault_id: &vector<u8>,
): (u256, u256, u256, u256) {
    assert!(vault_exists(registry, vault_id), E_UNKNOWN_VAULT);
    let yes_key = BoardKey { vault_id: *vault_id, side: side::yes() };
    let no_key = BoardKey { vault_id: *vault_id, side: side::no() };
    let yes_pool = board_pool(registry, yes_key);
    let no_pool = board_pool(registry, no_key);
    let yes_shares = board_side_shares(registry, yes_key) / bonding_board::wad();
    let no_shares = board_side_shares(registry, no_key) / bonding_board::wad();
    (yes_pool, no_pool, yes_shares, no_shares)
}

public fun loss_claimable<T>(
    registry: &VaultRegistry<T>,
    account: u256,
    vault_id: &vector<u8>,
    side: u8,
): u256 {
    side::assert_valid(side);
    if (!vault_exists(registry, vault_id)) {
        return 0
    };
    let data = table::borrow(&registry.vaults, *vault_id);
    if (data.status != STATUS_RESOLVED) {
        return 0
    };
    let winning = if (data.outcome == OUTCOME_YES) {
        side::yes()
    } else {
        side::no()
    };
    if (side == winning) {
        return 0
    };
    let key = PositionKey { vault_id: *vault_id, side, account };
    if (!table::contains(&registry.positions, key)) {
        return 0
    };
    let p = table::borrow(&registry.positions, key);
    loss_usdc(p, data.resolved_at)
}

/// Preview the USDC payout `withdraw` would deliver for `account` on `vault_id`.
/// Returns 0 until resolved AND collected (pot is final only after collect).
/// Returns 0 for the losing side, a non-funder, or an already-claimed position.
/// Read-only and devInspect-friendly: no `&mut` references.
public fun claimable<T>(
    registry: &VaultRegistry<T>,
    account: u256,
    vault_id: &vector<u8>,
    side: u8,
): u256 {
    side::assert_valid(side);
    if (!vault_exists(registry, vault_id)) {
        return 0
    };
    let data = table::borrow(&registry.vaults, *vault_id);
    if (data.status != STATUS_RESOLVED) {
        return 0
    };
    if (!table::contains(&registry.collected, *vault_id)
        || !*table::borrow(&registry.collected, *vault_id)) {
        return 0
    };
    let winning = if (data.outcome == OUTCOME_YES) {
        side::yes()
    } else {
        side::no()
    };
    if (side != winning) {
        return 0
    };
    let claim_key = PositionKey { vault_id: *vault_id, side, account };
    if (table::contains(&registry.claimed, claim_key)
        && *table::borrow(&registry.claimed, claim_key)) {
        return 0
    };
    let board_key = BoardKey { vault_id: *vault_id, side };
    if (!table::contains(&registry.boards, board_key)) {
        return 0
    };
    let b = table::borrow(&registry.boards, board_key);
    if (b.side_shares == 0) {
        return 0
    };
    if (!table::contains(&registry.positions, claim_key)) {
        return 0
    };
    let p = table::borrow(&registry.positions, claim_key);
    let shares = p.shares_accrued + p.rate * (b.g - p.g_paid);
    if (shares == 0) {
        return 0
    };
    let pot_amt = if (table::contains(&registry.pot, *vault_id)) {
        *table::borrow(&registry.pot, *vault_id)
    } else {
        0
    };
    full_mul_div(pot_amt, shares, b.side_shares)
}

public fun advance<T>(
    registry: &mut VaultRegistry<T>,
    vault_id: vector<u8>,
    side: u8,
    max_steps: u64,
    clock: &Clock,
) {
    side::assert_valid(side);
    let steps = if (max_steps == 0) { MAX_STEPS } else { max_steps };
    advance_internal(registry, vault_id, side, steps, clock);
}

public fun settle<T>(
    registry: &mut VaultRegistry<T>,
    vault_id: vector<u8>,
    side: u8,
    account: u256,
    clock: &Clock,
) {
    side::assert_valid(side);
    advance_internal(registry, vault_id, side, MAX_STEPS, clock);
    settle_internal(registry, vault_id, side, account);
}

public fun collect<T>(
    registry: &mut VaultRegistry<T>,
    drips_registry: &mut DripsRegistry<T>,
    streams_registry: &mut StreamsRegistry<T>,
    vault_id: vector<u8>,
    yes_receiver: u256,
    no_receiver: u256,
    skim_bps: u256,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    assert!(vault_exists(registry, &vault_id), E_UNKNOWN_VAULT);
    let status = table::borrow(&registry.vaults, vault_id).status;
    assert!(status == STATUS_RESOLVED, E_NOT_RESOLVED);

    catch_up_side(registry, vault_id, side::yes(), clock);
    catch_up_side(registry, vault_id, side::no(), clock);

    if (!table::contains(&registry.collected, vault_id)) {
        table::add(&mut registry.collected, vault_id, false);
    };
    if (!*table::borrow(&registry.collected, vault_id)) {
        *table::borrow_mut(&mut registry.collected, vault_id) = true;
        finalize_pot(registry, vault_id, skim_bps);
    };

    harvest_receiver(registry, drips_registry, streams_registry, yes_receiver, clock, ctx);
    harvest_receiver(registry, drips_registry, streams_registry, no_receiver, clock, ctx);

    let pot_amt = if (table::contains(&registry.pot, vault_id)) {
        *table::borrow(&registry.pot, vault_id)
    } else {
        0
    };
    event::emit(Collected { vault_id, pot: pot_amt });
}

public fun drain_skim<T>(
    registry: &mut VaultRegistry<T>,
    vault_id: vector<u8>,
    ctx: &mut TxContext,
): (Coin<T>, u256) {
    if (!table::contains(&registry.skim_owed, vault_id)) {
        return (coin::zero<T>(ctx), 0)
    };
    let owed = *table::borrow(&registry.skim_owed, vault_id);
    if (owed == 0) {
        return (coin::zero<T>(ctx), 0)
    };
    let bal = balance::value(&registry.usdc) as u256;
    if (bal < owed) {
        return (coin::zero<T>(ctx), 0)
    };
    *table::borrow_mut(&mut registry.skim_owed, vault_id) = 0;
    let payment = coin::from_balance(balance::split(&mut registry.usdc, (owed as u64)), ctx);
    event::emit(Skimmed { vault_id, amount: owed });
    (payment, owed)
}

public(package) fun create_vault<T>(
    registry: &mut VaultRegistry<T>,
    market_id: vector<u8>,
    question: vector<u8>,
    creator: address,
    clock: &Clock,
): vector<u8> {
    assert!(vector::length(&question) > 0, E_EMPTY_QUESTION);
    assert!(creator != @0x0, E_ZERO_CREATOR);

    let ts = timestamp_secs(clock);
    let vault_id = compute_vault_id(&market_id, &question, registry.nonce, ts);
    registry.nonce = registry.nonce + 1;

    let data = VaultData {
        id: vault_id,
        market_id,
        question,
        creator,
        status: STATUS_OPEN,
        outcome: OUTCOME_PENDING,
        resolved_at: 0,
        exists: true,
    };
    table::add(&mut registry.vaults, vault_id, data);

    event::emit(VaultOpened {
        vault_id,
        market_id: data.market_id,
        creator,
        question: data.question,
    });

    vault_id
}

public(package) fun resolve<T>(
    registry: &mut VaultRegistry<T>,
    vault_id: vector<u8>,
    winning_side: u8,
    clock: &Clock,
    _ctx: &TxContext,
) {
    side::assert_valid(winning_side);
    assert!(vault_exists(registry, &vault_id), E_UNKNOWN_VAULT);
    let data = table::borrow_mut(&mut registry.vaults, vault_id);
    assert!(
        data.status == STATUS_OPEN || data.status == STATUS_LOCKED,
        E_NOT_RESOLVABLE,
    );
    let outcome = if (winning_side == side::yes()) {
        OUTCOME_YES
    } else {
        OUTCOME_NO
    };
    data.status = STATUS_RESOLVED;
    data.outcome = outcome;
    data.resolved_at = timestamp_secs(clock);
    event::emit(VaultResolved { vault_id, outcome });
}

public(package) fun on_fund<T>(
    registry: &mut VaultRegistry<T>,
    account: u256,
    vault_id: vector<u8>,
    side: u8,
    rate: u256,
    max_end: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    side::assert_valid(side);
    assert!(vault_exists(registry, &vault_id), E_UNKNOWN_VAULT);
    let vault = table::borrow(&registry.vaults, vault_id);
    assert!(vault.status == STATUS_OPEN, E_NOT_OPEN);
    assert!(rate > 0, E_ZERO_RATE);

    track_account_vault(registry, account, vault_id, ctx);
    advance_to_now(registry, vault_id, side, clock);

    let board_key = BoardKey { vault_id, side };
    ensure_board(registry, board_key, timestamp_secs(clock), ctx);

    let key = PositionKey { vault_id, side, account };
    if (!table::contains(&registry.positions, key)) {
        table::add(
            &mut registry.positions,
            key,
            empty_position(),
        );
    };
    let p = table::borrow_mut(&mut registry.positions, key);
    assert!(p.rate == 0 && !p.depleted, E_ALREADY_FUNDING);

    let g = table::borrow(&registry.boards, board_key).g;
    p.rate = rate;
    p.g_paid = g;
    p.max_end = max_end;
    p.fund_start = timestamp_secs(clock);

    let board = table::borrow_mut(&mut registry.boards, board_key);
    board.side_rate = board.side_rate + rate;

    schedule_boundary(registry, vault_id, side, max_end, account, ctx);

    event::emit(Funded { vault_id, side, account, rate, max_end });
}

public(package) fun on_stop<T>(
    registry: &mut VaultRegistry<T>,
    account: u256,
    vault_id: vector<u8>,
    side: u8,
    clock: &Clock,
) {
    side::assert_valid(side);
    advance_to_now(registry, vault_id, side, clock);

    let key = PositionKey { vault_id, side, account };
    if (!table::contains(&registry.positions, key)) {
        return
    };

    settle_internal(registry, vault_id, side, account);

    let now_ts = timestamp_secs(clock);
    let resolved_at = table::borrow(&registry.vaults, vault_id).resolved_at;
    let (shares_accrued, rate, depleted, max_end, fund_start, lost_usdc) = {
        let p = table::borrow(&registry.positions, key);
        (
            p.shares_accrued,
            p.rate,
            p.depleted,
            p.max_end,
            p.fund_start,
            p.lost_usdc,
        )
    };

    let mut over_amount = 0u256;
    if (rate > 0 && !depleted) {
        let mut loss_end = if (max_end < now_ts) { max_end } else { now_ts };
        if (resolved_at != 0 && resolved_at < loss_end) {
            loss_end = resolved_at;
        };
        let mut new_lost = lost_usdc;
        if (loss_end > fund_start) {
            new_lost = new_lost + rate * ((loss_end - fund_start) as u256);
        };

        if (resolved_at != 0 && now_ts > resolved_at) {
            let mut over_end = if (max_end < now_ts) { max_end } else { now_ts };
            if (over_end > resolved_at) {
                over_amount = rate * ((over_end - resolved_at) as u256);
            };
        };

        let board_key = BoardKey { vault_id, side };
        let board = table::borrow_mut(&mut registry.boards, board_key);
        board.side_rate = board.side_rate - rate;
        let p = table::borrow_mut(&mut registry.positions, key);
        p.lost_usdc = new_lost;
        p.rate = 0;
    };

    if (over_amount > 0) {
        add_overage_owed(registry, key, over_amount);
        event::emit(OverageRecorded { vault_id, side, account, amount: over_amount });
    };

    event::emit(Stopped { vault_id, side, account, shares_accrued });
}

public(package) fun refresh_max_ends<T>(
    registry: &mut VaultRegistry<T>,
    account: u256,
    vault_ids: vector<vector<u8>>,
    sides: vector<u8>,
    new_max_end: u64,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let len = vector::length(&vault_ids);
    assert!(len == vector::length(&sides), E_LENGTH_MISMATCH);
    let mut i = 0;
    while (i < len) {
        let vault_id = *vector::borrow(&vault_ids, i);
        let side_val = *vector::borrow(&sides, i);
        side::assert_valid(side_val);
        advance_to_now(registry, vault_id, side_val, clock);
        settle_internal(registry, vault_id, side_val, account);
        let key = PositionKey { vault_id, side: side_val, account };
        if (table::contains(&registry.positions, key)) {
            let p = table::borrow_mut(&mut registry.positions, key);
            if (p.rate > 0 && !p.depleted && new_max_end != p.max_end) {
                p.max_end = new_max_end;
                schedule_boundary(registry, vault_id, side_val, new_max_end, account, ctx);
            };
        };
        i = i + 1;
    };
}

public(package) fun withdraw<T>(
    registry: &mut VaultRegistry<T>,
    account: u256,
    vault_id: vector<u8>,
    payee: address,
    clock: &Clock,
    ctx: &mut TxContext,
): u128 {
    if (!vault_exists(registry, &vault_id)) {
        return 0
    };
    let data = table::borrow(&registry.vaults, vault_id);
    if (data.status != STATUS_RESOLVED) {
        return 0
    };
    if (!table::contains(&registry.collected, vault_id)
        || !*table::borrow(&registry.collected, vault_id)) {
        return 0
    };

    let winning = if (data.outcome == OUTCOME_YES) {
        side::yes()
    } else {
        side::no()
    };
    let resolved_at = data.resolved_at;

    catch_up_side(registry, vault_id, side::yes(), clock);
    catch_up_side(registry, vault_id, side::no(), clock);

    let mut total = pay_winnings(
        registry,
        account,
        vault_id,
        side::yes(),
        winning,
        payee,
        ctx,
    );
    total = total + pay_winnings(
        registry,
        account,
        vault_id,
        side::no(),
        winning,
        payee,
        ctx,
    );
    total = total + pay_overage(
        registry,
        account,
        vault_id,
        side::yes(),
        payee,
        resolved_at,
        clock,
        ctx,
    );
    total = total + pay_overage(
        registry,
        account,
        vault_id,
        side::no(),
        payee,
        resolved_at,
        clock,
        ctx,
    );

    if (total > 0) {
        event::emit(Withdrawn {
            vault_id,
            account,
            payee,
            amount: total as u256,
        });
    };
    total
}

public(package) fun join_usdc<T>(registry: &mut VaultRegistry<T>, payment: Coin<T>) {
    balance::join(&mut registry.usdc, coin::into_balance(payment));
}

// --- helpers ---

fun empty_position(): Position {
    Position {
        rate: 0,
        g_paid: 0,
        shares_accrued: 0,
        max_end: 0,
        depleted: false,
        fund_start: 0,
        lost_usdc: 0,
    }
}

fun timestamp_secs(clock: &Clock): u64 {
    sui::clock::timestamp_ms(clock) / 1000
}

fun compute_vault_id(
    market_id: &vector<u8>,
    question: &vector<u8>,
    nonce: u64,
    timestamp: u64,
): vector<u8> {
    let mut data = vector[];
    vector::append(&mut data, *market_id);
    vector::append(&mut data, *question);
    vector::append(&mut data, std::bcs::to_bytes(&nonce));
    vector::append(&mut data, std::bcs::to_bytes(&timestamp));
    sui::hash::keccak256(&data)
}

fun track_account_vault<T>(
    registry: &mut VaultRegistry<T>,
    account: u256,
    vault_id: vector<u8>,
    ctx: &mut TxContext,
) {
    let av_key = AccountVaultKey { account, vault_id };
    if (table::contains(&registry.account_in_vault, av_key)) {
        return
    };
    table::add(&mut registry.account_in_vault, av_key, true);
    if (!table::contains(&registry.account_vaults, account)) {
        table::add(&mut registry.account_vaults, account, vector[]);
    };
    let vaults = table::borrow_mut(&mut registry.account_vaults, account);
    vector::push_back(vaults, vault_id);
}

fun ensure_board<T>(
    registry: &mut VaultRegistry<T>,
    key: BoardKey,
    now_ts: u64,
    ctx: &mut TxContext,
) {
    if (!table::contains(&registry.boards, key)) {
        table::add(
            &mut registry.boards,
            key,
            Board {
                pool: 0,
                side_rate: 0,
                g: 0,
                last_advance: now_ts,
                side_shares: 0,
            },
        );
        table::add(&mut registry.boundaries, key, vector[]);
        table::add(&mut registry.boundary_heads, key, 0);
    };
}

fun board_caught_up<T>(
    registry: &VaultRegistry<T>,
    vault_id: &vector<u8>,
    side: u8,
    clock: &Clock,
): bool {
    let key = BoardKey { vault_id: *vault_id, side };
    if (!table::contains(&registry.boards, key)) {
        return true
    };
    let last = table::borrow(&registry.boards, key).last_advance;
    if (last == 0) {
        return true
    };
    let mut target = timestamp_secs(clock);
    let resolved_at = table::borrow(&registry.vaults, *vault_id).resolved_at;
    if (resolved_at != 0 && resolved_at < target) {
        target = resolved_at;
    };
    last == target
}

fun advance_to_now<T>(
    registry: &mut VaultRegistry<T>,
    vault_id: vector<u8>,
    side: u8,
    clock: &Clock,
) {
    advance_internal(registry, vault_id, side, MAX_STEPS, clock);
    assert!(board_caught_up(registry, &vault_id, side, clock), E_BOARD_BEHIND);
}

fun catch_up_side<T>(
    registry: &mut VaultRegistry<T>,
    vault_id: vector<u8>,
    side: u8,
    clock: &Clock,
) {
    let mut guard = 0u64;
    while (!board_caught_up(registry, &vault_id, side, clock) && guard < UNLIMITED_STEPS) {
        advance_internal(registry, vault_id, side, MAX_STEPS, clock);
        guard = guard + 1;
    };
    // If the backlog exceeds the in-tx guard, abort with a clear signal rather than silently
    // finalizing on a half-advanced board. The brick-free drain is the permissionless `advance`
    // entrypoint: the operator should call it (bounded, off the collect/withdraw critical path)
    // until the board is caught up, then retry. (EVM uses a single `_advance(max)`.)
    assert!(board_caught_up(registry, &vault_id, side, clock), E_BOARD_BEHIND);
}

fun advance_internal<T>(
    registry: &mut VaultRegistry<T>,
    vault_id: vector<u8>,
    side: u8,
    max_steps: u64,
    clock: &Clock,
) {
    let board_key = BoardKey { vault_id, side };
    if (!table::contains(&registry.boards, board_key)) {
        return
    };

    let now_ts = timestamp_secs(clock);
    let resolved_at = table::borrow(&registry.vaults, vault_id).resolved_at;
    let mut now_cap = now_ts;
    if (resolved_at != 0 && resolved_at < now_cap) {
        now_cap = resolved_at;
    };

    let last_advance = table::borrow(&registry.boards, board_key).last_advance;
    if (last_advance == 0) {
        let board = table::borrow_mut(&mut registry.boards, board_key);
        board.last_advance = now_ts;
        return
    };

    let mut t = last_advance;
    let mut head = *table::borrow(&registry.boundary_heads, board_key);
    let len = vector::length(table::borrow(&registry.boundaries, board_key));
    let mut steps = 0u64;

    while (steps < max_steps && head < len) {
        let boundary = *vector::borrow(table::borrow(&registry.boundaries, board_key), head);
        if (boundary.max_end > now_cap) {
            break
        };
        let boundary_account = boundary.account;
        let b_max_end = boundary.max_end;

        let pos_key = PositionKey { vault_id, side, account: boundary_account };
        let (rate, depleted, max_end) = if (table::contains(&registry.positions, pos_key)) {
            let p = table::borrow(&registry.positions, pos_key);
            (p.rate, p.depleted, p.max_end)
        } else {
            (0, false, 0)
        };

        if (rate > 0 && !depleted && max_end == b_max_end) {
            {
                let board = table::borrow_mut(&mut registry.boards, board_key);
                segment(board, t, b_max_end);
            };
            let g = table::borrow(&registry.boards, board_key).g;
            if (table::contains(&registry.positions, pos_key)) {
                settle_at_g(table::borrow_mut(&mut registry.positions, pos_key), g);
                let p = table::borrow_mut(&mut registry.positions, pos_key);
                if (b_max_end > p.fund_start) {
                    p.lost_usdc = p.lost_usdc + p.rate * ((b_max_end - p.fund_start) as u256);
                };
                let stream_rate = p.rate;
                p.rate = 0;
                p.depleted = true;
                let board = table::borrow_mut(&mut registry.boards, board_key);
                board.side_rate = board.side_rate - stream_rate;
            };
            t = b_max_end;
        };

        head = head + 1;
        steps = steps + 1;
    };
    *table::borrow_mut(&mut registry.boundary_heads, board_key) = head;

    let more_due = head < len
        && vector::borrow(table::borrow(&registry.boundaries, board_key), head).max_end <= now_cap;
    if (!more_due && t < now_cap) {
        let board = table::borrow_mut(&mut registry.boards, board_key);
        segment(board, t, now_cap);
        t = now_cap;
    };
    let board = table::borrow_mut(&mut registry.boards, board_key);
    board.last_advance = t;
}

fun preview_g_at<T>(
    registry: &VaultRegistry<T>,
    vault_id: &vector<u8>,
    side: u8,
    cap_ts: u64,
): u256 {
    let board_key = BoardKey { vault_id: *vault_id, side };
    if (!table::contains(&registry.boards, board_key)) {
        return 0
    };
    let board = table::borrow(&registry.boards, board_key);
    let mut g = board.g;
    let last = board.last_advance;
    if (last == 0 || cap_ts <= last || board.side_rate == 0) {
        return g
    };
    let (_, d_g) = bonding_board::seg_math(board.pool, board.side_rate, (cap_ts - last) as u256);
    g + d_g
}

fun segment(board: &mut Board, t0: u64, t1: u64) {
    if (t1 <= t0 || board.side_rate == 0) {
        return
    };
    let dt = (t1 - t0) as u256;
    let (new_pool, d_g) = bonding_board::seg_math(board.pool, board.side_rate, dt);
    board.side_shares = board.side_shares + board.side_rate * d_g;
    board.pool = new_pool;
    board.g = board.g + d_g;
}

fun settle_internal<T>(
    registry: &mut VaultRegistry<T>,
    vault_id: vector<u8>,
    side: u8,
    account: u256,
) {
    let board_key = BoardKey { vault_id, side };
    if (!table::contains(&registry.boards, board_key)) {
        return
    };
    let g = table::borrow(&registry.boards, board_key).g;
    let key = PositionKey { vault_id, side, account };
    if (!table::contains(&registry.positions, key)) {
        return
    };
    settle_at_g(table::borrow_mut(&mut registry.positions, key), g);
}

fun settle_at_g(p: &mut Position, g: u256) {
    if (p.g_paid == g) {
        return
    };
    let d = p.rate * (g - p.g_paid);
    p.shares_accrued = p.shares_accrued + d;
    p.g_paid = g;
}

fun schedule_boundary<T>(
    registry: &mut VaultRegistry<T>,
    vault_id: vector<u8>,
    side: u8,
    max_end: u64,
    account: u256,
    ctx: &mut TxContext,
) {
    let key = BoardKey { vault_id, side };
    if (!table::contains(&registry.boundaries, key)) {
        table::add(&mut registry.boundaries, key, vector[]);
        table::add(&mut registry.boundary_heads, key, 0);
    };
    let arr = table::borrow_mut(&mut registry.boundaries, key);
    vector::push_back(arr, Boundary { max_end, account });
    let len = vector::length(arr);
    let head = *table::borrow(&registry.boundary_heads, key);
    let mut i = len - 1;
    while (i > head) {
        let prev_max = vector::borrow(arr, i - 1).max_end;
        let curr_max = vector::borrow(arr, i).max_end;
        if (prev_max <= curr_max) {
            break
        };
        let curr_boundary = *vector::borrow(arr, i);
        let prev_boundary = *vector::borrow(arr, i - 1);
        *vector::borrow_mut(arr, i) = prev_boundary;
        *vector::borrow_mut(arr, i - 1) = curr_boundary;
        i = i - 1;
    };
}

fun loss_usdc(p: &Position, resolved_at: u64): u256 {
    let mut total = p.lost_usdc;
    if (p.rate > 0) {
        let end = if (p.max_end < resolved_at) { p.max_end } else { resolved_at };
        if (end > p.fund_start) {
            total = total + p.rate * ((end - p.fund_start) as u256);
        };
    };
    total
}

fun finalize_pot<T>(
    registry: &mut VaultRegistry<T>,
    vault_id: vector<u8>,
    skim_bps: u256,
) {
    let data = table::borrow(&registry.vaults, vault_id);
    let winning = if (data.outcome == OUTCOME_YES) {
        side::yes()
    } else {
        side::no()
    };
    let losing = if (winning == side::yes()) { side::no() } else { side::yes() };

    let win_key = BoardKey { vault_id, side: winning };
    let lose_key = BoardKey { vault_id, side: losing };
    let win_pool = board_pool(registry, win_key);
    let lose_pool = board_pool(registry, lose_key);
    let win_shares = board_side_shares(registry, win_key);

    let (pot_amt, skim_amt) = if (win_shares == 0 && option::is_some(&registry.treasury_id)) {
        (0, win_pool + lose_pool)
    } else {
        let skim = if (option::is_some(&registry.treasury_id) && lose_pool > 0) {
            (lose_pool * skim_bps) / BPS_DENOM
        } else {
            0
        };
        (win_pool + lose_pool - skim, skim)
    };

    table::add(&mut registry.pot, vault_id, pot_amt);
    table::add(&mut registry.skim_owed, vault_id, skim_amt);
}

fun board_pool<T>(registry: &VaultRegistry<T>, key: BoardKey): u256 {
    if (!table::contains(&registry.boards, key)) {
        0
    } else {
        table::borrow(&registry.boards, key).pool
    }
}

fun board_side_shares<T>(registry: &VaultRegistry<T>, key: BoardKey): u256 {
    if (!table::contains(&registry.boards, key)) {
        0
    } else {
        table::borrow(&registry.boards, key).side_shares
    }
}

fun add_overage_owed<T>(registry: &mut VaultRegistry<T>, key: PositionKey, amount: u256) {
    if (!table::contains(&registry.overage_owed, key)) {
        table::add(&mut registry.overage_owed, key, amount);
    } else {
        let owed = table::borrow_mut(&mut registry.overage_owed, key);
        *owed = *owed + amount;
    };
}

fun pay_winnings<T>(
    registry: &mut VaultRegistry<T>,
    account: u256,
    vault_id: vector<u8>,
    side: u8,
    winning: u8,
    payee: address,
    ctx: &mut TxContext,
): u128 {
    if (side != winning) {
        return 0
    };
    let key = PositionKey { vault_id, side, account };
    if (table::contains(&registry.claimed, key) && *table::borrow(&registry.claimed, key)) {
        return 0
    };

    settle_internal(registry, vault_id, side, account);

    let shares = if (table::contains(&registry.positions, key)) {
        table::borrow(&registry.positions, key).shares_accrued
    } else {
        0
    };
    if (shares == 0) {
        return 0
    };

    let board_key = BoardKey { vault_id, side };
    let side_total = board_side_shares(registry, board_key);
    if (side_total == 0) {
        return 0
    };

    let pot_amt = *table::borrow(&registry.pot, vault_id);
    let payout = full_mul_div(pot_amt, shares, side_total);
    if (payout == 0) {
        return 0
    };

    if (!table::contains(&registry.claimed, key)) {
        table::add(&mut registry.claimed, key, true);
    } else {
        *table::borrow_mut(&mut registry.claimed, key) = true;
    };

    transfer_usdc(registry, payee, payout, ctx);
    event::emit(Claimed {
        vault_id,
        side,
        account,
        shares,
        payout,
    });
    payout as u128
}

fun pay_overage<T>(
    registry: &mut VaultRegistry<T>,
    account: u256,
    vault_id: vector<u8>,
    side: u8,
    payee: address,
    resolved_at: u64,
    clock: &Clock,
    ctx: &mut TxContext,
): u128 {
    let key = PositionKey { vault_id, side, account };
    if (!table::contains(&registry.positions, key)) {
        return 0
    };
    let now_ts = timestamp_secs(clock);
    let p = table::borrow(&registry.positions, key);
    let entitlement = if (p.rate > 0) {
        let end = if (p.max_end < now_ts) { p.max_end } else { now_ts };
        if (end > resolved_at) {
            p.rate * ((end - resolved_at) as u256)
        } else {
            0
        }
    } else if (table::contains(&registry.overage_owed, key)) {
        *table::borrow(&registry.overage_owed, key)
    } else {
        0
    };

    let already = if (table::contains(&registry.overage_paid, key)) {
        *table::borrow(&registry.overage_paid, key)
    } else {
        0
    };
    if (entitlement <= already) {
        return 0
    };
    let amt = entitlement - already;

    if (!table::contains(&registry.overage_paid, key)) {
        table::add(&mut registry.overage_paid, key, entitlement);
    } else {
        *table::borrow_mut(&mut registry.overage_paid, key) = entitlement;
    };
    if (p.rate == 0) {
        if (table::contains(&registry.overage_owed, key)) {
            *table::borrow_mut(&mut registry.overage_owed, key) = 0;
        };
    };

    transfer_usdc(registry, payee, amt, ctx);
    event::emit(OverageReclaimed { vault_id, side, account, amount: amt });
    amt as u128
}

fun transfer_usdc<T>(
    registry: &mut VaultRegistry<T>,
    payee: address,
    amount: u256,
    ctx: &mut TxContext,
) {
    assert!(amount > 0, E_INSUFFICIENT_USDC);
    assert!((balance::value(&registry.usdc) as u256) >= amount, E_INSUFFICIENT_USDC);
    let payment = coin::from_balance(balance::split(&mut registry.usdc, (amount as u64)), ctx);
    transfer::public_transfer(payment, payee);
}

fun harvest_receiver<T>(
    registry: &mut VaultRegistry<T>,
    drips_registry: &mut DripsRegistry<T>,
    streams_registry: &mut StreamsRegistry<T>,
    receiver: u256,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    if (receiver == 0) {
        return
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
        balance::join(&mut registry.usdc, coin::into_balance(payment));
    };
}

fun full_mul_div(x: u256, y: u256, d: u256): u256 {
    assert!(d > 0, E_DIV_ZERO);
    (x * y) / d
}
