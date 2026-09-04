// SPDX-License-Identifier: MIT

#[test_only]
module livestreak::stream_lifecycle_tests;

use livestreak::market_registry::{Self, MarketRegistry};
use livestreak::protocol_wire::{Self as wire};
use sui::clock::{Self, Clock};
use sui::test_scenario::{Self as ts};

const CREATOR: address = @0xC0DE;
const STRANGER: address = @0xBEEF;

const SCHEME_LIVE: u8 = 0;
const SCHEME_ARWEAVE: u8 = 3;
const SCHEME_IPFS: u8 = 2;

fun live_id(): vector<u8> {
    b"Ci3uNXqA0ent7gRMjWSY7XfzDYl8GWFBtErU2gzZR3M"
}

fun vod_id(): vector<u8> {
    b"bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
}

fun vod_revise_id(): vector<u8> {
    b"QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"
}

fun too_long_id(): vector<u8> {
    let mut v = vector[];
    let mut i = 0u64;
    while (i < 65) {
        vector::push_back(&mut v, 0x61);
        i = i + 1;
    };
    v
}

fun setup_market(scenario: &mut ts::Scenario, clock: &Clock): vector<u8> {
    ts::next_tx(scenario, CREATOR);
    {
        market_registry::create_registry(ts::ctx(scenario));
    };
    ts::next_tx(scenario, CREATOR);
    let mut reg = ts::take_shared<MarketRegistry>(scenario);
    let ctx = ts::ctx(scenario);
    let market_id = market_registry::register_market(
        &mut reg,
        b"Stream market",
        b"stream-lifecycle",
        clock,
        ctx,
    );
    ts::return_shared(reg);
    market_id
}

#[test]
fun test_go_live_sets_live() {
    let mut scenario = ts::begin(CREATOR);
    let mut clock = wire::new_clock(&mut scenario, CREATOR, 100);
    let market_id = setup_market(&mut scenario, &clock);
    let live = live_id();

    ts::next_tx(&mut scenario, CREATOR);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        market_registry::go_live(&mut reg, market_id, SCHEME_LIVE, live, &clock, ctx);
        let s = market_registry::stream_state(&reg, &market_id);
        assert!(market_registry::stream_status(&s) == market_registry::status_live(), 0);
        assert!(market_registry::stream_scheme(&s) == SCHEME_LIVE, 1);
        assert!(market_registry::stream_content_id(&s) == &live, 2);
        assert!(market_registry::stream_updated_at(&s) == 100, 3);
        assert!(market_registry::stream_ended_at(&s) == 0, 4);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 5)]
fun test_go_live_non_creator_reverts() {
    let mut scenario = ts::begin(CREATOR);
    let clock = wire::new_clock(&mut scenario, CREATOR, 100);
    let market_id = setup_market(&mut scenario, &clock);

    ts::next_tx(&mut scenario, STRANGER);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        market_registry::go_live(&mut reg, market_id, SCHEME_LIVE, live_id(), &clock, ctx);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 4)]
fun test_go_live_unknown_market_reverts() {
    let mut scenario = ts::begin(CREATOR);
    let clock = wire::new_clock(&mut scenario, CREATOR, 100);
    setup_market(&mut scenario, &clock);

    ts::next_tx(&mut scenario, CREATOR);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        market_registry::go_live(&mut reg, b"unknown-market-id", SCHEME_LIVE, live_id(), &clock, ctx);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 6)]
fun test_go_live_empty_id_reverts() {
    let mut scenario = ts::begin(CREATOR);
    let clock = wire::new_clock(&mut scenario, CREATOR, 100);
    let market_id = setup_market(&mut scenario, &clock);

    ts::next_tx(&mut scenario, CREATOR);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        market_registry::go_live(&mut reg, market_id, SCHEME_LIVE, vector[], &clock, ctx);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 6)]
