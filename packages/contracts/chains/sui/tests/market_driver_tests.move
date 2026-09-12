// SPDX-License-Identifier: MIT

#[test_only]
module livestreak::market_driver_tests;

use livestreak::drips::{Self, DripsRegistry};
use livestreak::market_driver::{Self, MarketDriverRegistry, MarketPositionNFT};
use livestreak::protocol_wire::{Self as wire};
use livestreak::side;
use livestreak::streams::{Self, StreamsRegistry};
use livestreak::test_usdc::TEST_USDC;
use livestreak::vault::{Self, VaultRegistry};
use sui::clock::{Self, Clock};
use sui::test_scenario::{Self as ts};

const USDC_DUST: u64 = 2;

fun deposit_units(n: u64): u64 {
    n * (wire::rate() as u64)
}

fun fund_holder(
    scenario: &mut ts::Scenario,
    who: address,
    vault_id: vector<u8>,
    fund_side: u8,
    rate: u256,
    deposit: u64,
    clock: &Clock,
) {
    let nft = wire::take_nft(scenario, who);
    wire::fund(scenario, who, &nft, vault_id, fund_side, rate, deposit, clock);
    wire::return_nft(scenario, who, nft);
}

fun setup_fixture(
    scenario: &mut ts::Scenario,
    clock: &Clock,
): (vector<u8>, vector<u8>, u256, u256) {
    wire::setup_market_driver_fixture(scenario, clock)
}

#[test]
fun test_fund_opens_stream_and_syncs_board() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, alice_token, _) = setup_fixture(&mut scenario, &clock);
    fund_holder(
        &mut scenario,
        wire::alice(),
        v1,
        side::yes(),
        wire::rate(),
        deposit_units(50),
        &clock,
    );

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let (rate, _, _, max_end, _, _, _) =
            vault::get_position(&vault_registry, &v1, side::yes(), alice_token);
        assert!(rate == wire::rate(), 0);
        assert!(max_end == 150, 1);
        let (_, side_rate, _, _) = vault::get_board(&vault_registry, &v1, side::yes());
        assert!(side_rate == wire::rate(), 2);
        ts::return_shared(vault_registry);
    };

    ts::next_tx(&mut scenario, wire::admin());
    {
        let streams = ts::take_shared<StreamsRegistry<TEST_USDC>>(&scenario);
        let (_, _, _, _, max_end) = streams::streams_state(&streams, alice_token);
        assert!(max_end == 150, 3);
        ts::return_shared(streams);
    };

    ts::next_tx(&mut scenario, wire::admin());
    {
        let market_driver = ts::take_shared<MarketDriverRegistry>(&scenario);
        assert!(market_driver::lane_count(&market_driver, alice_token) == 1, 4);
        ts::return_shared(market_driver);
    };

    ts::next_tx(&mut scenario, wire::admin());
    {
        let drips = ts::take_shared<DripsRegistry<TEST_USDC>>(&scenario);
        let held = drips::held_balance(&drips);
        let expected = deposit_units(50) as u128;
        assert!(held >= expected - (USDC_DUST as u128) && held <= expected + (USDC_DUST as u128), 5);
        ts::return_shared(drips);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_stop_keeps_unspent_in_shared_balance() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, alice_token, _) = setup_fixture(&mut scenario, &clock);
    fund_holder(
        &mut scenario,
        wire::alice(),
        v1,
        side::yes(),
        wire::rate(),
        deposit_units(50),
        &clock,
    );
    wire::warp(&mut clock, wire::start_secs() + 20);
    wire::stop_lane(&mut scenario, wire::alice(), v1, side::yes(), &clock);
    assert!(wire::usdc_balance_of(&mut scenario, wire::alice()) == 0, 0);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let (rate, _, _, _, _, _, _) =
            vault::get_position(&vault_registry, &v1, side::yes(), alice_token);
        assert!(rate == 0, 1);
        ts::return_shared(vault_registry);
    };

    ts::next_tx(&mut scenario, wire::admin());
    {
        let market_driver = ts::take_shared<MarketDriverRegistry>(&scenario);
        assert!(market_driver::lane_count(&market_driver, alice_token) == 0, 2);
        ts::return_shared(market_driver);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_stop_all_refunds_unspent() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, alice_token, _) = setup_fixture(&mut scenario, &clock);
    fund_holder(
        &mut scenario,
        wire::alice(),
        v1,
        side::yes(),
        wire::rate(),
        deposit_units(50),
        &clock,
    );
    wire::warp(&mut clock, wire::start_secs() + 20);
    let refunded = wire::stop_all_refund(&mut scenario, wire::alice(), &clock);
    assert!(refunded == (30 * wire::rate()) as u128, 0);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let market_driver = ts::take_shared<MarketDriverRegistry>(&scenario);
        assert!(market_driver::lane_count(&market_driver, alice_token) == 0, 1);
        ts::return_shared(market_driver);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_set_lanes_hedge_flips_side_keeping_shares() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, alice_token, _) = setup_fixture(&mut scenario, &clock);
    fund_holder(
        &mut scenario,
        wire::alice(),
        v1,
        side::yes(),
        wire::rate(),
        deposit_units(50),
        &clock,
    );
    wire::warp(&mut clock, wire::start_secs() + 20);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let shares = vault::pending_shares(&vault_registry, &v1, side::yes(), alice_token, &clock);
        assert!(shares > 0, 0);
        ts::return_shared(vault_registry);
    };

    wire::set_lanes(
        &mut scenario,
        wire::alice(),
        vector[v1],
        vector[side::no()],
        vector[wire::rate()],
        0,
        &clock,
    );

    ts::next_tx(&mut scenario, wire::admin());
    {
        let market_driver = ts::take_shared<MarketDriverRegistry>(&scenario);
        assert!(market_driver::lane_count(&market_driver, alice_token) == 1, 1);
        let (lane_side, _) = market_driver::lane_at(&market_driver, alice_token, &v1);
        assert!(lane_side == side::no(), 2);
        ts::return_shared(market_driver);
    };

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let (yes_rate, _, yes_accrued, _, _, _, _) =
            vault::get_position(&vault_registry, &v1, side::yes(), alice_token);
        let (no_rate, _, _, _, _, _, _) =
            vault::get_position(&vault_registry, &v1, side::no(), alice_token);
        assert!(yes_rate == 0, 3);
        assert!(yes_accrued > 0, 4);
        assert!(no_rate == wire::rate(), 5);
        let (_, no_side_rate, _, _) = vault::get_board(&vault_registry, &v1, side::no());
        assert!(no_side_rate == wire::rate(), 6);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

