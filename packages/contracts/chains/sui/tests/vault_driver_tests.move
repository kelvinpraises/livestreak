// SPDX-License-Identifier: MIT

#[test_only]
module livestreak::vault_driver_tests;

use livestreak::drips::{Self, DripsRegistry};
use livestreak::market_driver::MarketPositionNFT;
use livestreak::market_registry::{Self, MarketRegistry};
use livestreak::protocol_wire::{Self as wire};
use livestreak::side;
use livestreak::steward_registry::{Self, StewardRegistry};
use livestreak::streams::StreamsRegistry;
use livestreak::test_usdc::TEST_USDC;
use livestreak::vault::{Self, VaultRegistry};
use livestreak::vault_driver::{Self, VaultDriverRegistry};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::test_scenario::{Self as ts};

fun setup_vault_driver_fixture(
    scenario: &mut ts::Scenario,
    clock: &Clock,
): vector<u8> {
    wire::setup_stack(scenario, wire::admin());
    wire::setup_steward(scenario, wire::admin(), wire::steward());
    wire::register_market(scenario, wire::admin(), b"m", b"s", clock)
}

fun create_vault_as(
    scenario: &mut ts::Scenario,
    who: address,
    market_id: vector<u8>,
    question: vector<u8>,
    seed_side: u8,
    rate: u256,
    deposit: u64,
    clock: &Clock,
): vector<u8> {
    wire::create_vault(scenario, who, market_id, question, seed_side, rate, deposit, clock)
}

#[test]
fun test_permissionless_create_any_address() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let market_id = setup_vault_driver_fixture(&mut scenario, &clock);
    let vault_id = create_vault_as(
        &mut scenario,
        wire::stranger(),
        market_id,
        b"Q?",
        side::yes(),
        wire::rate(),
        wire::creator_seed_deposit(),
        &clock,
    );

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        assert!(vault::vault_exists(&vault_registry, &vault_id), 0);
        let data = vault::get_vault(&vault_registry, &vault_id);
        assert!(vault::vault_status(&data) == 0, 1);
        ts::return_shared(vault_registry);
        let market_registry = ts::take_shared<MarketRegistry>(&scenario);
        assert!(vector::length(market_registry::get_vault_ids(&market_registry, &market_id)) == 1, 2);
        ts::return_shared(market_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_seed_opens_real_position() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let market_id = setup_vault_driver_fixture(&mut scenario, &clock);
    let vault_id = create_vault_as(
        &mut scenario,
        wire::creator(),
        market_id,
        b"Q?",
        side::yes(),
        wire::rate(),
        wire::creator_seed_deposit(),
        &clock,
    );

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_driver = ts::take_shared<VaultDriverRegistry>(&scenario);
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let account = vault_driver::seed_account(&vault_driver, wire::creator(), vault_id);
        let (rate, _, _, max_end, _, _, _) =
            vault::get_position(&vault_registry, &vault_id, side::yes(), account);
        assert!(rate == wire::rate(), 0);
        assert!(max_end > wire::start_secs(), 1);
        ts::return_shared(vault_driver);
        ts::return_shared(vault_registry);
    };

    wire::warp(&mut clock, wire::start_secs() + 5);
    wire::advance_side(&mut scenario, wire::admin(), vault_id, side::yes(), &clock);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_driver = ts::take_shared<VaultDriverRegistry>(&scenario);
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let account = vault_driver::seed_account(&vault_driver, wire::creator(), vault_id);
        let shares = vault::pending_shares(&vault_registry, &vault_id, side::yes(), account, &clock);
        assert!(shares > 0, 2);
        ts::return_shared(vault_driver);
        ts::return_shared(vault_registry);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 2)]