fun test_go_live_too_long_id_reverts() {
    let mut scenario = ts::begin(CREATOR);
    let clock = wire::new_clock(&mut scenario, CREATOR, 100);
    let market_id = setup_market(&mut scenario, &clock);

    ts::next_tx(&mut scenario, CREATOR);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        market_registry::go_live(&mut reg, market_id, SCHEME_LIVE, too_long_id(), &clock, ctx);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_go_live_while_live_repoints() {
    let mut scenario = ts::begin(CREATOR);
    let clock = wire::new_clock(&mut scenario, CREATOR, 100);
    let market_id = setup_market(&mut scenario, &clock);
    let repointed = b"arweave-repoint-txid-0001";

    ts::next_tx(&mut scenario, CREATOR);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        market_registry::go_live(&mut reg, market_id, SCHEME_LIVE, live_id(), &clock, ctx);
        market_registry::go_live(&mut reg, market_id, SCHEME_ARWEAVE, repointed, &clock, ctx);
        let s = market_registry::stream_state(&reg, &market_id);
        assert!(market_registry::stream_status(&s) == market_registry::status_live(), 0);
        assert!(market_registry::stream_scheme(&s) == SCHEME_ARWEAVE, 1);
        assert!(market_registry::stream_content_id(&s) == repointed, 2);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_set_ended_from_live_sets_ended() {
    let mut scenario = ts::begin(CREATOR);
    let mut clock = wire::new_clock(&mut scenario, CREATOR, 100);
    let market_id = setup_market(&mut scenario, &clock);
    let vod = vod_id();

    ts::next_tx(&mut scenario, CREATOR);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        market_registry::go_live(&mut reg, market_id, SCHEME_LIVE, live_id(), &clock, ctx);
        wire::warp(&mut clock, 200);
        market_registry::set_ended(&mut reg, market_id, SCHEME_LIVE, vod, &clock, ctx);
        let s = market_registry::stream_state(&reg, &market_id);
        assert!(market_registry::stream_status(&s) == market_registry::status_ended(), 0);
        assert!(market_registry::stream_content_id(&s) == vod, 1);
        assert!(market_registry::stream_ended_at(&s) == 200, 2);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 8)]
fun test_set_ended_from_none_reverts() {
    let mut scenario = ts::begin(CREATOR);
    let clock = wire::new_clock(&mut scenario, CREATOR, 100);
    let market_id = setup_market(&mut scenario, &clock);

    ts::next_tx(&mut scenario, CREATOR);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        market_registry::set_ended(&mut reg, market_id, SCHEME_LIVE, vod_id(), &clock, ctx);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_set_ended_revise_within_grace_keeps_ended_at() {
    let mut scenario = ts::begin(CREATOR);
    let t0 = 1_700_000_000;
    let mut clock = wire::new_clock(&mut scenario, CREATOR, t0);
    let market_id = setup_market(&mut scenario, &clock);

    ts::next_tx(&mut scenario, CREATOR);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        market_registry::go_live(&mut reg, market_id, SCHEME_LIVE, live_id(), &clock, ctx);
        market_registry::set_ended(&mut reg, market_id, SCHEME_LIVE, vod_id(), &clock, ctx);
        wire::warp(&mut clock, t0 + 12 * 3600);
        market_registry::set_ended(&mut reg, market_id, SCHEME_ARWEAVE, vod_revise_id(), &clock, ctx);
        let s = market_registry::stream_state(&reg, &market_id);
        assert!(market_registry::stream_ended_at(&s) == t0, 0);
        assert!(market_registry::stream_scheme(&s) == SCHEME_ARWEAVE, 1);
        assert!(!market_registry::is_locked(&reg, &market_id, &clock), 2);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 9)]
fun test_set_ended_after_lock_reverts() {
    let mut scenario = ts::begin(CREATOR);
    let t0 = 1_700_000_000;
    let mut clock = wire::new_clock(&mut scenario, CREATOR, t0);
    let market_id = setup_market(&mut scenario, &clock);

    ts::next_tx(&mut scenario, CREATOR);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        market_registry::go_live(&mut reg, market_id, SCHEME_LIVE, live_id(), &clock, ctx);
        market_registry::set_ended(&mut reg, market_id, SCHEME_LIVE, vod_id(), &clock, ctx);
        wire::warp(&mut clock, t0 + 25 * 3600);
        market_registry::set_ended(&mut reg, market_id, SCHEME_ARWEAVE, vod_revise_id(), &clock, ctx);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_is_locked_boundary() {
    let mut scenario = ts::begin(CREATOR);
    let t0 = 1_700_000_000;
    let mut clock = wire::new_clock(&mut scenario, CREATOR, t0);
    let market_id = setup_market(&mut scenario, &clock);

    ts::next_tx(&mut scenario, CREATOR);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        market_registry::go_live(&mut reg, market_id, SCHEME_LIVE, live_id(), &clock, ctx);
        market_registry::set_ended(&mut reg, market_id, SCHEME_LIVE, vod_id(), &clock, ctx);
        ts::return_shared(reg);
    };

    wire::warp(&mut clock, t0 + 86_400);
    ts::next_tx(&mut scenario, CREATOR);
    {
        let reg = ts::take_shared<MarketRegistry>(&scenario);
        assert!(!market_registry::is_locked(&reg, &market_id, &clock), 0);
        ts::return_shared(reg);
    };

    wire::warp(&mut clock, t0 + 86_401);
    ts::next_tx(&mut scenario, CREATOR);
    {
        let reg = ts::take_shared<MarketRegistry>(&scenario);
        assert!(market_registry::is_locked(&reg, &market_id, &clock), 1);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 7)]
fun test_go_live_after_ended_reverts() {
    let mut scenario = ts::begin(CREATOR);
    let clock = wire::new_clock(&mut scenario, CREATOR, 100);
    let market_id = setup_market(&mut scenario, &clock);

    ts::next_tx(&mut scenario, CREATOR);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        market_registry::go_live(&mut reg, market_id, SCHEME_LIVE, live_id(), &clock, ctx);
        market_registry::set_ended(&mut reg, market_id, SCHEME_LIVE, vod_id(), &clock, ctx);
        market_registry::go_live(&mut reg, market_id, SCHEME_LIVE, live_id(), &clock, ctx);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_golden_lifecycle() {
    let mut scenario = ts::begin(CREATOR);
    let t0 = 1_700_000_000;
    let mut clock = wire::new_clock(&mut scenario, CREATOR, t0);
    let market_id = setup_market(&mut scenario, &clock);

    ts::next_tx(&mut scenario, CREATOR);
    {
        let reg = ts::take_shared<MarketRegistry>(&scenario);
        assert!(market_registry::stream_status(&market_registry::stream_state(&reg, &market_id))
            == market_registry::status_none(), 0);
        ts::return_shared(reg);
    };

    ts::next_tx(&mut scenario, CREATOR);
    {
        let mut reg = ts::take_shared<MarketRegistry>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        market_registry::go_live(&mut reg, market_id, SCHEME_LIVE, live_id(), &clock, ctx);
        assert!(market_registry::stream_status(&market_registry::stream_state(&reg, &market_id))
            == market_registry::status_live(), 1);
        market_registry::set_ended(&mut reg, market_id, SCHEME_LIVE, vod_id(), &clock, ctx);
        assert!(market_registry::stream_ended_at(&market_registry::stream_state(&reg, &market_id)) == t0, 2);
        wire::warp(&mut clock, t0 + 12 * 3600);
        market_registry::set_ended(&mut reg, market_id, SCHEME_ARWEAVE, vod_revise_id(), &clock, ctx);
        let s = market_registry::stream_state(&reg, &market_id);
        assert!(market_registry::stream_ended_at(&s) == t0, 3);
        assert!(market_registry::stream_scheme(&s) == SCHEME_ARWEAVE, 4);
        ts::return_shared(reg);
    };

    wire::warp(&mut clock, t0 + 86_400 + 3600);
    ts::next_tx(&mut scenario, CREATOR);
    {
        let reg = ts::take_shared<MarketRegistry>(&scenario);
        assert!(market_registry::is_locked(&reg, &market_id, &clock), 5);
        ts::return_shared(reg);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}