/// Regression (parity with EVM test_setLanes_refundsDrainedSide): a side whose deposit ran dry is
/// re-fundable. Drain NO, hedge to YES, then switch BACK onto the drained NO — on_fund re-opens it
/// (clearing the run-dry stamp) instead of aborting E_ALREADY_FUNDING. The round-1 NO shares survive.
/// Without the depleted-clear in on_fund this aborts.
#[test]
fun test_set_lanes_refunds_drained_side() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, alice_token, _) = setup_fixture(&mut scenario, &clock);

    // Round 1: stream NO briefly (runway 10s → max_end start+10), then let it run dry.
    fund_holder(
        &mut scenario,
        wire::alice(),
        v1,
        side::no(),
        wire::rate(),
        deposit_units(10),
        &clock,
    );
    wire::warp(&mut clock, wire::start_secs() + 50);
    wire::advance_side(&mut scenario, wire::admin(), v1, side::no(), &clock);

    ts::next_tx(&mut scenario, wire::admin());
    let no_shares0 = {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let (no_rate0, _, no_shares0, _, no_depleted0, _, _) =
            vault::get_position(&vault_registry, &v1, side::no(), alice_token);
        assert!(no_rate0 == 0, 0);
        assert!(no_depleted0, 1);
        assert!(no_shares0 > 0, 2);
        ts::return_shared(vault_registry);
        no_shares0
    };

    // Hedge onto YES (the drained NO drops out; its on_stop is a no-op).
    wire::set_lanes(
        &mut scenario,
        wire::alice(),
        vector[v1],
        vector[side::yes()],
        vector[wire::rate()],
        deposit_units(20),
        &clock,
    );

    // Switch BACK onto the drained NO — the case that used to abort E_ALREADY_FUNDING.
    wire::set_lanes(
        &mut scenario,
        wire::alice(),
        vector[v1],
        vector[side::no()],
        vector[wire::rate()],
        deposit_units(20),
        &clock,
    );

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let (no_rate2, _, no_shares2, _, no_depleted2, _, _) =
            vault::get_position(&vault_registry, &v1, side::no(), alice_token);
        assert!(no_rate2 == wire::rate(), 3);
        assert!(!no_depleted2, 4);
        assert!(no_shares2 >= no_shares0, 5);
        let (yes_rate2, _, _, _, _, _, _) =
            vault::get_position(&vault_registry, &v1, side::yes(), alice_token);
        assert!(yes_rate2 == 0, 6);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 6)]
