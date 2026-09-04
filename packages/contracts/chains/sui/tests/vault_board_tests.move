// SPDX-License-Identifier: MIT

#[test_only]
module livestreak::vault_board_tests;

use livestreak::bonding_board;
use livestreak::drips::{Self, DripsRegistry};
use livestreak::protocol_wire::{Self as wire};
use livestreak::side;
use livestreak::streams::StreamsRegistry;
use livestreak::test_usdc::TEST_USDC;
use livestreak::vault::{Self, VaultRegistry};
use livestreak::vault_driver::{Self, VaultDriverRegistry};
use sui::clock::{Self, Clock};
use sui::test_scenario::{Self as ts};

fun setup_board_fixture(
    scenario: &mut ts::Scenario,
    clock: &Clock,
): (vector<u8>, vector<u8>, vector<u8>, u256, u256) {
    wire::setup_stack(scenario, wire::admin());
    let market_id = wire::register_market(scenario, wire::admin(), b"market", b"s", clock);
    let v1 = wire::bond_vault(scenario, market_id, b"Q1?", side::yes(), clock);
    let v2 = wire::bond_vault(scenario, market_id, b"Q2?", side::no(), clock);
    let alice_token = wire::mint_nft(scenario, wire::alice(), market_id);
    let bob_token = wire::mint_nft(scenario, wire::bob(), market_id);
    (market_id, v1, v2, alice_token, bob_token)
}

fun deposit_50_rate(): u64 {
    50 * (wire::rate() as u64)
}

