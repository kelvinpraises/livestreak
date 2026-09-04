// SPDX-License-Identifier: MIT

#[test_only]
module livestreak::drips_tests;

use livestreak::driver_transfer_utils;
use livestreak::drips::{Self, DripsRegistry};
use livestreak::i128;
use livestreak::protocol_wire::{Self as wire};
use livestreak::streams::{Self, StreamsRegistry};
use livestreak::test_usdc::TEST_USDC;
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::test_scenario::{Self as ts};

const MIN_RAW: u256 = 100_000_000;
const RATE: u256 = 1_000_000;

fun sender_id(): u256 { 1 }
fun receiver_id(): u256 { 2 }
fun sender_b_id(): u256 { 3 }
fun receiver_b_id(): u256 { 4 }
fun empty_receivers(): vector<streams::StreamReceiver> {
    vector[]
}

fun one_receiver(account_id: u256, rate: u256): vector<streams::StreamReceiver> {
    let amt_mul = streams::amt_per_sec_multiplier();
    vector[streams::new_stream_receiver(account_id, 0, rate * amt_mul, 0, 0)]
}

fun raw_receiver(account_id: u256, raw: u256): vector<streams::StreamReceiver> {
    vector[streams::new_stream_receiver(account_id, 0, raw, 0, 0)]
}

fun open_stream(
    scenario: &mut ts::Scenario,
    sender: u256,
    receiver: u256,
    rate: u256,
    deposit: u64,
    clock: &Clock,
) {
    ts::next_tx(scenario, wire::admin());
    {
        let mut drips = ts::take_shared<DripsRegistry<TEST_USDC>>(scenario);
        let mut streams = ts::take_shared<StreamsRegistry<TEST_USDC>>(scenario);
        let payment = coin::mint_for_testing<TEST_USDC>(deposit, ts::ctx(scenario));
        let ctx = ts::ctx(scenario);
        driver_transfer_utils::set_streams_and_transfer(
            &mut drips,
            &mut streams,
            option::some(payment),
            sender,
            &empty_receivers(),
            i128::from((deposit as u128)),
            &one_receiver(receiver, rate),
            0,
            0,
            wire::admin(),
            clock,
            ctx,
        );
        ts::return_shared(drips);
        ts::return_shared(streams);
    };
}