fun test_fund_reverts_on_second_lane_same_vault() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, _, _) = setup_fixture(&mut scenario, &clock);
    fund_holder(
        &mut scenario,
        wire::alice(),
        v1,
        side::yes(),
        wire::rate(),
        deposit_units(50),
        &clock,
    );
    fund_holder(
        &mut scenario,
        wire::alice(),
        v1,
        side::yes(),
        wire::rate(),
        deposit_units(10),
        &clock,
    );
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 5)]
fun test_fund_reverts_on_wrong_market() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, _, _, _) = setup_fixture(&mut scenario, &clock);
    let other_market = wire::register_market(&mut scenario, wire::admin(), b"other", b"o", &clock);
    let other_vault = wire::bond_vault(&mut scenario, other_market, b"Other?", side::yes(), &clock);
    fund_holder(
        &mut scenario,
        wire::alice(),
        other_vault,
        side::yes(),
        wire::rate(),
        deposit_units(50),
        &clock,
    );
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 7)]
fun test_fund_reverts_on_eleventh_lane_no_partial_state() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (market_id, _, _, _) = setup_fixture(&mut scenario, &clock);
    let mut i = 0u64;
    while (i < 10) {
        let q = if (i == 0) { b"Q0" } else if (i == 1) { b"Q1" } else if (i == 2) { b"Q2" } else if (i == 3) {
            b"Q3"
        } else if (i == 4) { b"Q4" } else if (i == 5) { b"Q5" } else if (i == 6) { b"Q6" } else if (i == 7) {
            b"Q7"
        } else if (i == 8) { b"Q8" } else { b"Q9" };
        let vid = wire::bond_vault(&mut scenario, market_id, q, side::yes(), &clock);
        fund_holder(
            &mut scenario,
            wire::alice(),
            vid,
            side::yes(),
            wire::rate(),
            deposit_units(10),
            &clock,
        );
        i = i + 1;
    };
    let v11 = wire::bond_vault(&mut scenario, market_id, b"Q11", side::yes(), &clock);
    fund_holder(
        &mut scenario,
        wire::alice(),
        v11,
        side::yes(),
        wire::rate(),
        deposit_units(10),
        &clock,
    );
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_set_lanes_reconcile_drops_two_adds_two() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (market_id, _, alice_token, _) = setup_fixture(&mut scenario, &clock);
    let mut vaults = vector[];
    let mut i = 0u64;
    while (i < 10) {
        let q = if (i == 0) { b"S0" } else if (i == 1) { b"S1" } else if (i == 2) { b"S2" } else if (i == 3) {
            b"S3"
        } else if (i == 4) { b"S4" } else if (i == 5) { b"S5" } else if (i == 6) { b"S6" } else if (i == 7) {
            b"S7"
        } else if (i == 8) { b"S8" } else { b"S9" };
        let vid = wire::bond_vault(&mut scenario, market_id, q, side::yes(), &clock);
        vector::push_back(&mut vaults, vid);
        fund_holder(
            &mut scenario,
            wire::alice(),
            vid,
            side::yes(),
            wire::rate(),
            deposit_units(10),
            &clock,
        );
        i = i + 1;
    };
    wire::warp(&mut clock, wire::start_secs() + 5);

    let e = wire::bond_vault(&mut scenario, market_id, b"Se", side::yes(), &clock);
    let w = wire::bond_vault(&mut scenario, market_id, b"Sw", side::yes(), &clock);
    let mut desired_vaults = vector[];
    let mut desired_sides = vector[];
    let mut desired_rates = vector[];
    let mut k = 0u64;
    while (k < 8) {
        vector::push_back(&mut desired_vaults, *vector::borrow(&vaults, k));
        vector::push_back(&mut desired_sides, side::yes());
        vector::push_back(&mut desired_rates, wire::rate());
        k = k + 1;
    };
    vector::push_back(&mut desired_vaults, e);
    vector::push_back(&mut desired_sides, side::no());
    vector::push_back(&mut desired_rates, wire::rate());
    vector::push_back(&mut desired_vaults, w);
    vector::push_back(&mut desired_sides, side::no());
    vector::push_back(&mut desired_rates, wire::rate());

    wire::set_lanes(
        &mut scenario,
        wire::alice(),
        desired_vaults,
        desired_sides,
        desired_rates,
        deposit_units(20),
        &clock,
    );

    ts::next_tx(&mut scenario, wire::admin());
    {
        let market_driver = ts::take_shared<MarketDriverRegistry>(&scenario);
        assert!(market_driver::lane_count(&market_driver, alice_token) == 10, 0);
        ts::return_shared(market_driver);
        let v8 = *vector::borrow(&vaults, 8);
        let v9 = *vector::borrow(&vaults, 9);
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let (r8, _, s8, _, _, _, _) = vault::get_position(&vault_registry, &v8, side::yes(), alice_token);
        let (r9, _, _, _, _, _, _) = vault::get_position(&vault_registry, &v9, side::yes(), alice_token);
        assert!(r8 == 0 && r9 == 0, 1);
        assert!(s8 > 0, 2);
        let (e_rate, _, _, _, _, _, _) = vault::get_position(&vault_registry, &e, side::no(), alice_token);
        let (w_rate, _, _, _, _, _, _) = vault::get_position(&vault_registry, &w, side::no(), alice_token);
        assert!(e_rate == wire::rate() && w_rate == wire::rate(), 3);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 7)]
