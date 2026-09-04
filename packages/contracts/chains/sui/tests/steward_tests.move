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