#[test]
fun test_stream_accrues_over_full_cycles() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    wire::setup_stack(&mut scenario, wire::admin());
    open_stream(&mut scenario, sender_id(), receiver_id(), RATE, (100 * RATE) as u64, &clock);
    wire::warp(&mut clock, wire::start_secs() + 30);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let mut drips = ts::take_shared<DripsRegistry<TEST_USDC>>(&scenario);
        let mut streams = ts::take_shared<StreamsRegistry<TEST_USDC>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        let received = drips::receive_streams(&mut drips, &mut streams, receiver_id(), 0xFFFFFFFF, &clock, ctx);
        assert!(received == (30 * RATE) as u128, 0);
        assert!(drips::collectable(&drips, receiver_id()) == (30 * RATE) as u128, 1);
        ts::return_shared(drips);
        ts::return_shared(streams);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_custody_held_then_transferred_on_collect() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    wire::setup_stack(&mut scenario, wire::admin());
    open_stream(&mut scenario, sender_id(), receiver_id(), RATE, (100 * RATE) as u64, &clock);

    ts::next_tx(&mut scenario, wire::admin());
    let drips_held = {
        let drips = ts::take_shared<DripsRegistry<TEST_USDC>>(&scenario);
        let held = drips::held_balance(&drips);
        ts::return_shared(drips);
        held
    };
    assert!(drips_held == (100 * RATE) as u128, 0);
    let recv_before = wire::usdc_balance_of(&mut scenario, wire::bob());

    wire::warp(&mut clock, wire::start_secs() + 30);
    ts::next_tx(&mut scenario, wire::admin());
    {
        let mut drips = ts::take_shared<DripsRegistry<TEST_USDC>>(&scenario);
        let mut streams = ts::take_shared<StreamsRegistry<TEST_USDC>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        drips::receive_streams(&mut drips, &mut streams, receiver_id(), 0xFFFFFFFF, &clock, ctx);
        ts::return_shared(drips);
        ts::return_shared(streams);
    };

    ts::next_tx(&mut scenario, wire::admin());
    {
        let mut drips = ts::take_shared<DripsRegistry<TEST_USDC>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        let collected = drips::collect(&mut drips, receiver_id(), ctx);
        assert!(collected == (30 * RATE) as u128, 1);
        drips::withdraw(&mut drips, receiver_id(), wire::bob(), collected, ctx);
        ts::return_shared(drips);
    };

    ts::next_tx(&mut scenario, wire::admin());
    {
        let drips = ts::take_shared<DripsRegistry<TEST_USDC>>(&scenario);
        assert!(drips::held_balance(&drips) == drips_held - ((30 * RATE) as u128), 2);
        ts::return_shared(drips);
    };
    assert!(wire::usdc_balance_of(&mut scenario, wire::bob()) == recv_before + ((30 * RATE) as u64), 3);

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_squeeze_force_settles_current_cycle() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    wire::setup_stack(&mut scenario, wire::admin());
    open_stream(&mut scenario, sender_id(), receiver_id(), RATE, (100 * RATE) as u64, &clock);
    wire::warp(&mut clock, wire::start_secs() + 5);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let streams = ts::take_shared<StreamsRegistry<TEST_USDC>>(&scenario);
        assert!(streams::receivable_streams_cycles(&streams, receiver_id(), &clock) == 0, 0);
        ts::return_shared(streams);
    };

    ts::next_tx(&mut scenario, wire::admin());
    {
        let mut drips = ts::take_shared<DripsRegistry<TEST_USDC>>(&scenario);
        let mut streams = ts::take_shared<StreamsRegistry<TEST_USDC>>(&scenario);
        let (_, _, update_time, _, max_end) = streams::streams_state(&streams, sender_id());
        let receivers = one_receiver(receiver_id(), RATE);
        let history = vector[streams::new_streams_history(
            vector[],
            receivers,
            update_time,
            max_end,
        )];
        let ctx = ts::ctx(&mut scenario);
        let squeezed = drips::squeeze_streams(
            &mut drips,
            &mut streams,
            receiver_id(),
            sender_id(),
            vector[],
            &history,
            &clock,
            ctx,
        );
        assert!(squeezed == (5 * RATE) as u128, 1);
        assert!(drips::collectable(&drips, receiver_id()) == (5 * RATE) as u128, 2);
        ts::return_shared(drips);
        ts::return_shared(streams);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_stop_halts_further_accrual() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    wire::setup_stack(&mut scenario, wire::admin());
    open_stream(&mut scenario, sender_id(), receiver_id(), RATE, (100 * RATE) as u64, &clock);
    wire::warp(&mut clock, wire::start_secs() + 20);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let mut drips = ts::take_shared<DripsRegistry<TEST_USDC>>(&scenario);
        let mut streams = ts::take_shared<StreamsRegistry<TEST_USDC>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        let mut payment = option::none<Coin<TEST_USDC>>();
        driver_transfer_utils::set_streams_and_transfer(
            &mut drips,
            &mut streams,
            payment,
            sender_id(),
            &one_receiver(receiver_id(), RATE),
            i128::zero(),
            &empty_receivers(),
            0,
            0,
            wire::admin(),
            &clock,
            ctx,
        );
        ts::return_shared(drips);
        ts::return_shared(streams);
    };

    wire::warp(&mut clock, 200);
    ts::next_tx(&mut scenario, wire::admin());
    {
        let mut drips = ts::take_shared<DripsRegistry<TEST_USDC>>(&scenario);
        let mut streams = ts::take_shared<StreamsRegistry<TEST_USDC>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        let first = drips::receive_streams(&mut drips, &mut streams, receiver_id(), 0xFFFFFFFF, &clock, ctx);
        assert!(first == (20 * RATE) as u128, 0);
        let second = drips::receive_streams(&mut drips, &mut streams, receiver_id(), 0xFFFFFFFF, &clock, ctx);
        assert!(second == 0, 1);
        ts::return_shared(drips);
        ts::return_shared(streams);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_independent_accrual_two_senders_two_receivers() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    wire::setup_stack(&mut scenario, wire::admin());
    open_stream(&mut scenario, sender_id(), receiver_id(), RATE, (100 * RATE) as u64, &clock);
    open_stream(&mut scenario, sender_b_id(), receiver_b_id(), 2 * RATE, (200 * RATE) as u64, &clock);
    wire::warp(&mut clock, wire::start_secs() + 30);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let mut drips = ts::take_shared<DripsRegistry<TEST_USDC>>(&scenario);
        let mut streams = ts::take_shared<StreamsRegistry<TEST_USDC>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        let received_a = drips::receive_streams(&mut drips, &mut streams, receiver_id(), 0xFFFFFFFF, &clock, ctx);
        let received_b = drips::receive_streams(&mut drips, &mut streams, receiver_b_id(), 0xFFFFFFFF, &clock, ctx);
        assert!(received_a == (30 * RATE) as u128, 0);
        assert!(received_b == (60 * RATE) as u128, 1);
        ts::return_shared(drips);
        ts::return_shared(streams);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 3)]
fun test_revert_set_streams_below_min_amt_per_sec() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    wire::setup_stack(&mut scenario, wire::admin());
    ts::next_tx(&mut scenario, wire::admin());
    {
        let mut drips = ts::take_shared<DripsRegistry<TEST_USDC>>(&scenario);
        let mut streams = ts::take_shared<StreamsRegistry<TEST_USDC>>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        drips::set_streams(
            &mut drips,
            &mut streams,
            sender_id(),
            &empty_receivers(),
            i128::zero(),
            &raw_receiver(receiver_id(), MIN_RAW - 1),
            0,
            0,
            &clock,
            ctx,
        );
        ts::return_shared(drips);
        ts::return_shared(streams);
    };
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test, expected_failure(abort_code = 1)]
fun test_revert_set_streams_above_max_total_balance() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    wire::setup_stack(&mut scenario, wire::admin());
    ts::next_tx(&mut scenario, wire::admin());
    {
        let drips = ts::take_shared<DripsRegistry<TEST_USDC>>(&scenario);
        drips::verify_balance_increase(&drips, 0x80000000000000000000000000000000);
        ts::return_shared(drips);
    };
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test]
fun test_cycle_constants_match_evm() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    wire::setup_stack(&mut scenario, wire::admin());
    ts::next_tx(&mut scenario, wire::admin());
    {
        let streams = ts::take_shared<StreamsRegistry<TEST_USDC>>(&scenario);
        assert!(streams::get_cycle_secs(&streams) == wire::cycle_secs(), 0);
        assert!(streams::get_min_amt_per_sec(&streams) == MIN_RAW, 1);
        assert!(streams::amt_per_sec_multiplier() == 1_000_000_000, 2);
        ts::return_shared(streams);
    };
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}
