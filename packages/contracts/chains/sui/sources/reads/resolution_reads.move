// SPDX-License-Identifier: MIT

module livestreak::resolution_reads;

use livestreak::market_registry::{Self, MarketRegistry};
use livestreak::steward_registry::{Self, StewardRegistry};
use livestreak::vault::{Self, VaultRegistry};

public struct VaultResolutionView has copy, drop {
    vault_exists: bool,
    status: u8,
    outcome: u8,
    resolved_at: u64,
    pot: u256,
    stream_status: u8,
    stream_ended_at: u64,
    hot_active: bool,
    dispute_active: bool,
}

public fun view_vault<T>(
    market_registry: &MarketRegistry,
    steward_registry: &StewardRegistry,
    vault_registry: &VaultRegistry<T>,
    market_id: &vector<u8>,
    vault_id: &vector<u8>,
): VaultResolutionView {
    let vault_exists = vault::vault_exists(vault_registry, vault_id);
    let (status, outcome, resolved_at) = if (vault_exists) {
        let data = vault::get_vault(vault_registry, vault_id);
        (vault::vault_status(&data), vault::vault_outcome(&data), vault::vault_resolved_at(&data))
    } else {
        (0, 0, 0)
    };
    let pot = if (vault_exists) {
        vault::pot(vault_registry, vault_id)
    } else {
        0
    };
    let stream = market_registry::stream_state(market_registry, market_id);
    let hot_opt = steward_registry::hot_state(steward_registry, vault_id);
    let hot_active = if (option::is_some(&hot_opt)) {
        steward_registry::hot_active(option::borrow(&hot_opt))
    } else {
        false
    };
    let dispute_opt = steward_registry::dispute_state(steward_registry, vault_id);
    let dispute_active = if (option::is_some(&dispute_opt)) {
        steward_registry::dispute_active(option::borrow(&dispute_opt))
    } else {
        false
    };
    VaultResolutionView {
        vault_exists,
        status,
        outcome,
        resolved_at,
        pot,
        stream_status: market_registry::stream_status(&stream),
        stream_ended_at: market_registry::stream_ended_at(&stream),
        hot_active,
        dispute_active,
    }
}
