// SPDX-License-Identifier: MIT

#[test_only]
module livestreak::conservation_invariant_tests;

use livestreak::drips::{Self, DripsRegistry};
use livestreak::protocol_wire::{Self as wire};
use livestreak::side;
use livestreak::treasury::{Self, TreasuryRegistry};
use livestreak::test_usdc::TEST_USDC;
use livestreak::vault::{Self, VaultRegistry};
use sui::clock::{Self, Clock};
use sui::test_scenario::{Self as ts, Scenario};

const DUST_TOLERANCE: u256 = 2;

fun setup_conservation_fixture(
    scenario: &mut ts::Scenario,
    clock: &Clock,
): (vector<u8>, u256, u256) {
    wire::setup_stack(scenario, wire::admin());
    wire::setup_steward(scenario, wire::admin(), wire::steward());
    let market_id = wire::register_market(scenario, wire::admin(), b"m", b"s", clock);
    let vault_id = wire::create_vault(
        scenario,
        wire::seed_creator(),
        market_id,
        b"Q?",
        side::yes(),
        wire::rate(),
        wire::creator_seed_deposit(),
        clock,
    );
    let alice_token = wire::mint_nft(scenario, wire::alice(), market_id);
    let bob_token = wire::mint_nft(scenario, wire::bob(), market_id);
    (vault_id, alice_token, bob_token)
}

fun fund_if_needed(
    scenario: &mut Scenario,
    who: address,
    vault_id: vector<u8>,
    fund_side: u8,
    deposit: u256,
    clock: &Clock,
    total_deposits: &mut u256,
) {
    let nft = wire::take_nft(scenario, who);
    wire::fund(
        scenario,
        who,
        &nft,
        vault_id,
        fund_side,
        wire::rate(),
        (deposit as u64),
        clock,
    );
    wire::return_nft(scenario, who, nft);
    *total_deposits = *total_deposits + deposit;
}

fun run_conservation_seed(
    scenario: &mut Scenario,
    clock: &mut Clock,
    seed: u64,
) {
    let (vault_id, alice_token, bob_token) = setup_conservation_fixture(scenario, clock);
    let mut total_deposits = (wire::creator_seed_deposit() as u256);
    let mut total_stop_all_refunds = 0u256;
    let mut total_withdraws = 0u256;
    let mut alice_funded = false;
    let mut bob_funded = false;
    let mut now_secs = wire::start_secs();

    let steps = 3 + (seed % 5);
    let mut i = 0u64;
    while (i < steps) {
        let op = wire::hash_mix(seed, i, b"") % 4;
        let deposit = wire::rate() * (2 + ((wire::hash_mix(seed, i, b"d") % 18) as u256));

        if (op == 0 && !alice_funded) {
            total_deposits = total_deposits + deposit;
            let alice_nft = wire::take_nft(scenario, wire::alice());
            wire::fund(
                scenario,
                wire::alice(),
                &alice_nft,
                vault_id,
                side::yes(),
                wire::rate(),
                (deposit as u64),
                clock,
            );
            wire::return_nft(scenario, wire::alice(), alice_nft);
            alice_funded = true;
        } else if (op == 1 && !bob_funded) {
            total_deposits = total_deposits + deposit;
            let bob_nft = wire::take_nft(scenario, wire::bob());
            wire::fund(
                scenario,
                wire::bob(),
                &bob_nft,
                vault_id,
                side::no(),
                wire::rate(),
                (deposit as u64),
                clock,
            );
            wire::return_nft(scenario, wire::bob(), bob_nft);
            bob_funded = true;
        } else if (op == 2) {
            now_secs = now_secs + 1 + (seed % 7);
            wire::warp(clock, now_secs);
        } else {
            wire::advance_both(scenario, wire::admin(), vault_id, clock);
        };
        i = i + 1;
    };

    if (!alice_funded || !bob_funded) {
        let fallback = 10 * wire::rate();
        if (!alice_funded) {
            fund_if_needed(
                scenario,
                wire::alice(),
                vault_id,
                side::yes(),
                fallback,
                clock,
                &mut total_deposits,
            );
        };
        if (!bob_funded) {
            fund_if_needed(
                scenario,
                wire::bob(),
                vault_id,
                side::no(),
                fallback,
                clock,
                &mut total_deposits,
            );
        };
    };

    now_secs = now_secs + wire::cycle_secs();
    wire::warp(clock, now_secs);
    wire::resolve_vault(scenario, wire::steward(), vault_id, true, clock);
    wire::collect_vault(scenario, vault_id, clock);
    now_secs = now_secs + wire::cycle_secs() * 3;
    wire::warp(clock, now_secs);
    wire::collect_vault(scenario, vault_id, clock);

    total_stop_all_refunds =
        total_stop_all_refunds + (wire::stop_all_if_lanes(scenario, wire::alice(), alice_token, clock) as u256);
    total_stop_all_refunds =
        total_stop_all_refunds + (wire::stop_all_if_lanes(scenario, wire::bob(), bob_token, clock) as u256);

    total_withdraws = total_withdraws + (wire::withdraw_market(scenario, wire::alice(), vault_id, clock) as u256);
    total_withdraws = total_withdraws + (wire::withdraw_market(scenario, wire::bob(), vault_id, clock) as u256);

    wire::collect_vault(scenario, vault_id, clock);
    total_withdraws = total_withdraws + (wire::withdraw_market(scenario, wire::alice(), vault_id, clock) as u256);
    total_withdraws = total_withdraws + (wire::withdraw_market(scenario, wire::bob(), vault_id, clock) as u256);

    total_withdraws = total_withdraws + (wire::withdraw_seed(scenario, wire::seed_creator(), vault_id, clock) as u256);

    wire::harvest_both_sides(scenario, vault_id, clock);
    wire::collect_vault(scenario, vault_id, clock);

    total_withdraws = total_withdraws + (wire::withdraw_seed(scenario, wire::seed_creator(), vault_id, clock) as u256);

    ts::next_tx(scenario, wire::admin());
    {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(scenario);
        let drips = ts::take_shared<DripsRegistry<TEST_USDC>>(scenario);
        let treasury = ts::take_shared<TreasuryRegistry<TEST_USDC>>(scenario);
        let dust = (vault::usdc_balance(&vault_registry) as u256) + (drips::held_balance(&drips) as u256);
        let skimmed = treasury::total_skimmed(&treasury);
        let rhs = skimmed + total_stop_all_refunds + total_withdraws + dust;
        assert!(dust <= DUST_TOLERANCE, 0);
        assert!(total_deposits == rhs, 1);
        ts::return_shared(vault_registry);
        ts::return_shared(drips);
        ts::return_shared(treasury);
    };
}

#[test]
fun test_conservation_seed_1() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    run_conservation_seed(&mut scenario, &mut clock, 1);
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_conservation_seed_42() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    run_conservation_seed(&mut scenario, &mut clock, 42);
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_conservation_seed_1337() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    run_conservation_seed(&mut scenario, &mut clock, 1337);
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_conservation_seed_99999() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    run_conservation_seed(&mut scenario, &mut clock, 99999);
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}