#[test]
fun test_accrual_single_funder_worked_example() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, _, alice_token, _) = setup_board_fixture(&mut scenario, &clock);

    let nft = wire::take_nft(&mut scenario, wire::alice());
    wire::fund(
        &mut scenario,
        wire::alice(),
        &nft,
        v1,
        side::yes(),
        wire::rate(),
        deposit_50_rate(),
        &clock,
    );
    wire::return_nft(&mut scenario, wire::alice(), nft);

    wire::warp(&mut clock, wire::start_secs() + 50);
    ts::next_tx(&mut scenario, wire::admin());
    {
        let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        vault::advance(&mut vault_registry, v1, side::yes(), 64, &clock);
        let shares_scaled =
            vault::pending_shares(&vault_registry, &v1, side::yes(), alice_token, &clock)
                / bonding_board::wad();
        assert!(wire::abs_diff(shares_scaled, wire::evm_shares_worked()) <= wire::share_tolerance(), 0);
        assert!(shares_scaled < 500_000_000, 1);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_depletion_pricing_pool_equals_delivered_usdc() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, _, alice_token, _) = setup_board_fixture(&mut scenario, &clock);

    let nft = wire::take_nft(&mut scenario, wire::alice());
    wire::fund(
        &mut scenario,
        wire::alice(),
        &nft,
        v1,
        side::yes(),
        wire::rate(),
        deposit_50_rate(),
        &clock,
    );
    wire::return_nft(&mut scenario, wire::alice(), nft);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let (_, _, _, max_end, _, _, _) =
            vault::get_position(&vault_registry, &v1, side::yes(), alice_token);
        assert!(max_end == 150, 0);
        ts::return_shared(vault_registry);
    };

    wire::warp(&mut clock, 200);
    ts::next_tx(&mut scenario, wire::admin());
    {
        let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        vault::advance(&mut vault_registry, v1, side::yes(), 64, &clock);
        let (pool, side_rate, _, _) = vault::get_board(&vault_registry, &v1, side::yes());
        assert!(pool == 50 * wire::rate(), 1);
        assert!(side_rate == 0, 2);
        let (_, _, _, _, depleted, _, _) =
            vault::get_position(&vault_registry, &v1, side::yes(), alice_token);
        assert!(depleted, 3);
        ts::return_shared(vault_registry);
    };

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_driver = ts::take_shared<VaultDriverRegistry>(&scenario);
        let mut drips = ts::take_shared<DripsRegistry<TEST_USDC>>(&scenario);
        let mut streams = ts::take_shared<StreamsRegistry<TEST_USDC>>(&scenario);
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        let receiver = vault_driver::receiver_account_view(&vault_driver, v1, side::yes());
        let delivered = drips::receive_streams(&mut drips, &mut streams, receiver, 0xFFFFFFFF, &clock, ctx);
        let (pool, _, _, _) = vault::get_board(&vault_registry, &v1, side::yes());
        assert!((delivered as u256) == pool, 4);
        ts::return_shared(vault_driver);
        ts::return_shared(drips);
        ts::return_shared(streams);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_fairness_poke_frequency_does_not_change_shares() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, _, alice_token, bob_token) = setup_board_fixture(&mut scenario, &clock);
    let deposit = deposit_50_rate();

    let alice_nft = wire::take_nft(&mut scenario, wire::alice());
    wire::fund(
        &mut scenario,
        wire::alice(),
        &alice_nft,
        v1,
        side::yes(),
        wire::rate(),
        deposit,
        &clock,
    );
    wire::return_nft(&mut scenario, wire::alice(), alice_nft);

    let bob_nft = wire::take_nft(&mut scenario, wire::bob());
    wire::fund(
        &mut scenario,
        wire::bob(),
        &bob_nft,
        v1,
        side::yes(),
        wire::rate(),
        deposit,
        &clock,
    );
    wire::return_nft(&mut scenario, wire::bob(), bob_nft);

    let mut t = wire::start_secs() + 1;
    while (t <= 149) {
        wire::warp(&mut clock, t);
        ts::next_tx(&mut scenario, wire::admin());
        {
            let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
            vault::settle(&mut vault_registry, v1, side::yes(), alice_token, &clock);
            ts::return_shared(vault_registry);
        };
        t = t + 1;
    };

    wire::warp(&mut clock, 200);
    ts::next_tx(&mut scenario, wire::admin());
    {
        let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        vault::advance(&mut vault_registry, v1, side::yes(), 64, &clock);
        let (_, _, a_shares, _, _, _, _) =
            vault::get_position(&vault_registry, &v1, side::yes(), alice_token);
        let (_, _, b_shares, _, _, _, _) =
            vault::get_position(&vault_registry, &v1, side::yes(), bob_token);
        assert!(a_shares > 0, 0);
        assert!(a_shares == b_shares, 1);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_independence_across_vaults() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, v2, _, _) = setup_board_fixture(&mut scenario, &clock);
    let deposit = 100 * (wire::rate() as u64);

    let alice_nft = wire::take_nft(&mut scenario, wire::alice());
    wire::fund(
        &mut scenario,
        wire::alice(),
        &alice_nft,
        v1,
        side::yes(),
        wire::rate(),
        deposit,
        &clock,
    );
    wire::return_nft(&mut scenario, wire::alice(), alice_nft);

    let bob_nft = wire::take_nft(&mut scenario, wire::bob());
    wire::fund(
        &mut scenario,
        wire::bob(),
        &bob_nft,
        v2,
        side::yes(),
        wire::rate(),
        deposit,
        &clock,
    );
    wire::return_nft(&mut scenario, wire::bob(), bob_nft);

    wire::warp(&mut clock, wire::start_secs() + 40);
    ts::next_tx(&mut scenario, wire::admin());
    {
        let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        vault::advance(&mut vault_registry, v1, side::yes(), 64, &clock);
        let (pool1, _, g1, _) = vault::get_board(&vault_registry, &v1, side::yes());
        let (pool2, _, g2, last2) = vault::get_board(&vault_registry, &v2, side::yes());
        assert!(g1 > 0, 0);
        assert!(pool2 == 0, 1);
        assert!(g2 == 0, 2);
        assert!(last2 == wire::start_secs(), 3);
        vault::advance(&mut vault_registry, v2, side::yes(), 64, &clock);
        let (pool2b, _, g2b, _) = vault::get_board(&vault_registry, &v2, side::yes());
        assert!(pool2b == pool1, 4);
        assert!(g2b == g1, 5);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_bounded_advance_chunked_equals_uncapped() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (market_id, v1, _, _, _) = setup_board_fixture(&mut scenario, &clock);
    let n = 10u64;
    let mut i = 1u64;
    let rate_u64 = wire::rate() as u64;

    while (i <= n) {
        let who_y = wire::addr(i + 1000);
        let who_n = wire::addr(i + 5000);
        let deposit = rate_u64 * 10 * i;
        wire::mint_nft(&mut scenario, who_y, market_id);
        wire::mint_nft(&mut scenario, who_n, market_id);
        let nft_y = wire::take_nft(&mut scenario, who_y);
        wire::fund(
            &mut scenario,
            who_y,
            &nft_y,
            v1,
            side::yes(),
            wire::rate(),
            deposit,
            &clock,
        );
        wire::return_nft(&mut scenario, who_y, nft_y);
        let nft_n = wire::take_nft(&mut scenario, who_n);
        wire::fund(
            &mut scenario,
            who_n,
            &nft_n,
            v1,
            side::no(),
            wire::rate(),
            deposit,
            &clock,
        );
        wire::return_nft(&mut scenario, who_n, nft_n);
        i = i + 1;
    };

    wire::warp(&mut clock, wire::start_secs() + 10 * (n + 1));
    ts::next_tx(&mut scenario, wire::admin());
    {
        let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let mut calls = 0u64;
        while (!vault::caught_up(&vault_registry, &v1, side::yes(), &clock)) {
            vault::advance(&mut vault_registry, v1, side::yes(), 64, &clock);
            calls = calls + 1;
            assert!(calls < 10, 0);
        };
        assert!(calls == 1, 1);
        vault::advance(&mut vault_registry, v1, side::no(), n + 1, &clock);
        assert!(vault::caught_up(&vault_registry, &v1, side::no(), &clock), 2);
        let (pool_y, _, g_y, _) = vault::get_board(&vault_registry, &v1, side::yes());
        let (pool_n, _, g_n, _) = vault::get_board(&vault_registry, &v1, side::no());
        assert!(g_y == g_n, 3);
        assert!(pool_y == pool_n, 4);
        assert!(g_y > 0, 5);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}