fun test_set_lanes_reverts_over_max_lanes() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (market_id, _, _, _) = setup_fixture(&mut scenario, &clock);
    let mut desired_vaults = vector[];
    let mut desired_sides = vector[];
    let mut desired_rates = vector[];
    let mut i = 0u64;
    while (i < 11) {
        let q = if (i == 0) { b"O0" } else if (i == 1) { b"O1" } else if (i == 2) { b"O2" } else if (i == 3) {
            b"O3"
        } else if (i == 4) { b"O4" } else if (i == 5) { b"O5" } else if (i == 6) { b"O6" } else if (i == 7) {
            b"O7"
        } else if (i == 8) { b"O8" } else if (i == 9) { b"O9" } else { b"O10" };
        let vid = wire::bond_vault(&mut scenario, market_id, q, side::yes(), &clock);
        vector::push_back(&mut desired_vaults, vid);
        vector::push_back(&mut desired_sides, side::yes());
        vector::push_back(&mut desired_rates, wire::rate());
        i = i + 1;
    };
    wire::set_lanes(
        &mut scenario,
        wire::alice(),
        desired_vaults,
        desired_sides,
        desired_rates,
        deposit_units(100),
        &clock,
    );
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_set_lanes_order_agnostic() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (market_id, _, alice_token, _) = setup_fixture(&mut scenario, &clock);
    let a = wire::bond_vault(&mut scenario, market_id, b"Oa", side::yes(), &clock);
    let b = wire::bond_vault(&mut scenario, market_id, b"Ob", side::yes(), &clock);
    let c = wire::bond_vault(&mut scenario, market_id, b"Oc", side::yes(), &clock);
    fund_holder(&mut scenario, wire::alice(), a, side::yes(), wire::rate(), deposit_units(10), &clock);
    fund_holder(&mut scenario, wire::alice(), b, side::yes(), wire::rate(), deposit_units(10), &clock);
    fund_holder(&mut scenario, wire::alice(), c, side::yes(), wire::rate(), deposit_units(10), &clock);
    let d = wire::bond_vault(&mut scenario, market_id, b"Od", side::yes(), &clock);

    wire::set_lanes(
        &mut scenario,
        wire::alice(),
        vector[c, d, a],
        vector[side::yes(), side::no(), side::yes()],
        vector[wire::rate(), wire::rate(), wire::rate()],
        deposit_units(10),
        &clock,
    );

    ts::next_tx(&mut scenario, wire::admin());
    {
        let market_driver = ts::take_shared<MarketDriverRegistry>(&scenario);
        assert!(market_driver::lane_count(&market_driver, alice_token) == 3, 0);
        ts::return_shared(market_driver);
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let (b_rate, _, _, _, _, _, _) = vault::get_position(&vault_registry, &b, side::yes(), alice_token);
        let (d_rate, _, _, _, _, _, _) = vault::get_position(&vault_registry, &d, side::no(), alice_token);
        let (a_rate, _, _, _, _, _, _) = vault::get_position(&vault_registry, &a, side::yes(), alice_token);
        let (c_rate, _, _, _, _, _, _) = vault::get_position(&vault_registry, &c, side::yes(), alice_token);
        assert!(b_rate == 0 && d_rate == wire::rate() && a_rate == wire::rate() && c_rate == wire::rate(), 1);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_max_end_ripple_after_second_vault_fund() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (market_id, v1, alice_token, _) = setup_fixture(&mut scenario, &clock);
    fund_holder(
        &mut scenario,
        wire::alice(),
        v1,
        side::yes(),
        wire::rate(),
        deposit_units(20),
        &clock,
    );

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let (_, _, _, max_end1, _, _, _) =
            vault::get_position(&vault_registry, &v1, side::yes(), alice_token);
        assert!(max_end1 == 120, 0);
        ts::return_shared(vault_registry);
    };

    let v2 = wire::bond_vault(&mut scenario, market_id, b"Q2?", side::yes(), &clock);
    fund_holder(
        &mut scenario,
        wire::alice(),
        v2,
        side::no(),
        wire::rate(),
        deposit_units(80),
        &clock,
    );

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let (_, _, _, max_end_v1, _, _, _) =
            vault::get_position(&vault_registry, &v1, side::yes(), alice_token);
        let (_, _, _, max_end_v2, _, _, _) =
            vault::get_position(&vault_registry, &v2, side::no(), alice_token);
        assert!(max_end_v1 > 120, 1);
        assert!(max_end_v1 == max_end_v2, 2);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_stop_one_vault_leaves_other_active() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (market_id, v1, alice_token, _) = setup_fixture(&mut scenario, &clock);
    let v2 = wire::bond_vault(&mut scenario, market_id, b"Q2?", side::yes(), &clock);
    fund_holder(&mut scenario, wire::alice(), v1, side::yes(), wire::rate(), deposit_units(50), &clock);
    fund_holder(&mut scenario, wire::alice(), v2, side::no(), wire::rate(), deposit_units(50), &clock);
    wire::stop_lane(&mut scenario, wire::alice(), v1, side::yes(), &clock);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let market_driver = ts::take_shared<MarketDriverRegistry>(&scenario);
        assert!(market_driver::lane_count(&market_driver, alice_token) == 1, 0);
        ts::return_shared(market_driver);
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let (v1_rate, _, _, _, _, _, _) =
            vault::get_position(&vault_registry, &v1, side::yes(), alice_token);
        let (v2_rate, _, _, _, _, _, _) =
            vault::get_position(&vault_registry, &v2, side::no(), alice_token);
        assert!(v1_rate == 0 && v2_rate > 0, 1);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_nft_transfer_new_holder_can_stop() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, _, _) = setup_fixture(&mut scenario, &clock);
    fund_holder(&mut scenario, wire::alice(), v1, side::yes(), wire::rate(), deposit_units(50), &clock);
    wire::transfer_nft(&mut scenario, wire::alice(), wire::bob());
    wire::stop_lane(&mut scenario, wire::bob(), v1, side::yes(), &clock);

    ts::next_tx(&mut scenario, wire::bob());
    {
        assert!(ts::has_most_recent_for_address<MarketPositionNFT>(wire::bob()), 0);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_two_nfts_accrue_by_rate() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, alice_token, bob_token) = setup_fixture(&mut scenario, &clock);
    fund_holder(&mut scenario, wire::alice(), v1, side::yes(), wire::rate(), deposit_units(50), &clock);
    fund_holder(
        &mut scenario,
        wire::bob(),
        v1,
        side::yes(),
        2 * wire::rate(),
        deposit_units(100),
        &clock,
    );
    wire::warp(&mut clock, wire::start_secs() + 50);
    wire::advance_side(&mut scenario, wire::admin(), v1, side::yes(), &clock);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let a_shares = vault::pending_shares(&vault_registry, &v1, side::yes(), alice_token, &clock);
        let b_shares = vault::pending_shares(&vault_registry, &v1, side::yes(), bob_token, &clock);
        assert!(a_shares > 0, 0);
        let diff = if (b_shares > 2 * a_shares) { b_shares - 2 * a_shares } else { 2 * a_shares - b_shares };
        assert!(diff <= 10 * wire::wad(), 1);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_boundary_pileup_still_advances_within_max_steps() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, _, _) = setup_fixture(&mut scenario, &clock);
    let mut i = 0u64;
    while (i < 25) {
        fund_holder(
            &mut scenario,
            wire::alice(),
            v1,
            side::yes(),
            wire::rate(),
            deposit_units(10),
            &clock,
        );
        wire::stop_lane(&mut scenario, wire::alice(), v1, side::yes(), &clock);
        i = i + 1;
    };
    wire::warp(&mut clock, wire::start_secs() + 500);
    wire::advance_side(&mut scenario, wire::admin(), v1, side::yes(), &clock);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        assert!(vault::caught_up(&vault_registry, &v1, side::yes(), &clock), 0);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 11)]
