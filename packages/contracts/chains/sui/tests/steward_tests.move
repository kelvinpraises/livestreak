// SPDX-License-Identifier: MIT

#[test_only]
module livestreak::steward_tests;

use livestreak::market_registry::MarketRegistry;
use livestreak::protocol_wire::{Self as wire};
use livestreak::side;
use livestreak::steward_registry::{Self, StewardRegistry};
use livestreak::test_usdc::TEST_USDC;
use livestreak::vault::{Self, VaultRegistry};
use sui::clock::{Self, Clock};
use sui::test_scenario::{Self as ts};

fun setup_steward_fixture(
    scenario: &mut ts::Scenario,
    clock: &Clock,
): (vector<u8>, vector<u8>) {
    wire::setup_stack(scenario, wire::admin());
    let market_m = wire::register_market(scenario, wire::admin(), b"M", b"m", clock);
    wire::setup_stewards(scenario, wire::admin(), wire::steward_a(), wire::steward_b(), market_m);
    let vault_m = wire::bond_vault(scenario, market_m, b"Q?", side::yes(), clock);
    (market_m, vault_m)
}

#[test]
fun test_assigned_steward_resolves() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, vault_m) = setup_steward_fixture(&mut scenario, &clock);

    ts::next_tx(&mut scenario, wire::steward_a());
    {
        let steward_reg = ts::take_shared<StewardRegistry>(&scenario);
        let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        steward_registry::resolve_vault(&steward_reg, &mut vault_registry, vault_m, 1, &clock, ctx);
        ts::return_shared(steward_reg);
        ts::return_shared(vault_registry);
    };

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let data = vault::get_vault(&vault_registry, &vault_m);
        assert!(vault::vault_status(&data) == vault::status_resolved(), 0);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 4)]
fun test_other_registered_steward_cannot_resolve() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, vault_m) = setup_steward_fixture(&mut scenario, &clock);

    ts::next_tx(&mut scenario, wire::steward_b());
    {
        let steward_reg = ts::take_shared<StewardRegistry>(&scenario);
        let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        steward_registry::resolve_vault(&steward_reg, &mut vault_registry, vault_m, 1, &clock, ctx);
        ts::return_shared(steward_reg);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_default_steward_resolves_unassigned_market() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    setup_steward_fixture(&mut scenario, &clock);
    let market_u = wire::register_market(&mut scenario, wire::admin(), b"U", b"u", &clock);
    let vault_u = wire::bond_vault(&mut scenario, market_u, b"Q2?", side::no(), &clock);

    ts::next_tx(&mut scenario, wire::steward_a());
    {
        let steward_reg = ts::take_shared<StewardRegistry>(&scenario);
        let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        steward_registry::resolve_vault(&steward_reg, &mut vault_registry, vault_u, 2, &clock, ctx);
        ts::return_shared(steward_reg);
        ts::return_shared(vault_registry);
    };

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let data = vault::get_vault(&vault_registry, &vault_u);
        assert!(vault::vault_status(&data) == vault::status_resolved(), 0);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 4)]
fun test_owner_reassigns_market_steward_blocks_old() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (market_m, vault_m) = setup_steward_fixture(&mut scenario, &clock);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let mut steward_reg = ts::take_shared<StewardRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        steward_registry::set_market_steward(&mut steward_reg, market_m, wire::steward_b(), ctx);
        ts::return_shared(steward_reg);
    };

    ts::next_tx(&mut scenario, wire::steward_a());
    {
        let steward_reg = ts::take_shared<StewardRegistry>(&scenario);
        let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        steward_registry::resolve_vault(&steward_reg, &mut vault_registry, vault_m, 1, &clock, ctx);
        ts::return_shared(steward_reg);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_owner_reassigns_market_steward_b_can_resolve() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (market_m, vault_m) = setup_steward_fixture(&mut scenario, &clock);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let mut steward_reg = ts::take_shared<StewardRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        steward_registry::set_market_steward(&mut steward_reg, market_m, wire::steward_b(), ctx);
        ts::return_shared(steward_reg);
    };

    ts::next_tx(&mut scenario, wire::steward_b());
    {
        let steward_reg = ts::take_shared<StewardRegistry>(&scenario);
        let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        steward_registry::resolve_vault(&steward_reg, &mut vault_registry, vault_m, 1, &clock, ctx);
        ts::return_shared(steward_reg);
        ts::return_shared(vault_registry);
    };

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let data = vault::get_vault(&vault_registry, &vault_m);
        assert!(vault::vault_status(&data) == vault::status_resolved(), 0);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_hot_gated_to_market_steward() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, vault_m) = setup_steward_fixture(&mut scenario, &clock);

    ts::next_tx(&mut scenario, wire::steward_a());
    {
        let mut steward_reg = ts::take_shared<StewardRegistry>(&scenario);
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        steward_registry::trigger_hot(
            &mut steward_reg,
            &vault_registry,
            vault_m,
            1,
            100 + 3600,
            b"reason",
            ctx,
        );
        ts::return_shared(steward_reg);
        ts::return_shared(vault_registry);
    };

    ts::next_tx(&mut scenario, wire::admin());
    {
        let steward_reg = ts::take_shared<StewardRegistry>(&scenario);
        let hot = steward_registry::hot_state(&steward_reg, &vault_m);
        assert!(option::is_some(&hot), 0);
        let state = option::borrow(&hot);
        assert!(steward_registry::hot_active(state), 1);
        ts::return_shared(steward_reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 4)]
