// SPDX-License-Identifier: MIT

#[test_only]
module livestreak::treasury_tests;

use livestreak::protocol_wire::{Self as wire};
use livestreak::side;
use livestreak::test_usdc::TEST_USDC;
use livestreak::treasury::{Self, TreasuryRegistry};
use livestreak::vault::{Self, VaultRegistry};
use sui::clock::{Self, Clock};
use sui::test_scenario::{Self as ts};

fun deposit_50(): u64 {
    50 * (wire::rate() as u64)
}

fun setup_treasury_fixture(
    scenario: &mut ts::Scenario,
    clock: &Clock,
): (vector<u8>, vector<u8>, u256, u256) {
    wire::setup_stack(scenario, wire::admin());
    wire::setup_steward(scenario, wire::admin(), wire::steward());
    let market_id = wire::register_market(scenario, wire::admin(), b"m", b"s", clock);
    let v1 = wire::bond_vault(scenario, market_id, b"Q?", side::yes(), clock);
    let alice_token = wire::mint_nft(scenario, wire::alice(), market_id);
    let bob_token = wire::mint_nft(scenario, wire::bob(), market_id);
    (market_id, v1, alice_token, bob_token)
}

fun fund_both(
    scenario: &mut ts::Scenario,
    v1: vector<u8>,
    clock: &Clock,
) {
    let alice_nft = wire::take_nft(scenario, wire::alice());
    wire::fund(
        scenario,
        wire::alice(),
        &alice_nft,
        v1,
        side::yes(),
        wire::rate(),
        deposit_50(),
        clock,
    );
    wire::return_nft(scenario, wire::alice(), alice_nft);
    let bob_nft = wire::take_nft(scenario, wire::bob());
    wire::fund(
        scenario,
        wire::bob(),
        &bob_nft,
        v1,
        side::no(),
        wire::rate(),
        deposit_50(),
        clock,
    );
    wire::return_nft(scenario, wire::bob(), bob_nft);
}

#[test]
fun test_collect_zero_winner_shares_sweeps_pot_to_treasury() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (market_id, _, _, bob_token) = setup_treasury_fixture(&mut scenario, &clock);
    let vz = wire::bond_vault(&mut scenario, market_id, b"ZeroWin?", side::no(), &clock);
    let bob_nft = wire::take_nft(&mut scenario, wire::bob());
    wire::fund(
        &mut scenario,
        wire::bob(),
        &bob_nft,
        vz,
        side::no(),
        wire::rate(),
        deposit_50(),
        &clock,
    );
    wire::return_nft(&mut scenario, wire::bob(), bob_nft);
    wire::warp(&mut clock, 200);
    wire::resolve_vault(&mut scenario, wire::steward(), vz, true, &clock);

    ts::next_tx(&mut scenario, wire::admin());
    let treasury_before = {
        let treasury = ts::take_shared<TreasuryRegistry<TEST_USDC>>(&scenario);
        let bal = treasury::treasury_usdc_balance(&treasury);
        ts::return_shared(treasury);
        bal
    };

    wire::collect_vault(&mut scenario, vz, &clock);
    wire::warp(&mut clock, 200 + 3 * wire::cycle_secs());
    wire::collect_vault(&mut scenario, vz, &clock);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let (_, _, yes_share_total, _) = vault::get_vault_pools(&vault_registry, &vz);
        assert!(yes_share_total == 0, 0);
        assert!(vault::pot(&vault_registry, &vz) == 0, 1);
        assert!(vault::loss_claimable(&vault_registry, bob_token, &vz, side::no()) > 0, 2);
        ts::return_shared(vault_registry);
        let treasury = ts::take_shared<TreasuryRegistry<TEST_USDC>>(&scenario);
        assert!(treasury::treasury_usdc_balance(&treasury) > treasury_before, 3);
        ts::return_shared(treasury);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_loss_mints_flow_on_curve() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, alice_token, bob_token) = setup_treasury_fixture(&mut scenario, &clock);
    fund_both(&mut scenario, v1, &clock);
    wire::warp(&mut clock, 200);
    wire::resolve_vault(&mut scenario, wire::steward(), v1, true, &clock);
    wire::collect_vault(&mut scenario, v1, &clock);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        assert!(vault::loss_claimable(&vault_registry, bob_token, &v1, side::no()) == 50 * wire::rate(), 0);
        assert!(vault::loss_claimable(&vault_registry, alice_token, &v1, side::yes()) == 0, 1);
        ts::return_shared(vault_registry);
        let treasury = ts::take_shared<TreasuryRegistry<TEST_USDC>>(&scenario);
        let rate = treasury::mint_rate(&treasury);
        let expected = (50 * wire::rate() * rate) / 1_000_000;
        ts::return_shared(treasury);
        let minted = wire::claim_loss_lvst(&mut scenario, wire::bob(), v1, side::no());
        assert!(minted == expected, 2);
        assert!(wire::lvst_balance_of(&mut scenario, wire::bob()) == (minted as u64), 3);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 1)]