fun test_fund_while_behind_reverts_until_drained() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (market_id, v1, _, _) = setup_fixture(&mut scenario, &clock);
    let n = 65u64;
    let mut i = 0u64;
    while (i < n) {
        let funder = wire::addr(0xF00000 + i);
        wire::mint_nft_to(&mut scenario, wire::admin(), funder, market_id);
        let deposit = ((i + 1) * (wire::rate() as u64)) as u64;
        fund_holder(&mut scenario, funder, v1, side::yes(), wire::rate(), deposit, &clock);
        i = i + 1;
    };
    wire::warp(&mut clock, wire::start_secs() + 200);
    fund_holder(
        &mut scenario,
        wire::alice(),
        v1,
        side::yes(),
        wire::rate(),
        deposit_units(10),
        &clock,
    );
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_fund_while_behind_succeeds_after_drain() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (market_id, v1, alice_token, _) = setup_fixture(&mut scenario, &clock);
    let n = 65u64;
    let mut i = 0u64;
    while (i < n) {
        let funder = wire::addr(0xF00000 + i);
        wire::mint_nft_to(&mut scenario, wire::admin(), funder, market_id);
        let deposit = ((i + 1) * (wire::rate() as u64)) as u64;
        fund_holder(&mut scenario, funder, v1, side::yes(), wire::rate(), deposit, &clock);
        i = i + 1;
    };
    wire::warp(&mut clock, wire::start_secs() + 200);
    wire::advance_side(&mut scenario, wire::admin(), v1, side::yes(), &clock);
    wire::advance_side(&mut scenario, wire::admin(), v1, side::yes(), &clock);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        assert!(vault::caught_up(&vault_registry, &v1, side::yes(), &clock), 0);
        ts::return_shared(vault_registry);
    };

    fund_holder(
        &mut scenario,
        wire::alice(),
        v1,
        side::yes(),
        wire::rate(),
        deposit_units(10),
        &clock,
    );

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let (rate, _, _, _, _, _, _) =
            vault::get_position(&vault_registry, &v1, side::yes(), alice_token);
        assert!(rate == wire::rate(), 1);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_mint_with_salt_two_distinct_nfts() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    wire::setup_stack(&mut scenario, wire::admin());
    let market_id = wire::register_market(&mut scenario, wire::admin(), b"market", b"s", &clock);
    let nft0 = wire::mint_with_salt_nft(&mut scenario, wire::carol(), market_id, 7);
    let nft1 = wire::mint_with_salt_nft(&mut scenario, wire::carol(), market_id, 42);
    assert!(nft0 != nft1, 0);

    ts::next_tx(&mut scenario, wire::carol());
    {
        let nft0 = ts::take_from_address<MarketPositionNFT>(&scenario, wire::carol());
        let nft1 = ts::take_from_address<MarketPositionNFT>(&scenario, wire::carol());
        assert!(market_driver::get_token_id(&nft0) != market_driver::get_token_id(&nft1), 1);
        ts::return_to_address(wire::carol(), nft0);
        ts::return_to_address(wire::carol(), nft1);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 1)]
