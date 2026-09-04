// SPDX-License-Identifier: MIT

#[test_only]
module livestreak::market_identity_tests;

use livestreak::market_registry::{Self, MarketRegistry};
use sui::clock::{Self, Clock};
use sui::test_scenario::{Self as ts};

const GOLDEN_OBSERVER: address = @0xCA;
const OBSERVER: address = @0xA11CE;
const ATTACKER: address = @0xBEEF;

const E_MARKET_EXISTS: u64 = 3;
const E_EMPTY_TITLE: u64 = 1;
const E_ZERO_STREAM_ID: u64 = 2;

fun golden_stream_id(): vector<u8> {
    let mut v = vector[];
    let mut i = 0u64;
    while (i < 31) {
        vector::push_back(&mut v, 0);
        i = i + 1;
    };
    vector::push_back(&mut v, 0x42);
    v
}

fun golden_market_id(): vector<u8> {
    x"a9a8e72f956e612f800b6d705a3d5d085e655010f8c6ebec48299831c7677181"
}

fun setup_market_registry(scenario: &mut ts::Scenario, deployer: address) {
    ts::next_tx(scenario, deployer);
    {
        market_registry::create_registry(ts::ctx(scenario));
    };
}

fun test_clock(scenario: &mut ts::Scenario, sender: address): Clock {
    ts::next_tx(scenario, sender);
    clock::create_for_testing(ts::ctx(scenario))
}

#[test]
fun test_golden_vector_compute_market_id() {
    let stream_id = golden_stream_id();
    let market_id = market_registry::compute_market_id(GOLDEN_OBSERVER, &stream_id);
    assert!(market_id == golden_market_id(), 0);
}

