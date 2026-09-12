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

// Regression for the live stranding bug (parity with EVM
// `test_topUpAfterDryWhileBoardBehind_doesNotStrand`). A top-up that lands AFTER a lane ran dry while
// the Board was merely BEHIND (idle chain: nothing pokes advance once max_end passes, so `depleted`
// still reads false on-chain) must re-fund the lane, or the top-up's Drips delivery is booked nowhere
// and strands in the Vault at resolution. Sequence: fund → dry-without-advancing → set_lanes top-up →
// resolve YES → collect. Pre-fix this left ~`d2` permanently unclaimable in the Vault.
#[test]
fun test_topup_after_dry_while_board_behind_does_not_strand() {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    let (vault_id, _alice_token, _bob_token) = setup_conservation_fixture(&mut scenario, &clock);

    let d1 = ((wire::rate() * 4) as u64); // 4s runway -> Alice's lane dries at start+4
    let d2 = ((wire::rate() * 4) as u64); // the top-up that pre-fix stranded
    let total_deposits = (wire::creator_seed_deposit() as u256) + (d1 as u256) + (d2 as u256);

    // Alice funds YES; her lane runs dry at start+4.
    let alice_nft = wire::take_nft(&mut scenario, wire::alice());
    wire::fund(&mut scenario, wire::alice(), &alice_nft, vault_id, side::yes(), wire::rate(), d1, &clock);
    wire::return_nft(&mut scenario, wire::alice(), alice_nft);

    // Idle PAST her max_end WITHOUT poking advance — the Board stays behind, so `depleted` reads
    // false on-chain even though the deposit is already spent. This is the exact trigger.
    wire::warp(&mut clock, wire::start_secs() + 6);

    // Declarative top-up. Pre-fix: diffs to a no-op (depleted==false), skips on_fund, and
    // refresh_max_ends no-ops on the now-depleting lane -> d2's delivery is booked nowhere.
    wire::set_lanes(
        &mut scenario,
        wire::alice(),
        vector[vault_id],
        vector[side::yes()],
        vector[wire::rate()],
        d2,
        &clock,
    );

    // Idle past the new max_end (start+10) and the seed max_end (start+10), then resolve YES.
    wire::warp(&mut clock, wire::start_secs() + 13);
    wire::resolve_vault(&mut scenario, wire::steward(), vault_id, true, &clock);

    // Settle: full collect + cycle-complete harvest, then winners (Alice + seed creator) pull.
    wire::collect_vault(&mut scenario, vault_id, &clock);
    wire::warp(&mut clock, wire::start_secs() + 13 + wire::cycle_secs() * 2);
    wire::collect_vault(&mut scenario, vault_id, &clock);
    wire::harvest_both_sides(&mut scenario, vault_id, &clock);
    wire::collect_vault(&mut scenario, vault_id, &clock);

    let mut withdrawn = 0u256;
    withdrawn = withdrawn + (wire::withdraw_market(&mut scenario, wire::alice(), vault_id, &clock) as u256);
    withdrawn = withdrawn + (wire::withdraw_seed(&mut scenario, wire::seed_creator(), vault_id, &clock) as u256);

    // Drain the cycle tail and re-pull.
    wire::harvest_both_sides(&mut scenario, vault_id, &clock);
    wire::collect_vault(&mut scenario, vault_id, &clock);
    withdrawn = withdrawn + (wire::withdraw_market(&mut scenario, wire::alice(), vault_id, &clock) as u256);
    withdrawn = withdrawn + (wire::withdraw_seed(&mut scenario, wire::seed_creator(), vault_id, &clock) as u256);

    ts::next_tx(&mut scenario, wire::admin());
    {
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(&scenario);
        let drips = ts::take_shared<DripsRegistry<TEST_USDC>>(&scenario);
        let dust = (vault::usdc_balance(&vault_registry) as u256) + (drips::held_balance(&drips) as u256);
        // Nothing strands (pre-fix this was ~d2), AND the delivered top-up reached the winners.
        assert!(dust <= DUST_TOLERANCE, 0);
        assert!(withdrawn + DUST_TOLERANCE >= total_deposits, 1);
        assert!(withdrawn + dust == total_deposits, 2);
        ts::return_shared(vault_registry);
        ts::return_shared(drips);
    };

    clock::destroy_for_testing(clock);
    ts::end(scenario);
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


// Move has no native fuzzer (this is why Sui's assurance here is lower than EVM's Foundry fuzz over
// bound(seed,1,u128::MAX)). To narrow the gap we add a DENSE TABLE of extra fixed seeds chosen to
// stress edges: 0 (min steps), seeds that bias toward warp-only / advance-only op mixes, boundary
// multiples of wire::rate(), and seeds near the u64 ceiling. Each runs its own fresh stack (the
// full-stack fixture is not re-entrant within a single test) and re-asserts the same invariant
// total_deposits == skim + stop_all_refunds + withdraws + dust (dust <= DUST_TOLERANCE).
//
// NOTE: each seed is a separate #[test] (mirroring the seeds above) rather than a loop, because
// repeated begin/end of the full protocol stack inside one test leaks shared-object inventory.
fun run_one(seed: u64) {
    let mut scenario = ts::begin(wire::admin());
    let mut clock = wire::new_clock(&mut scenario, wire::admin(), wire::start_secs());
    run_conservation_seed(&mut scenario, &mut clock, seed);
    clock::destroy_for_testing(clock);
    ts::end(scenario);
}

#[test] fun test_conservation_seed_0() { run_one(0) }
#[test] fun test_conservation_seed_2() { run_one(2) }
#[test] fun test_conservation_seed_3() { run_one(3) }
#[test] fun test_conservation_seed_5() { run_one(5) }
#[test] fun test_conservation_seed_7() { run_one(7) }
#[test] fun test_conservation_seed_11() { run_one(11) }
#[test] fun test_conservation_seed_23() { run_one(23) }
#[test] fun test_conservation_seed_64() { run_one(64) }
#[test] fun test_conservation_seed_255() { run_one(255) }
#[test] fun test_conservation_seed_256() { run_one(256) }
#[test] fun test_conservation_seed_1024() { run_one(1024) }
#[test] fun test_conservation_seed_65535() { run_one(65535) }
#[test] fun test_conservation_seed_100003() { run_one(100003) }
#[test] fun test_conservation_seed_1000003() { run_one(1000003) }
#[test] fun test_conservation_seed_4294967295() { run_one(4294967295) }
#[test] fun test_conservation_seed_4294967296() { run_one(4294967296) }
#[test] fun test_conservation_seed_9999999967() { run_one(9999999967) }
#[test] fun test_conservation_seed_u64_max() { run_one(18446744073709551615) }