fun test_hot_gated_rejects_wrong_steward() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, vault_m) = setup_steward_fixture(&mut scenario, &clock);

    ts::next_tx(&mut scenario, wire::steward_b());
    {
        let mut steward_reg = ts::take_shared<StewardRegistry>(&scenario);
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        steward_registry::trigger_hot(
            &mut steward_reg,
            &vault_registry,
            vault_m,
            1,
            100 + 3600,
            b"reason",
            ctx,
        );
        ts::return_shared(steward_reg);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 2)]
fun test_set_market_steward_requires_registration() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (market_m, _) = setup_steward_fixture(&mut scenario, &clock);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let mut steward_reg = ts::take_shared<StewardRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        steward_registry::set_market_steward(&mut steward_reg, market_m, wire::stranger(), ctx);
        ts::return_shared(steward_reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

// ─── Gap 3: steward_registry::hot_reason_hash ────────────────────────────────

/// hot_reason_hash accessor returns exactly the bytes supplied to trigger_hot.
#[test]
fun test_hot_reason_hash_accessor() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, vault_m) = setup_steward_fixture(&mut scenario, &clock);
    let expected_hash = b"0xdeadbeef";

    ts::next_tx(&mut scenario, wire::steward_a());
    {
        let mut steward_reg = ts::take_shared<StewardRegistry>(&scenario);
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        steward_registry::trigger_hot(
            &mut steward_reg,
            &vault_registry,
            vault_m,
            1,
            wire::start_secs() + 3600,
            expected_hash,
            ctx,
        );
        ts::return_shared(steward_reg);
        ts::return_shared(vault_registry);
    };

    ts::next_tx(&mut scenario, wire::admin());
    {
        let steward_reg = ts::take_shared<StewardRegistry>(&scenario);
        let hot_opt = steward_registry::hot_state(&steward_reg, &vault_m);
        assert!(option::is_some(&hot_opt), 0);
        let state = option::borrow(&hot_opt);
        assert!(steward_registry::hot_reason_hash(state) == expected_hash, 1);
        ts::return_shared(steward_reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}


// ─── CON.S1: re-escalation must UPSERT (EVM overwrite), not abort (table::add) ───────────────

/// trigger_hot on a vault that is already Hot overwrites severity/until instead of aborting.
#[test]
fun test_retrigger_hot_overwrites() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, vault_m) = setup_steward_fixture(&mut scenario, &clock);

    // First escalation: Hot (severity 1) until T1.
    ts::next_tx(&mut scenario, wire::steward_a());
    {
        let mut steward_reg = ts::take_shared<StewardRegistry>(&scenario);
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        steward_registry::trigger_hot(&mut steward_reg, &vault_registry, vault_m, 1, 1000, b"first", ctx);
        ts::return_shared(steward_reg);
        ts::return_shared(vault_registry);
    };

    // Second escalation on the SAME vault: Critical (severity 2) until T2 — must NOT abort.
    ts::next_tx(&mut scenario, wire::steward_a());
    {
        let mut steward_reg = ts::take_shared<StewardRegistry>(&scenario);
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        steward_registry::trigger_hot(&mut steward_reg, &vault_registry, vault_m, 2, 2000, b"second", ctx);
        ts::return_shared(steward_reg);
        ts::return_shared(vault_registry);
    };

    ts::next_tx(&mut scenario, wire::admin());
    {
        let steward_reg = ts::take_shared<StewardRegistry>(&scenario);
        let hot = steward_registry::hot_state(&steward_reg, &vault_m);
        assert!(option::is_some(&hot), 0);
        let state = option::borrow(&hot);
        assert!(steward_registry::hot_severity(state) == 2, 1);
        assert!(steward_registry::hot_until(state) == 2000, 2);
        assert!(steward_registry::hot_reason_hash(state) == b"second", 3);
        ts::return_shared(steward_reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

/// open_dispute twice on the same vault overwrites instead of aborting.
#[test]
fun test_reopen_dispute_overwrites() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, vault_m) = setup_steward_fixture(&mut scenario, &clock);

    ts::next_tx(&mut scenario, wire::steward_a());
    {
        let mut steward_reg = ts::take_shared<StewardRegistry>(&scenario);
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        steward_registry::open_dispute(&mut steward_reg, &vault_registry, vault_m, 1000, b"p1", ctx);
        ts::return_shared(steward_reg);
        ts::return_shared(vault_registry);
    };

    ts::next_tx(&mut scenario, wire::steward_a());
    {
        let mut steward_reg = ts::take_shared<StewardRegistry>(&scenario);
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        steward_registry::open_dispute(&mut steward_reg, &vault_registry, vault_m, 5000, b"p2", ctx);
        ts::return_shared(steward_reg);
        ts::return_shared(vault_registry);
    };

    ts::next_tx(&mut scenario, wire::admin());
    {
        let steward_reg = ts::take_shared<StewardRegistry>(&scenario);
        let disp = steward_registry::dispute_state(&steward_reg, &vault_m);
        assert!(option::is_some(&disp), 0);
        let state = option::borrow(&disp);
        assert!(steward_registry::dispute_active(state), 1);
        assert!(steward_registry::dispute_challenge_until(state) == 5000, 2);
        ts::return_shared(steward_reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}