fun test_loss_mint_anti_double_claim() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, _, _) = setup_treasury_fixture(&mut scenario, &clock);
    fund_both(&mut scenario, v1, &clock);
    wire::warp(&mut clock, 200);
    wire::resolve_vault(&mut scenario, wire::steward(), v1, true, &clock);
    wire::collect_vault(&mut scenario, v1, &clock);
    wire::claim_loss_lvst(&mut scenario, wire::bob(), v1, side::no());
    wire::claim_loss_lvst(&mut scenario, wire::bob(), v1, side::no());
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 2)]
fun test_loss_mint_nothing_lost_reverts() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, _, _) = setup_treasury_fixture(&mut scenario, &clock);
    fund_both(&mut scenario, v1, &clock);
    wire::warp(&mut clock, 200);
    wire::resolve_vault(&mut scenario, wire::steward(), v1, true, &clock);
    wire::collect_vault(&mut scenario, v1, &clock);
    wire::claim_loss_lvst(&mut scenario, wire::alice(), v1, side::yes());
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_skim_reduces_pot_and_feeds_house_pot() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, _, _) = setup_treasury_fixture(&mut scenario, &clock);
    fund_both(&mut scenario, v1, &clock);
    wire::warp(&mut clock, 200);
    wire::resolve_vault(&mut scenario, wire::steward(), v1, true, &clock);
    wire::collect_vault(&mut scenario, v1, &clock);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let treasury = ts::take_shared<TreasuryRegistry<TEST_USDC>>(&scenario);
        let skim = (50 * wire::rate() * 200) / 10_000;
        assert!(treasury::total_skimmed(&treasury) == skim, 0);
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        assert!(vault::pot(&vault_registry, &v1) == 100 * wire::rate() - skim, 1);
        assert!(treasury::treasury_usdc_balance(&treasury) == (skim as u128), 2);
        ts::return_shared(treasury);
        ts::return_shared(vault_registry);
    };

    let withdrawn = wire::withdraw_market(&mut scenario, wire::alice(), v1, &clock);
    assert!(withdrawn == (100 * wire::rate() - (50 * wire::rate() * 200) / 10_000) as u128, 3);

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_no_loss_no_skim_full_refund() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, _, _) = setup_treasury_fixture(&mut scenario, &clock);
    let alice_nft = wire::take_nft(&mut scenario, wire::alice());
    wire::fund(
        &mut scenario,
        wire::alice(),
        &alice_nft,
        v1,
        side::yes(),
        wire::rate(),
        deposit_50(),
        &clock,
    );
    wire::return_nft(&mut scenario, wire::alice(), alice_nft);
    wire::warp(&mut clock, 200);
    wire::resolve_vault(&mut scenario, wire::steward(), v1, true, &clock);
    wire::collect_vault(&mut scenario, v1, &clock);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let treasury = ts::take_shared<TreasuryRegistry<TEST_USDC>>(&scenario);
        assert!(treasury::total_skimmed(&treasury) == 0, 0);
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        assert!(vault::pot(&vault_registry, &v1) == 50 * wire::rate(), 1);
        ts::return_shared(treasury);
        ts::return_shared(vault_registry);
    };

    let withdrawn = wire::withdraw_market(&mut scenario, wire::alice(), v1, &clock);
    assert!(withdrawn == (50 * wire::rate()) as u128, 2);

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_stake_earns_dividends() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (market_id, v1, _, _) = setup_treasury_fixture(&mut scenario, &clock);
    fund_both(&mut scenario, v1, &clock);
    wire::warp(&mut clock, 200);
    wire::resolve_vault(&mut scenario, wire::steward(), v1, true, &clock);
    wire::collect_vault(&mut scenario, v1, &clock);
    wire::claim_loss_lvst(&mut scenario, wire::bob(), v1, side::no());
    wire::stake_lvst_from_wallet(&mut scenario, wire::bob());

    let v2 = wire::bond_vault(&mut scenario, market_id, b"Q2?", side::yes(), &clock);
    let _carol_token = wire::mint_nft(&mut scenario, wire::carol(), market_id);
    let _dave_token = wire::mint_nft(&mut scenario, wire::dave(), market_id);
    let carol_nft = wire::take_nft(&mut scenario, wire::carol());
    wire::fund(&mut scenario, wire::carol(), &carol_nft, v2, side::yes(), wire::rate(), deposit_50(), &clock);
    wire::return_nft(&mut scenario, wire::carol(), carol_nft);
    let dave_nft = wire::take_nft(&mut scenario, wire::dave());
    wire::fund(&mut scenario, wire::dave(), &dave_nft, v2, side::no(), wire::rate(), deposit_50(), &clock);
    wire::return_nft(&mut scenario, wire::dave(), dave_nft);
    wire::warp(&mut clock, 400);
    wire::resolve_vault(&mut scenario, wire::steward(), v2, true, &clock);
    wire::collect_vault(&mut scenario, v2, &clock);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let treasury = ts::take_shared<TreasuryRegistry<TEST_USDC>>(&scenario);
        let pending = treasury::pending_dividends(&treasury, wire::bob());
        assert!(pending <= (treasury::total_skimmed(&treasury) as u128), 0);
        let skim = treasury::total_skimmed(&treasury) as u128;
        let diff = if (pending > skim) { pending - skim } else { skim - pending };
        assert!(diff <= 10_000, 1);
        assert!(pending > 0, 2);
        ts::return_shared(treasury);
    };

    let before = wire::usdc_balance_of(&mut scenario, wire::bob());
    let paid = wire::claim_dividends_usdc(&mut scenario, wire::bob());
    assert!(wire::usdc_balance_of(&mut scenario, wire::bob()) - before == (paid as u64), 3);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let treasury = ts::take_shared<TreasuryRegistry<TEST_USDC>>(&scenario);
        assert!(treasury::pending_dividends(&treasury, wire::bob()) == 0, 4);
        ts::return_shared(treasury);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_claim_and_stake_loss_lvst() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, _, _) = setup_treasury_fixture(&mut scenario, &clock);
    fund_both(&mut scenario, v1, &clock);
    wire::warp(&mut clock, 200);
    wire::resolve_vault(&mut scenario, wire::steward(), v1, true, &clock);
    wire::collect_vault(&mut scenario, v1, &clock);
    let minted = wire::claim_loss_lvst(&mut scenario, wire::bob(), v1, side::no());
    wire::stake_lvst_from_wallet(&mut scenario, wire::bob());

    ts::next_tx(&mut scenario, wire::admin());
    {
        let treasury = ts::take_shared<TreasuryRegistry<TEST_USDC>>(&scenario);
        assert!(treasury::lvst_staked(&treasury, wire::bob()) == (minted as u128), 0);
        ts::return_shared(treasury);
    };
    assert!(wire::lvst_balance_of(&mut scenario, wire::bob()) == 0, 1);

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_mint_rate_decays_with_pool() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (_, v1, _, _) = setup_treasury_fixture(&mut scenario, &clock);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let treasury = ts::take_shared<TreasuryRegistry<TEST_USDC>>(&scenario);
        assert!(treasury::mint_rate(&treasury) == treasury::mint_start(&treasury), 0);
        ts::return_shared(treasury);
    };

    fund_both(&mut scenario, v1, &clock);
    wire::warp(&mut clock, 200);
    wire::resolve_vault(&mut scenario, wire::steward(), v1, true, &clock);
    wire::collect_vault(&mut scenario, v1, &clock);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let treasury = ts::take_shared<TreasuryRegistry<TEST_USDC>>(&scenario);
        assert!(treasury::mint_rate(&treasury) < treasury::mint_start(&treasury), 1);
        assert!(treasury::mint_rate(&treasury) >= treasury::mint_floor(&treasury), 2);
        ts::return_shared(treasury);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_wash_self_limits() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (market_id, v1, _, _) = setup_treasury_fixture(&mut scenario, &clock);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let mut treasury = ts::take_shared<TreasuryRegistry<TEST_USDC>>(&scenario);
        treasury::set_mint_params_for_test(
            &mut treasury,
            100_000_000_000,
            1_000_000_000,
            100 * (wire::rate() as u256),
        );
        ts::return_shared(treasury);
    };

    ts::next_tx(&mut scenario, wire::admin());
    let r0 = {
        let treasury = ts::take_shared<TreasuryRegistry<TEST_USDC>>(&scenario);
        let r = treasury::mint_rate(&treasury);
        ts::return_shared(treasury);
        r
    };

    fund_both(&mut scenario, v1, &clock);
    wire::warp(&mut clock, 200);
    wire::resolve_vault(&mut scenario, wire::steward(), v1, true, &clock);
    wire::collect_vault(&mut scenario, v1, &clock);

    ts::next_tx(&mut scenario, wire::admin());
    let r1 = {
        let treasury = ts::take_shared<TreasuryRegistry<TEST_USDC>>(&scenario);
        let r = treasury::mint_rate(&treasury);
        ts::return_shared(treasury);
        r
    };

    let v2 = wire::bond_vault(&mut scenario, market_id, b"Q2?", side::yes(), &clock);
    let _carol_token = wire::mint_nft(&mut scenario, wire::carol(), market_id);
    let _dave_token = wire::mint_nft(&mut scenario, wire::dave(), market_id);
    let carol_nft = wire::take_nft(&mut scenario, wire::carol());
    wire::fund(&mut scenario, wire::carol(), &carol_nft, v2, side::yes(), wire::rate(), deposit_50(), &clock);
    wire::return_nft(&mut scenario, wire::carol(), carol_nft);
    let dave_nft = wire::take_nft(&mut scenario, wire::dave());
    wire::fund(&mut scenario, wire::dave(), &dave_nft, v2, side::no(), wire::rate(), deposit_50(), &clock);
    wire::return_nft(&mut scenario, wire::dave(), dave_nft);
    wire::warp(&mut clock, 400);
    wire::resolve_vault(&mut scenario, wire::steward(), v2, true, &clock);
    wire::collect_vault(&mut scenario, v2, &clock);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let treasury = ts::take_shared<TreasuryRegistry<TEST_USDC>>(&scenario);
        let r2 = treasury::mint_rate(&treasury);
        assert!(r1 < r0, 0);
        assert!(r2 < r1, 1);
        assert!(treasury::total_skimmed(&treasury) > 0, 2);
        ts::return_shared(treasury);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}