#[test]
fun test_golden_vector_register_market() {
    let mut scenario = ts::begin(GOLDEN_OBSERVER);
    setup_market_registry(&mut scenario, GOLDEN_OBSERVER);
    let clock = test_clock(&mut scenario, GOLDEN_OBSERVER);

    ts::next_tx(&mut scenario, GOLDEN_OBSERVER);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        let stream_id = golden_stream_id();
        let market_id = market_registry::register_market(
            &mut reg,
            b"Golden title",
            stream_id,
            &clock,
            ctx,
        );
        assert!(market_id == golden_market_id(), 0);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_register_market_returns_compute_market_id() {
    let mut scenario = ts::begin(OBSERVER);
    setup_market_registry(&mut scenario, OBSERVER);
    let clock = test_clock(&mut scenario, OBSERVER);

    ts::next_tx(&mut scenario, OBSERVER);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        let stream_id = b"stream-alpha";
        let market_id = market_registry::register_market(
            &mut reg,
            b"Derby stream",
            stream_id,
            &clock,
            ctx,
        );
        assert!(market_id == market_registry::compute_market_id(OBSERVER, &stream_id), 0);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_stored_market_data_matches_registration() {
    let mut scenario = ts::begin(OBSERVER);
    setup_market_registry(&mut scenario, OBSERVER);
    let mut clock = test_clock(&mut scenario, OBSERVER);
    clock::set_for_testing(&mut clock, 1_700_000_000_000);

    ts::next_tx(&mut scenario, OBSERVER);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        let stream_id = b"stream-beta";
        let title = b"Stored title";
        let market_id = market_registry::register_market(
            &mut reg,
            title,
            stream_id,
            &clock,
            ctx,
        );
        let data = market_registry::get_market(&reg, &market_id);
        assert!(market_registry::market_data_id(&data) == &market_id, 0);
        assert!(market_registry::market_title(&data) == title, 1);
        assert!(market_registry::market_stream_id(&data) == stream_id, 2);
        assert!(market_registry::market_creator(&data) == OBSERVER, 3);
        assert!(market_registry::market_created_at(&data) > 0, 4);
        assert!(market_registry::market_data_exists(&data), 5);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 3)]
fun test_same_caller_same_stream_id_second_registration_reverts() {
    let mut scenario = ts::begin(OBSERVER);
    setup_market_registry(&mut scenario, OBSERVER);
    let clock = test_clock(&mut scenario, OBSERVER);

    ts::next_tx(&mut scenario, OBSERVER);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        let stream_id = b"stream-dup";
        market_registry::register_market(&mut reg, b"First", stream_id, &clock, ctx);
        market_registry::register_market(&mut reg, b"Second", stream_id, &clock, ctx);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_same_caller_different_stream_ids_both_stored() {
    let mut scenario = ts::begin(OBSERVER);
    setup_market_registry(&mut scenario, OBSERVER);
    let clock = test_clock(&mut scenario, OBSERVER);

    ts::next_tx(&mut scenario, OBSERVER);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        let stream_a = b"stream-a";
        let stream_b = b"stream-b";
        let market_a = market_registry::register_market(&mut reg, b"Title A", stream_a, &clock, ctx);
        let market_b = market_registry::register_market(&mut reg, b"Title B", stream_b, &clock, ctx);
        assert!(market_a != market_b, 0);
        assert!(market_registry::market_exists(&reg, &market_a), 1);
        assert!(market_registry::market_exists(&reg, &market_b), 2);
        assert!(market_registry::market_stream_id(&market_registry::get_market(&reg, &market_a)) == stream_a, 3);
        assert!(market_registry::market_stream_id(&market_registry::get_market(&reg, &market_b)) == stream_b, 4);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_different_callers_same_stream_id_both_succeed_distinct_keys() {
    let mut scenario = ts::begin(ATTACKER);
    setup_market_registry(&mut scenario, ATTACKER);
    let clock = test_clock(&mut scenario, ATTACKER);
    let stream_id = b"shared-stream";

    ts::next_tx(&mut scenario, ATTACKER);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        market_registry::register_market(&mut reg, b"Attacker title", stream_id, &clock, ctx);
        ts::return_shared(reg);
    };

    ts::next_tx(&mut scenario, OBSERVER);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        let attacker_market = market_registry::compute_market_id(ATTACKER, &stream_id);
        let observer_market = market_registry::register_market(
            &mut reg,
            b"Observer title",
            stream_id,
            &clock,
            ctx,
        );
        assert!(attacker_market != observer_market, 0);
        assert!(attacker_market == market_registry::compute_market_id(ATTACKER, &stream_id), 1);
        assert!(observer_market == market_registry::compute_market_id(OBSERVER, &stream_id), 2);
        assert!(market_registry::market_creator(&market_registry::get_market(&reg, &attacker_market)) == ATTACKER, 3);
        assert!(market_registry::market_creator(&market_registry::get_market(&reg, &observer_market)) == OBSERVER, 4);
        assert!(market_registry::market_title(&market_registry::get_market(&reg, &observer_market)) == b"Observer title", 5);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_front_run_observer_cannot_block_or_alter_observer_market() {
    let mut scenario = ts::begin(ATTACKER);
    setup_market_registry(&mut scenario, ATTACKER);
    let clock = test_clock(&mut scenario, ATTACKER);

    ts::next_tx(&mut scenario, ATTACKER);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        let stream_id = b"front-run-stream";
        let attacker_market = market_registry::register_market(
            &mut reg,
            b"Squatter title",
            stream_id,
            &clock,
            ctx,
        );
        assert!(market_registry::market_creator(&market_registry::get_market(&reg, &attacker_market)) == ATTACKER, 0);
        ts::return_shared(reg);
    };

    ts::next_tx(&mut scenario, OBSERVER);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        let stream_id = b"front-run-stream";
        let observer_title = b"Legitimate observer market";
        let observer_market = market_registry::register_market(
            &mut reg,
            observer_title,
            stream_id,
            &clock,
            ctx,
        );
        let attacker_market = market_registry::compute_market_id(ATTACKER, &stream_id);
        assert!(observer_market == market_registry::compute_market_id(OBSERVER, &stream_id), 1);
        assert!(observer_market != attacker_market, 2);
        assert!(market_registry::market_creator(&market_registry::get_market(&reg, &observer_market)) == OBSERVER, 3);
        assert!(market_registry::market_title(&market_registry::get_market(&reg, &observer_market)) == observer_title, 4);
        assert!(market_registry::market_title(&market_registry::get_market(&reg, &attacker_market)) == b"Squatter title", 5);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_caller_cannot_write_another_observers_market_key() {
    let mut scenario = ts::begin(ATTACKER);
    setup_market_registry(&mut scenario, ATTACKER);
    let clock = test_clock(&mut scenario, ATTACKER);

    ts::next_tx(&mut scenario, ATTACKER);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        let stream_id = b"unspoofable-stream";
        let observer_key = market_registry::compute_market_id(OBSERVER, &stream_id);
        let attacker_key = market_registry::register_market(
            &mut reg,
            b"Attacker only",
            stream_id,
            &clock,
            ctx,
        );
        assert!(attacker_key == market_registry::compute_market_id(ATTACKER, &stream_id), 0);
        assert!(attacker_key != observer_key, 1);
        assert!(!market_registry::market_exists(&reg, &observer_key), 2);
        ts::return_shared(reg);
    };

    ts::next_tx(&mut scenario, OBSERVER);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        let stream_id = b"unspoofable-stream";
        let observer_key = market_registry::compute_market_id(OBSERVER, &stream_id);
        let created = market_registry::register_market(
            &mut reg,
            b"Observer owns key",
            stream_id,
            &clock,
            ctx,
        );
        assert!(created == observer_key, 0);
        assert!(market_registry::market_creator(&market_registry::get_market(&reg, &observer_key)) == OBSERVER, 1);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 1)]
fun test_empty_title_reverts() {
    let mut scenario = ts::begin(OBSERVER);
    setup_market_registry(&mut scenario, OBSERVER);
    let clock = test_clock(&mut scenario, OBSERVER);

    ts::next_tx(&mut scenario, OBSERVER);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        market_registry::register_market(&mut reg, b"", b"stream", &clock, ctx);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 2)]
fun test_zero_stream_id_reverts() {
    let mut scenario = ts::begin(OBSERVER);
    setup_market_registry(&mut scenario, OBSERVER);
    let clock = test_clock(&mut scenario, OBSERVER);

    ts::next_tx(&mut scenario, OBSERVER);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        market_registry::register_market(&mut reg, b"Title", vector[], &clock, ctx);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_market_count_and_market_id_at() {
    let mut scenario = ts::begin(OBSERVER);
    setup_market_registry(&mut scenario, OBSERVER);
    let clock = test_clock(&mut scenario, OBSERVER);

    ts::next_tx(&mut scenario, OBSERVER);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        assert!(market_registry::market_count(&reg) == 0, 0);
        let market_a = market_registry::register_market(&mut reg, b"A", b"sa", &clock, ctx);
        let market_b = market_registry::register_market(&mut reg, b"B", b"sb", &clock, ctx);
        assert!(market_registry::market_count(&reg) == 2, 1);
        assert!(market_registry::market_id_at(&reg, 0) == market_a, 2);
        assert!(market_registry::market_id_at(&reg, 1) == market_b, 3);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}