fun test_mint_with_salt_anti_dupe() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    wire::setup_stack(&mut scenario, wire::admin());
    let market_id = wire::register_market(&mut scenario, wire::admin(), b"market", b"s", &clock);
    wire::mint_with_salt_nft(&mut scenario, wire::carol(), market_id, 7);
    wire::mint_with_salt_nft(&mut scenario, wire::carol(), market_id, 7);
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_mint_non_salt_owned_by_recipient() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    wire::setup_stack(&mut scenario, wire::admin());
    let market_id = wire::register_market(&mut scenario, wire::admin(), b"market", b"s", &clock);
    let token_id = wire::mint_nft(&mut scenario, wire::carol(), market_id);

    ts::next_tx(&mut scenario, wire::carol());
    {
        let nft = ts::take_from_address<MarketPositionNFT>(&scenario, wire::carol());
        assert!(market_driver::get_token_id(&nft) == token_id, 0);
        ts::return_to_address(wire::carol(), nft);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_nft_transfer_in_ownership() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    wire::setup_stack(&mut scenario, wire::admin());
    let market_id = wire::register_market(&mut scenario, wire::admin(), b"market", b"s", &clock);
    let alice_token = wire::mint_nft(&mut scenario, wire::alice(), market_id);
    let carol_token = wire::mint_with_salt_nft(&mut scenario, wire::carol(), market_id, 99);
    wire::transfer_nft(&mut scenario, wire::carol(), wire::alice());

    ts::next_tx(&mut scenario, wire::alice());
    {
        assert!(ts::has_most_recent_for_address<MarketPositionNFT>(wire::alice()), 0);
        let nft_a = ts::take_from_address<MarketPositionNFT>(&scenario, wire::alice());
        let nft_b = ts::take_from_address<MarketPositionNFT>(&scenario, wire::alice());
        let tid_a = market_driver::get_token_id(&nft_a);
        let tid_b = market_driver::get_token_id(&nft_b);
        assert!(tid_a == alice_token || tid_a == carol_token, 1);
        assert!(tid_b == alice_token || tid_b == carol_token, 2);
        assert!(tid_a != tid_b, 3);
        ts::return_to_address(wire::alice(), nft_a);
        ts::return_to_address(wire::alice(), nft_b);
    };

    ts::next_tx(&mut scenario, wire::carol());
    {
        assert!(!ts::has_most_recent_for_address<MarketPositionNFT>(wire::carol()), 4);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 3)]