fun test_zero_rate_reverts() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let market_id = setup_vault_driver_fixture(&mut scenario, &clock);
    create_vault_as(
        &mut scenario,
        wire::creator(),
        market_id,
        b"Q?",
        side::yes(),
        0,
        wire::creator_seed_deposit(),
        &clock,
    );
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 3)]
fun test_zero_deposit_reverts() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let market_id = setup_vault_driver_fixture(&mut scenario, &clock);
    create_vault_as(
        &mut scenario,
        wire::creator(),
        market_id,
        b"Q?",
        side::yes(),
        wire::rate(),
        0,
        &clock,
    );
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 4)]
fun test_unknown_market_reverts() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    setup_vault_driver_fixture(&mut scenario, &clock);
    create_vault_as(
        &mut scenario,
        wire::creator(),
        b"bogus-market-id-99",
        b"Q?",
        side::yes(),
        wire::rate(),
        wire::creator_seed_deposit(),
        &clock,
    );
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 1)]
fun test_empty_question_reverts() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let market_id = setup_vault_driver_fixture(&mut scenario, &clock);
    create_vault_as(
        &mut scenario,
        wire::creator(),
        market_id,
        b"",
        side::yes(),
        wire::rate(),
        wire::creator_seed_deposit(),
        &clock,
    );
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_seed_recoverable_via_withdraw() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let market_id = setup_vault_driver_fixture(&mut scenario, &clock);
    let vault_id = create_vault_as(
        &mut scenario,
        wire::creator(),
        market_id,
        b"Q?",
        side::yes(),
        wire::rate(),
        wire::creator_seed_deposit(),
        &clock,
    );
    let _bob_token = wire::mint_nft(&mut scenario, wire::bob(), market_id);
    let nft = wire::take_nft(&mut scenario, wire::bob());
    wire::fund(
        &mut scenario,
        wire::bob(),
        &nft,
        vault_id,
        side::no(),
        wire::rate(),
        wire::creator_seed_deposit(),
        &clock,
    );
    wire::return_nft(&mut scenario, wire::bob(), nft);

    wire::warp(&mut clock, 200);
    wire::resolve_vault(&mut scenario, wire::steward(), vault_id, true, &clock);
    wire::collect_vault(&mut scenario, vault_id, &clock);
    wire::warp(&mut clock, 200 + wire::cycle_secs());

    let before = wire::usdc_balance_of(&mut scenario, wire::creator());
    let paid = wire::withdraw_seed(&mut scenario, wire::creator(), vault_id, &clock);
    assert!(paid > 0, 0);
    assert!(wire::usdc_balance_of(&mut scenario, wire::creator()) - before == (paid as u64), 1);
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_stop_seed_closes_lane_and_refunds_unspent() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let market_id = setup_vault_driver_fixture(&mut scenario, &clock);
    let vault_id = create_vault_as(
        &mut scenario,
        wire::creator(),
        market_id,
        b"Q?",
        side::no(),
        wire::rate(),
        wire::creator_seed_deposit(),
        &clock,
    );
    wire::warp(&mut clock, wire::start_secs() + 5);
    let before = wire::usdc_balance_of(&mut scenario, wire::creator());

    ts::next_tx(&mut scenario, wire::creator());
    {
        let mut vault_driver = ts::take_shared<VaultDriverRegistry>(&scenario);
        let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let mut drips = ts::take_shared<DripsRegistry<TEST_USDC>>(&scenario);
        let mut streams = ts::take_shared<StreamsRegistry<TEST_USDC>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        let refunded = vault_driver::stop_seed(
            &mut vault_driver,
            &mut vault_registry,
            &mut drips,
            &mut streams,
            vault_id,
            &clock,
            ctx,
        );
        assert!(refunded > 0, 0);
        let expected = (5 * wire::rate()) as u128;
        let diff = if (refunded > expected) { refunded - expected } else { expected - refunded };
        assert!(diff <= (wire::rate() as u128), 1);
        ts::return_shared(vault_driver);
        ts::return_shared(vault_registry);
        ts::return_shared(drips);
        ts::return_shared(streams);
    };

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_driver = ts::take_shared<VaultDriverRegistry>(&scenario);
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let account = vault_driver::seed_account(&vault_driver, wire::creator(), vault_id);
        let (rate, _, _, _, _, _, _) =
            vault::get_position(&vault_registry, &vault_id, side::no(), account);
        assert!(rate == 0, 2);
        ts::return_shared(vault_driver);
        ts::return_shared(vault_registry);
    };

    let after = wire::usdc_balance_of(&mut scenario, wire::creator());
    assert!(after > before, 3);

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}
