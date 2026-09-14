// SPDX-License-Identifier: MIT

module livestreak::steward_registry;

use livestreak::side;
use livestreak::vault::{Self, VaultRegistry};
use sui::clock::Clock;
use sui::event;
use sui::table::{Self, Table};

const E_ZERO_STEWARD: u64 = 1;
const E_UNREGISTERED: u64 = 2;
const E_NO_STEWARD: u64 = 3;
const E_NOT_STEWARD: u64 = 4;
const E_INVALID_OUTCOME: u64 = 5;

const SEVERITY_WARM: u8 = 0;
const SEVERITY_HOT: u8 = 1;
const SEVERITY_CRITICAL: u8 = 2;

const OUTCOME_YES: u8 = 1;
const OUTCOME_NO: u8 = 2;

public struct StewardRegistry has key {
    id: UID,
    owner: address,
    stewards: Table<address, bool>,
    market_steward: Table<vector<u8>, address>,
    vault_hot_state: Table<vector<u8>, HotState>,
    dispute_state: Table<vector<u8>, DisputeState>,
    default_steward: Option<address>,
}

public struct HotState has copy, drop, store {
    active: bool,
    until: u64,
    severity: u8,
    reason_hash: vector<u8>,
}

public struct DisputeState has copy, drop, store {
    active: bool,
    challenge_until: u64,
    proof_ref: vector<u8>,
}

public struct StewardRegistered has copy, drop { steward: address }
public struct DefaultStewardSet has copy, drop { steward: address }
public struct MarketStewardSet has copy, drop { market_id: vector<u8>, steward: address }
public struct VaultResolved has copy, drop {
    vault_id: vector<u8>,
    outcome: u8,
    steward: address,
}

// EVM-parity events (mirror StewardRegistry.sol HotTriggered/HotEnded/DisputeOpened/DisputeClosed).
// Sui previously emitted none of these; off-chain steward indexers need a Sui analog of each EVM event.
public struct HotTriggered has copy, drop {
    vault_id: vector<u8>,
    severity: u8,
    until: u64,
    reason_hash: vector<u8>,
}
public struct HotEnded has copy, drop { vault_id: vector<u8> }
public struct DisputeOpened has copy, drop {
    vault_id: vector<u8>,
    challenge_until: u64,
    proof_ref: vector<u8>,
}
public struct DisputeClosed has copy, drop { vault_id: vector<u8> }

public fun create(owner: address, ctx: &mut TxContext) {
    let registry = StewardRegistry {
        id: object::new(ctx),
        owner,
        stewards: table::new(ctx),
        market_steward: table::new(ctx),
        vault_hot_state: table::new(ctx),
        dispute_state: table::new(ctx),
        default_steward: option::none(),
    };
    transfer::share_object(registry);
}

public fun register_steward(registry: &mut StewardRegistry, steward: address, ctx: &TxContext) {
    assert_owner(registry, ctx);
    assert!(steward != @0x0, E_ZERO_STEWARD);
    table::add(&mut registry.stewards, steward, true);
    event::emit(StewardRegistered { steward });
}

public fun set_default_steward(registry: &mut StewardRegistry, steward: address, ctx: &TxContext) {
    assert_owner(registry, ctx);
    assert!(steward != @0x0, E_ZERO_STEWARD);
    assert!(table::contains(&registry.stewards, steward), E_UNREGISTERED);
    registry.default_steward = option::some(steward);
    event::emit(DefaultStewardSet { steward });
}

public fun set_market_steward(
    registry: &mut StewardRegistry,
    market_id: vector<u8>,
    steward: address,
    ctx: &TxContext,
) {
    assert_owner(registry, ctx);
    assert!(steward != @0x0, E_ZERO_STEWARD);
    assert!(table::contains(&registry.stewards, steward), E_UNREGISTERED);
    if (table::contains(&registry.market_steward, market_id)) {
        *table::borrow_mut(&mut registry.market_steward, market_id) = steward;
    } else {
        table::add(&mut registry.market_steward, market_id, steward);
    };
    event::emit(MarketStewardSet { market_id, steward });
}

public fun hot_state(registry: &StewardRegistry, vault_id: &vector<u8>): Option<HotState> {
    if (table::contains(&registry.vault_hot_state, *vault_id)) {
        option::some(*table::borrow(&registry.vault_hot_state, *vault_id))
    } else {
        option::none()
    }
}

public fun dispute_state(registry: &StewardRegistry, vault_id: &vector<u8>): Option<DisputeState> {
    if (table::contains(&registry.dispute_state, *vault_id)) {
        option::some(*table::borrow(&registry.dispute_state, *vault_id))
    } else {
        option::none()
    }
}

public fun hot_active(state: &HotState): bool {
    state.active
}

public fun hot_until(state: &HotState): u64 {
    state.until
}

public fun hot_severity(state: &HotState): u8 {
    state.severity
}

public fun hot_reason_hash(state: &HotState): vector<u8> {
    state.reason_hash
}

