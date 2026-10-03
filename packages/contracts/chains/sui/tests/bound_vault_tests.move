#[test_only]
module livestreak::bound_vault_tests;

use livestreak::protocol_wire::{Self as wire};
use livestreak::vault::{Self, VaultRegistry};
use livestreak::vault_driver::{Self, VaultDriverRegistry};
use livestreak::test_usdc::TEST_USDC;
use livestreak::side;
use sui::clock::{Self, Clock};
use sui::test_scenario::{Self as ts, Scenario};

fun op(n: u8): vector<u8> { let mut bytes = vector[]; let mut i = 0; while (i < 32) { bytes.push_back(n); i = i + 1; }; bytes }
fun setup(scenario: &mut Scenario, clock: &Clock): vector<u8> {
    wire::setup_stack(scenario, wire::admin());
    wire::register_market(scenario, wire::admin(), b"generic", b"stream", clock)
}
fun create(scenario: &mut Scenario, market: vector<u8>, close: u64, operation: u8, clock: &Clock): vector<u8> {
    wire::create_bound_vault(scenario, wire::seed_creator(), market, b"generic question?", side::yes(), 10, 10000, clock, op(1), close, op(operation))
}

#[test]
fun retry_after_close_returns_original_and_never_seeds_twice() {
    let mut s = ts::begin(wire::admin());
    let mut clock = clock::create_for_testing(ts::ctx(&mut s));
    clock::set_for_testing(&mut clock, 100000);
    let market = setup(&mut s, &clock);
    let id = create(&mut s, market, 120, 1, &clock);
    clock::set_for_testing(&mut clock, 150000);
    let retry = create(&mut s, market, 120, 1, &clock);
    assert!(retry == id, 0);
    ts::next_tx(&mut s, wire::admin());
    let registry = ts::take_shared<VaultDriverRegistry>(&s);
    let (found, m, q, side, rate, deposit, commitment, close) = vault_driver::creation(&registry, wire::seed_creator(), op(1));
    assert!(found == id && m == market && q == b"generic question?" && side == side::yes() && rate == 10 && deposit == 10000 && commitment == op(1) && close == 120, 1);
    ts::return_shared(registry);
    wire::advance_both(&mut s, wire::admin(), id, &clock);
    wire::harvest_side(&mut s, id, side::yes(), &clock);
    ts::next_tx(&mut s, wire::admin());
    let vault = ts::take_shared<VaultRegistry<TEST_USDC>>(&s);
    let (pool, rate, _, _) = vault::get_board(&vault, &id, side::yes());
    assert!(pool == 200 && rate == 0 && vault::usdc_balance(&vault) == 200, 2);
    ts::return_shared(vault);
    wire::stop_seed(&mut s, wire::seed_creator(), id, &clock);
    clock::destroy_for_testing(clock); ts::end(s);
}

#[test]
#[expected_failure(abort_code = 92, location = livestreak::vault_driver)]
fun operation_conflict_rejects_changed_seed() {
    let mut s = ts::begin(wire::admin()); let mut clock = clock::create_for_testing(ts::ctx(&mut s));
    clock::set_for_testing(&mut clock, 100000); let market = setup(&mut s, &clock);
    create(&mut s, market, 120, 1, &clock);
    wire::create_bound_vault(&mut s, wire::seed_creator(), market, b"generic question?", side::yes(), 11, 10000, &clock, op(1), 120, op(1));
    clock::destroy_for_testing(clock); ts::end(s);
}

#[test]
#[expected_failure(abort_code = 91, location = livestreak::vault)]
fun exactly_at_close_blocks_creation() {
    let mut s = ts::begin(wire::admin()); let mut clock = clock::create_for_testing(ts::ctx(&mut s));
    clock::set_for_testing(&mut clock, 100000); let market = setup(&mut s, &clock);
    create(&mut s, market, 100, 1, &clock);
    clock::destroy_for_testing(clock); ts::end(s);
}

#[test]
#[expected_failure(abort_code = 90, location = livestreak::vault_driver)]
fun zero_commitment_rejected() {
    let mut s = ts::begin(wire::admin()); let mut clock = clock::create_for_testing(ts::ctx(&mut s));
    clock::set_for_testing(&mut clock, 100000); let market = setup(&mut s, &clock);
    wire::create_bound_vault(&mut s, wire::seed_creator(), market, b"Q", side::yes(), 10, 10000, &clock, op(0), 120, op(1));
    clock::destroy_for_testing(clock); ts::end(s);
}

#[test]
fun mixed_deadlines_cap_actual_delivery_and_keep_cleanup_available() {
    let mut s = ts::begin(wire::admin()); let mut clock = clock::create_for_testing(ts::ctx(&mut s));
    clock::set_for_testing(&mut clock, 100000); let market = setup(&mut s, &clock);
    let a = create(&mut s, market, 120, 1, &clock); let b = create(&mut s, market, 140, 2, &clock);
    let token = wire::mint_nft(&mut s, wire::alice(), market);
    let nft = wire::take_nft(&mut s, wire::alice());
    wire::fund(&mut s, wire::alice(), &nft, a, side::no(), 10, 10000, &clock);
    wire::fund(&mut s, wire::alice(), &nft, b, side::no(), 10, 10000, &clock);
    wire::return_nft(&mut s, wire::alice(), nft);
    clock::set_for_testing(&mut clock, 160000);
    wire::advance_both(&mut s, wire::admin(), a, &clock); wire::advance_both(&mut s, wire::admin(), b, &clock);
    wire::harvest_side(&mut s, a, side::no(), &clock); wire::harvest_side(&mut s, b, side::no(), &clock);
    ts::next_tx(&mut s, wire::admin());
    let vault = ts::take_shared<VaultRegistry<TEST_USDC>>(&s);
    let (pool_a, _, _, _) = vault::get_board(&vault, &a, side::no());
    let (pool_b, _, _, _) = vault::get_board(&vault, &b, side::no());
    assert!(pool_a == 200 && pool_b == 400 && vault::usdc_balance(&vault) == 600, 0);
    let ids = vault::get_account_vault_ids(&vault, token); assert!(ids.length() == 2, 1);
    ts::return_shared(vault);
    let refunded = wire::stop_all_refund(&mut s, wire::alice(), &clock); assert!(refunded == 19400, 2);
    ts::next_tx(&mut s, wire::admin());
    let vault = ts::take_shared<VaultRegistry<TEST_USDC>>(&s);
    assert!(vault::get_account_vault_ids(&vault, token).length() == 2, 3);
    ts::return_shared(vault);
    clock::destroy_for_testing(clock); ts::end(s);
}

#[test]
#[expected_failure(abort_code = 91, location = livestreak::vault)]
fun exactly_at_close_blocks_new_viewer_funding() {
    let mut s = ts::begin(wire::admin()); let mut clock = clock::create_for_testing(ts::ctx(&mut s));
    clock::set_for_testing(&mut clock, 100000); let market = setup(&mut s, &clock);
    let id = create(&mut s, market, 120, 1, &clock); wire::mint_nft(&mut s, wire::alice(), market);
    clock::set_for_testing(&mut clock, 120000); let nft = wire::take_nft(&mut s, wire::alice());
    wire::fund(&mut s, wire::alice(), &nft, id, side::no(), 10, 10000, &clock);
    wire::return_nft(&mut s, wire::alice(), nft); clock::destroy_for_testing(clock); ts::end(s);
}