fun test_fund_zero_rate_reverts() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, _, _) = setup_fixture(&mut scenario, &clock);
    fund_holder(&mut scenario, wire::alice(), v1, side::yes(), 0, deposit_units(10), &clock);
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 4)]
fun test_fund_zero_deposit_reverts() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, _, _) = setup_fixture(&mut scenario, &clock);
    fund_holder(&mut scenario, wire::alice(), v1, side::yes(), wire::rate(), 0, &clock);
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

// ─── Gap 1: vault::claimable ─────────────────────────────────────────────────

/// Before collection claimable returns 0; after collection the winner sees a
/// positive payout preview equal to what withdraw actually delivers.
#[test]
fun test_claimable_matches_withdraw_after_collect() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (market_id, v1, alice_token, bob_token) = setup_fixture(&mut scenario, &clock);
    wire::setup_steward(&mut scenario, wire::admin(), wire::steward());

    // alice funds YES, bob funds NO — equal stakes
    fund_holder(&mut scenario, wire::alice(), v1, side::yes(), wire::rate(), deposit_units(50), &clock);
    fund_holder(&mut scenario, wire::bob(), v1, side::no(), wire::rate(), deposit_units(50), &clock);

    // advance time so both sides have accrued
    wire::warp(&mut clock, wire::start_secs() + 50);

    // resolve YES wins, then collect
    wire::resolve_vault(&mut scenario, wire::steward(), v1, true, &clock);
    wire::collect_vault(&mut scenario, v1, &clock);
    wire::warp(&mut clock, wire::start_secs() + 50 + wire::cycle_secs());

    // before withdraw: claimable should be positive for winner (alice), 0 for loser (bob)
    ts::next_tx(&mut scenario, wire::admin());
    let preview = {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let alice_preview = vault::claimable(&vault_registry, alice_token, &v1, side::yes());
        let bob_preview   = vault::claimable(&vault_registry, bob_token, &v1, side::yes());
        let bob_wrong     = vault::claimable(&vault_registry, bob_token, &v1, side::no());
        assert!(alice_preview > 0, 0);
        assert!(bob_preview == 0, 1);   // bob has no YES position
        assert!(bob_wrong == 0, 2);     // bob is loser side
        ts::return_shared(vault_registry);
        alice_preview
    };

    // withdraw delivers exactly what claimable previewed
    let paid = wire::withdraw_market(&mut scenario, wire::alice(), v1, &clock);
    assert!((paid as u256) == preview, 3);

    // after withdraw claimable is 0 (position is claimed)
    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        assert!(vault::claimable(&vault_registry, alice_token, &v1, side::yes()) == 0, 4);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

/// claimable returns 0 when vault is not yet resolved.
#[test]
fun test_claimable_zero_before_resolution() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, alice_token, _) = setup_fixture(&mut scenario, &clock);
    fund_holder(&mut scenario, wire::alice(), v1, side::yes(), wire::rate(), deposit_units(50), &clock);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        assert!(vault::claimable(&vault_registry, alice_token, &v1, side::yes()) == 0, 0);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

// ─── Gap 2: market_driver::withdraw_many ─────────────────────────────────────