public fun dispute_active(state: &DisputeState): bool {
    state.active
}

public fun dispute_challenge_until(state: &DisputeState): u64 {
    state.challenge_until
}

public fun effective_steward(registry: &StewardRegistry, market_id: &vector<u8>): address {
    if (table::contains(&registry.market_steward, *market_id)) {
        *table::borrow(&registry.market_steward, *market_id)
    } else if (option::is_some(&registry.default_steward)) {
        *option::borrow(&registry.default_steward)
    } else {
        @0x0
    }
}

public fun resolve_vault<T>(
    registry: &StewardRegistry,
    vault_registry: &mut VaultRegistry<T>,
    vault_id: vector<u8>,
    outcome: u8,
    clock: &Clock,
    ctx: &TxContext,
) {
    assert!(outcome == OUTCOME_YES || outcome == OUTCOME_NO, E_INVALID_OUTCOME);
    let market_id = vault::market_id(vault_registry, &vault_id);
    require_market_steward(registry, &market_id, ctx);
    let side = if (outcome == OUTCOME_YES) { side::yes() } else { side::no() };
    vault::resolve(vault_registry, vault_id, side, clock, ctx);
    event::emit(VaultResolved { vault_id, outcome, steward: ctx.sender() });
}

public fun trigger_hot<T>(
    registry: &mut StewardRegistry,
    vault_registry: &VaultRegistry<T>,
    vault_id: vector<u8>,
    severity: u8,
    until: u64,
    reason_hash: vector<u8>,
    ctx: &TxContext,
) {
    let market_id = vault::market_id(vault_registry, &vault_id);
    require_market_steward(registry, &market_id, ctx);
    // UPSERT (EVM `vaultHotState[vaultId] = ...` overwrite semantics). Mirror set_market_steward,
    // NOT table::add — re-escalation (Hot -> Critical, or extending `until`) must overwrite, not abort.
    // HotState has `drop`, so replacing the old value via borrow_mut is safe (no resource leak).
    let new_state = HotState { active: true, until, severity, reason_hash };
    if (table::contains(&registry.vault_hot_state, vault_id)) {
        *table::borrow_mut(&mut registry.vault_hot_state, vault_id) = new_state;
    } else {
        table::add(&mut registry.vault_hot_state, vault_id, new_state);
    };
    event::emit(HotTriggered { vault_id, severity, until, reason_hash });
}

public fun end_hot<T>(
    registry: &mut StewardRegistry,
    vault_registry: &VaultRegistry<T>,
    vault_id: vector<u8>,
    ctx: &TxContext,
) {
    let market_id = vault::market_id(vault_registry, &vault_id);
    require_market_steward(registry, &market_id, ctx);
    if (table::contains(&registry.vault_hot_state, vault_id)) {
        table::remove(&mut registry.vault_hot_state, vault_id);
    };
    // Emit unconditionally to match EVM (delete-then-emit; EVM emits even when nothing was set).
    event::emit(HotEnded { vault_id });
}

public fun open_dispute<T>(
    registry: &mut StewardRegistry,
    vault_registry: &VaultRegistry<T>,
    vault_id: vector<u8>,
    challenge_until: u64,
    proof_ref: vector<u8>,
    ctx: &TxContext,
) {
    let market_id = vault::market_id(vault_registry, &vault_id);
    require_market_steward(registry, &market_id, ctx);
    // UPSERT (EVM `disputeState[vaultId] = ...` overwrite semantics) — mirror set_market_steward,
    // not table::add, so re-opening a dispute overwrites instead of aborting. DisputeState has `drop`.
    let new_state = DisputeState { active: true, challenge_until, proof_ref };
    if (table::contains(&registry.dispute_state, vault_id)) {
        *table::borrow_mut(&mut registry.dispute_state, vault_id) = new_state;
    } else {
        table::add(&mut registry.dispute_state, vault_id, new_state);
    };
    event::emit(DisputeOpened { vault_id, challenge_until, proof_ref });
}

public fun close_dispute<T>(
    registry: &mut StewardRegistry,
    vault_registry: &VaultRegistry<T>,
    vault_id: vector<u8>,
    ctx: &TxContext,
) {
    let market_id = vault::market_id(vault_registry, &vault_id);
    require_market_steward(registry, &market_id, ctx);
    if (table::contains(&registry.dispute_state, vault_id)) {
        table::remove(&mut registry.dispute_state, vault_id);
    };
    // Emit unconditionally to match EVM (delete-then-emit).
    event::emit(DisputeClosed { vault_id });
}

// --- helpers ---

fun assert_owner(registry: &StewardRegistry, ctx: &TxContext) {
    assert!(ctx.sender() == registry.owner, E_NOT_STEWARD);
}

fun require_market_steward(registry: &StewardRegistry, market_id: &vector<u8>, ctx: &TxContext) {
    let effective = effective_steward(registry, market_id);
    assert!(effective != @0x0, E_NO_STEWARD);
    assert!(ctx.sender() == effective, E_NOT_STEWARD);
}