/// withdraw_many over two resolved vaults delivers the sum of two single withdraws.
#[test]
fun test_withdraw_many_equals_sum_of_singles() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (market_id, v1, alice_token, bob_token) = setup_fixture(&mut scenario, &clock);
    wire::setup_steward(&mut scenario, wire::admin(), wire::steward());

    // create a second vault on the same market
    let v2 = wire::bond_vault_question(&mut scenario, market_id, b"Q2?", side::no(), &clock);

    // alice funds YES on v1; alice funds YES on v2 (v2 seed side is NO, so YES is valid funder side)
    fund_holder(&mut scenario, wire::alice(), v1, side::yes(), wire::rate(), deposit_units(50), &clock);
    fund_holder(&mut scenario, wire::alice(), v2, side::yes(), wire::rate(), deposit_units(50), &clock);
    // bob funds the losing side on both so the pot is non-zero
    fund_holder(&mut scenario, wire::bob(), v1, side::no(), wire::rate(), deposit_units(50), &clock);
    fund_holder(&mut scenario, wire::bob(), v2, side::no(), wire::rate(), deposit_units(50), &clock);

    wire::warp(&mut clock, wire::start_secs() + 50);
    wire::resolve_vault(&mut scenario, wire::steward(), v1, true, &clock);
    wire::resolve_vault(&mut scenario, wire::steward(), v2, true, &clock);
    wire::collect_vault(&mut scenario, v1, &clock);
    wire::collect_vault(&mut scenario, v2, &clock);
    wire::warp(&mut clock, wire::start_secs() + 50 + wire::cycle_secs());

    // snapshot individual claimable previews before withdrawing
    let (preview_v1, preview_v2) = {
        ts::next_tx(&mut scenario, wire::admin());
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let p1 = vault::claimable(&vault_registry, alice_token, &v1, side::yes());
        let p2 = vault::claimable(&vault_registry, alice_token, &v2, side::yes());
        assert!(p1 > 0, 0);
        assert!(p2 > 0, 1);
        ts::return_shared(vault_registry);
        (p1, p2)
    };

    // execute withdraw_many and confirm total
    ts::next_tx(&mut scenario, wire::alice());
    {
        let registry = ts::take_shared<MarketDriverRegistry>(&scenario);
        let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let nft = ts::take_from_address<MarketPositionNFT>(&scenario, wire::alice());
        let ctx = ts::ctx(&mut scenario);
        let total = market_driver::withdraw_many(
            &registry,
            &nft,
            &mut vault_registry,
            vector[v1, v2],
            @0x0,
            &clock,
            ctx,
        );
        assert!((total as u256) == preview_v1 + preview_v2, 2);
        ts::return_to_address(wire::alice(), nft);
        ts::return_shared(registry);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

/// withdraw_many on an empty vault_ids list returns 0.
#[test]
fun test_withdraw_many_empty_list_returns_zero() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, _, _, _) = setup_fixture(&mut scenario, &clock);

    ts::next_tx(&mut scenario, wire::alice());
    {
        let registry = ts::take_shared<MarketDriverRegistry>(&scenario);
        let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let nft = ts::take_from_address<MarketPositionNFT>(&scenario, wire::alice());
        let ctx = ts::ctx(&mut scenario);
        let total = market_driver::withdraw_many(
            &registry,
            &nft,
            &mut vault_registry,
            vector[],
            @0x0,
            &clock,
            ctx,
        );
        assert!(total == 0, 0);
        ts::return_to_address(wire::alice(), nft);
        ts::return_shared(registry);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}


// CON.S3: a desired_sides/desired_rates length mismatch must abort with E_LENGTH_MISMATCH (11),
// NOT the misleading E_DUPLICATE_VAULT (9) it used to report.
#[test, expected_failure(abort_code = 11)]
fun test_set_lanes_length_mismatch_aborts() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (market_id, _, _, _) = setup_fixture(&mut scenario, &clock);
    let v0 = wire::bond_vault(&mut scenario, market_id, b"L0", side::yes(), &clock);
    let v1 = wire::bond_vault(&mut scenario, market_id, b"L1", side::yes(), &clock);

    // 2 vault ids, but only 1 side and 1 rate → length mismatch.
    let desired_vaults = vector[v0, v1];
    let desired_sides = vector[side::yes()];
    let desired_rates = vector[wire::rate()];

    wire::set_lanes(
        &mut scenario,
        wire::alice(),
        desired_vaults,
        desired_sides,
        desired_rates,
        deposit_units(10),
        &clock,
    );

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}
