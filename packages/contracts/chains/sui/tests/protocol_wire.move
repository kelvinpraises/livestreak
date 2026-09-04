// SPDX-License-Identifier: MIT

#[test_only]
module livestreak::protocol_wire;

use livestreak::lvst::LVST;
use livestreak::driver_utils::AccountMetadata;
use livestreak::drips::{Self, DripsRegistry};
use livestreak::driver_registry::{Self, DriverRegistry};
use livestreak::market_driver::{Self, MarketDriverRegistry, MarketPositionNFT};
use livestreak::market_registry::{Self, MarketRegistry};
use livestreak::protocol::{Self, Protocol};
use livestreak::side;
use livestreak::steward_registry::{Self, StewardRegistry};
use livestreak::streams::StreamsRegistry;
use livestreak::test_usdc::TEST_USDC;
use livestreak::treasury::{Self, TreasuryRegistry};
use livestreak::vault::{Self, VaultRegistry};
use livestreak::vault_driver::{Self, VaultDriverRegistry};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::test_scenario::{Self as ts, Scenario};
use sui::transfer;

const CYCLE_SECS: u64 = 10;
const START_SECS: u64 = 100;
const RATE: u256 = 1_000_000;
const WAD: u256 = 1_000_000_000_000_000_000;
const SHARE_TOLERANCE: u256 = 100_000;
const EVM_SHARES_WORKED: u256 = 498_754_151;

public fun admin(): address { @0xAD }
public fun creator(): address { @0xC0DE }
public fun stranger(): address { @0xBEEF }
public fun alice(): address { @0xA11CE }
public fun bob(): address { @0xB0B }
public fun carol(): address { @0xCA801 }
public fun dave(): address { @0xDADE }
public fun steward(): address { @0x57E4 }
public fun steward_a(): address { @0x57EAD }
public fun steward_b(): address { @0x57EEB }
public fun seed_creator(): address { @0x0128e63b55775c5b2cd5ed9aeb1beac84b3a081f }

public fun rate(): u256 { RATE }
public fun wad(): u256 { WAD }
public fun share_tolerance(): u256 { SHARE_TOLERANCE }
public fun evm_shares_worked(): u256 { EVM_SHARES_WORKED }
public fun cycle_secs(): u64 { CYCLE_SECS }
public fun start_secs(): u64 { START_SECS }
public fun creator_seed_deposit(): u64 {
    (10 * RATE) as u64
}

public fun deploy_core(ctx: &mut TxContext, owner: address) {
    protocol::create(owner, ctx);
    market_registry::create_registry(ctx);
    vault::create_registry<TEST_USDC>(ctx);
    steward_registry::create(owner, ctx);
    treasury::create_registry<TEST_USDC>(ctx);
    drips::create_drips_registry<TEST_USDC>(ctx);
    vault_driver::create_registry(ctx);
    driver_registry::create_registry(ctx);
}

public fun wire_streaming(
    protocol: &mut Protocol,
    vault_registry: &mut VaultRegistry<TEST_USDC>,
    treasury: &TreasuryRegistry<TEST_USDC>,
    market_registry: &MarketRegistry,
    drips: &DripsRegistry<TEST_USDC>,
    streams: &StreamsRegistry<TEST_USDC>,
    driver_registry: &mut DriverRegistry,
    vault_driver: &mut VaultDriverRegistry,
    market_driver: &mut MarketDriverRegistry,
    steward: &StewardRegistry,
    ctx: &mut TxContext,
) {
    vault::set_treasury_id(vault_registry, option::some(object::id(treasury)));
    vault_driver::bootstrap_streaming(vault_driver, driver_registry);
    let market_driver_id = driver_registry::register_driver(driver_registry);
    market_driver::set_driver_id(market_driver, market_driver_id);
    protocol::set_market_registry(protocol, object::id(market_registry), ctx);
    protocol::set_vault(protocol, object::id(vault_registry), ctx);
    protocol::set_drips(protocol, object::id(drips), ctx);
    protocol::set_streams(protocol, object::id(streams), ctx);
    protocol::set_market_driver(protocol, object::id(market_driver), ctx);
    protocol::set_vault_driver(protocol, object::id(vault_driver), ctx);
    protocol::set_steward_registry(protocol, object::id(steward), ctx);
    protocol::set_treasury(protocol, object::id(treasury), ctx);
}

public fun setup_stack(scenario: &mut Scenario, owner: address) {
    ts::next_tx(scenario, owner);
    deploy_core(ts::ctx(scenario), owner);
    ts::next_tx(scenario, owner);
    {
        let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(scenario);
        let treasury = ts::take_shared<TreasuryRegistry<TEST_USDC>>(scenario);
        let mut driver_registry = ts::take_shared<DriverRegistry>(scenario);
        let mut vault_driver = ts::take_shared<VaultDriverRegistry>(scenario);
        let ctx = ts::ctx(scenario);
        vault::set_treasury_id(&mut vault_registry, option::some(object::id(&treasury)));
        vault_driver::bootstrap_streaming(&mut vault_driver, &mut driver_registry);
        let market_driver_id = driver_registry::register_driver(&mut driver_registry);
        market_driver::create_registry(market_driver_id, ctx);
        ts::return_shared(vault_registry);
        ts::return_shared(treasury);
        ts::return_shared(driver_registry);
        ts::return_shared(vault_driver);
    };
    ts::next_tx(scenario, owner);
    {
        let mut protocol = ts::take_shared<Protocol>(scenario);
        let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(scenario);
        let treasury = ts::take_shared<TreasuryRegistry<TEST_USDC>>(scenario);
        let market_registry = ts::take_shared<MarketRegistry>(scenario);
        let drips = ts::take_shared<DripsRegistry<TEST_USDC>>(scenario);
        let streams = ts::take_shared<StreamsRegistry<TEST_USDC>>(scenario);
        let vault_driver = ts::take_shared<VaultDriverRegistry>(scenario);
        let mut market_driver = ts::take_shared<MarketDriverRegistry>(scenario);
        let steward = ts::take_shared<StewardRegistry>(scenario);
        let ctx = ts::ctx(scenario);
        protocol::set_market_registry(&mut protocol, object::id(&market_registry), ctx);
        protocol::set_vault(&mut protocol, object::id(&vault_registry), ctx);
        protocol::set_drips(&mut protocol, object::id(&drips), ctx);
        protocol::set_streams(&mut protocol, object::id(&streams), ctx);
        protocol::set_market_driver(&mut protocol, object::id(&market_driver), ctx);
        protocol::set_vault_driver(&mut protocol, object::id(&vault_driver), ctx);
        protocol::set_steward_registry(&mut protocol, object::id(&steward), ctx);
        protocol::set_treasury(&mut protocol, object::id(&treasury), ctx);
        ts::return_shared(protocol);
        ts::return_shared(vault_registry);
        ts::return_shared(treasury);
        ts::return_shared(market_registry);
        ts::return_shared(drips);
        ts::return_shared(streams);
        ts::return_shared(vault_driver);
        ts::return_shared(market_driver);
        ts::return_shared(steward);
    };
}

public fun new_clock(scenario: &mut Scenario, sender: address, secs: u64): Clock {
    ts::next_tx(scenario, sender);
    let mut clock = clock::create_for_testing(ts::ctx(scenario));
    clock::set_for_testing(&mut clock, secs * 1000);
    clock
}

public fun warp(clock: &mut Clock, secs: u64) {
    clock::set_for_testing(clock, secs * 1000);
}

public fun mint_usdc(scenario: &mut Scenario, amount: u64): Coin<TEST_USDC> {
    coin::mint_for_testing(amount, ts::ctx(scenario))
}

public fun register_market(
    scenario: &mut Scenario,
    who: address,
    title: vector<u8>,
    observe_stream_id: vector<u8>,
    clock: &Clock,
): vector<u8> {
    ts::next_tx(scenario, who);
    let mut reg = ts::take_shared<MarketRegistry>(scenario);
    let ctx = ts::ctx(scenario);
    let market_id = market_registry::register_market(&mut reg, title, observe_stream_id, clock, ctx);
    ts::return_shared(reg);
    market_id
}

public fun setup_steward(scenario: &mut Scenario, owner: address, steward_addr: address) {
    ts::next_tx(scenario, owner);
    {
        let mut reg = ts::take_shared<StewardRegistry>(scenario);
        let ctx = ts::ctx(scenario);
        steward_registry::register_steward(&mut reg, steward_addr, ctx);
        steward_registry::set_default_steward(&mut reg, steward_addr, ctx);
        ts::return_shared(reg);
    };
}

public fun create_vault(
    scenario: &mut Scenario,
    who: address,
    market_id: vector<u8>,
    question: vector<u8>,
    seed_side: u8,
    rate: u256,
    deposit: u64,
    clock: &Clock,
): vector<u8> {
    ts::next_tx(scenario, who);
    let mut vault_driver = ts::take_shared<VaultDriverRegistry>(scenario);
    let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(scenario);
    let mut market_registry = ts::take_shared<MarketRegistry>(scenario);
    let mut drips = ts::take_shared<DripsRegistry<TEST_USDC>>(scenario);
    let mut streams = ts::take_shared<StreamsRegistry<TEST_USDC>>(scenario);
    let payment = mint_usdc(scenario, deposit);
    let ctx = ts::ctx(scenario);
    let vault_id = vault_driver::create_vault(
        &mut vault_driver,
        &mut vault_registry,
        &mut market_registry,
        &mut drips,
        &mut streams,
        market_id,
        question,
        seed_side,
        rate,
        (deposit as u128),
        payment,
        clock,
        ctx,
    );
    ts::return_shared(vault_driver);
    ts::return_shared(vault_registry);
    ts::return_shared(market_registry);
    ts::return_shared(drips);
    ts::return_shared(streams);
    vault_id
}

public fun stop_seed(
    scenario: &mut Scenario,
    who: address,
    vault_id: vector<u8>,
    clock: &Clock,
) {
    ts::next_tx(scenario, who);
    let mut vault_driver = ts::take_shared<VaultDriverRegistry>(scenario);
    let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(scenario);
    let mut drips = ts::take_shared<DripsRegistry<TEST_USDC>>(scenario);
    let mut streams = ts::take_shared<StreamsRegistry<TEST_USDC>>(scenario);
    let ctx = ts::ctx(scenario);
    vault_driver::stop_seed(
        &mut vault_driver,
        &mut vault_registry,
        &mut drips,
        &mut streams,
        vault_id,
        clock,
        ctx,
    );
    ts::return_shared(vault_driver);
    ts::return_shared(vault_registry);
    ts::return_shared(drips);
    ts::return_shared(streams);
}

public fun harvest_side(
    scenario: &mut Scenario,
    vault_id: vector<u8>,
    seed_side: u8,
    clock: &Clock,
) {
    ts::next_tx(scenario, @0x1);
    let vault_driver = ts::take_shared<VaultDriverRegistry>(scenario);
    let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(scenario);
    let mut drips = ts::take_shared<DripsRegistry<TEST_USDC>>(scenario);
    let mut streams = ts::take_shared<StreamsRegistry<TEST_USDC>>(scenario);
    let ctx = ts::ctx(scenario);
    vault_driver::harvest(
        &vault_driver,
        &mut vault_registry,
        &mut drips,
        &mut streams,
        vault_id,
        seed_side,
        clock,
        ctx,
    );
    ts::return_shared(vault_driver);
    ts::return_shared(vault_registry);
    ts::return_shared(drips);
    ts::return_shared(streams);
}

public fun bond_vault(
    scenario: &mut Scenario,
    market_id: vector<u8>,
    question: vector<u8>,
    seed_side: u8,
    clock: &Clock,
): vector<u8> {
    let vault_id = create_vault(
        scenario,
        seed_creator(),
        market_id,
        question,
        seed_side,
        1,
        1,
        clock,
    );
    stop_seed(scenario, seed_creator(), vault_id, clock);
    harvest_side(scenario, vault_id, seed_side, clock);
    vault_id
}

public fun mint_nft(
    scenario: &mut Scenario,
    who: address,
    market_id: vector<u8>,
): u256 {
    mint_nft_to(scenario, who, who, market_id)
}

public fun mint_nft_to(
    scenario: &mut Scenario,
    sender: address,
    recipient: address,
    market_id: vector<u8>,
): u256 {
    ts::next_tx(scenario, sender);
    let mut market_driver = ts::take_shared<MarketDriverRegistry>(scenario);
    let market_registry = ts::take_shared<MarketRegistry>(scenario);
    let ctx = ts::ctx(scenario);
    let metadata = vector<AccountMetadata>[];
    let token_id = market_driver::mint(
        &mut market_driver,
        &market_registry,
        market_id,
        recipient,
        metadata,
        ctx,
    );
    ts::return_shared(market_driver);
    ts::return_shared(market_registry);
    token_id
}

public fun take_nft(scenario: &mut Scenario, owner: address): MarketPositionNFT {
    ts::next_tx(scenario, owner);
    ts::take_from_address<MarketPositionNFT>(scenario, owner)
}

public fun return_nft(_scenario: &mut Scenario, owner: address, nft: MarketPositionNFT) {
    ts::return_to_address(owner, nft);
}

public fun fund(
    scenario: &mut Scenario,
    who: address,
    nft: &MarketPositionNFT,
    vault_id: vector<u8>,
    fund_side: u8,
    rate: u256,
    deposit: u64,
    clock: &Clock,
) {
    ts::next_tx(scenario, who);
    let mut market_driver = ts::take_shared<MarketDriverRegistry>(scenario);
    let mut vault_driver = ts::take_shared<VaultDriverRegistry>(scenario);
    let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(scenario);
    let mut drips = ts::take_shared<DripsRegistry<TEST_USDC>>(scenario);
    let mut streams = ts::take_shared<StreamsRegistry<TEST_USDC>>(scenario);
    let payment = mint_usdc(scenario, deposit);
    let ctx = ts::ctx(scenario);
    market_driver::fund(
        &mut market_driver,
        nft,
        &mut vault_driver,
        &mut vault_registry,
        &mut drips,
        &mut streams,
        vault_id,
        fund_side,
        rate,
        (deposit as u128),
        payment,
        clock,
        ctx,
    );
    ts::return_shared(market_driver);
    ts::return_shared(vault_driver);
    ts::return_shared(vault_registry);
    ts::return_shared(drips);
    ts::return_shared(streams);
}

public fun abs_diff(a: u256, b: u256): u256 {
    if (a >= b) { a - b } else { b - a }
}

public fun hash_mix(seed: u64, i: u64, salt: vector<u8>): u64 {
    let mut data = std::bcs::to_bytes(&seed);
    vector::append(&mut data, std::bcs::to_bytes(&i));
    vector::append(&mut data, salt);
    let h = sui::hash::keccak256(&data);
    let mut n = 0u64;
    let mut j = 0u64;
    while (j < 8) {
        n = (n << 8) | (*vector::borrow(&h, j) as u64);
        j = j + 1;
    };
    n
}

public fun addr(suffix: u64): address {
    let mut b = vector[];
    let mut k = 0u64;
    while (k < 32) {
        vector::push_back(&mut b, 0);
        k = k + 1;
    };
    let mut i = 0u64;
    let mut v = suffix;
    while (i < 8) {
        *vector::borrow_mut(&mut b, 31 - i) = (v & 0xff) as u8;
        v = v >> 8;
        i = i + 1;
    };
    sui::address::from_bytes(b)
}

public fun resolve_vault(
    scenario: &mut Scenario,
    steward_who: address,
    vault_id: vector<u8>,
    outcome_yes: bool,
    clock: &Clock,
) {
    ts::next_tx(scenario, steward_who);
    let steward_reg = ts::take_shared<StewardRegistry>(scenario);
    let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(scenario);
    let ctx = ts::ctx(scenario);
    let outcome = if (outcome_yes) { 1u8 } else { 2u8 };
    steward_registry::resolve_vault(&steward_reg, &mut vault_registry, vault_id, outcome, clock, ctx);
    ts::return_shared(steward_reg);
    ts::return_shared(vault_registry);
}

public fun collect_vault(scenario: &mut Scenario, vault_id: vector<u8>, clock: &Clock) {
    ts::next_tx(scenario, @0x1);
    let vault_driver = ts::take_shared<VaultDriverRegistry>(scenario);
    let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(scenario);
    let mut drips = ts::take_shared<DripsRegistry<TEST_USDC>>(scenario);
    let mut streams = ts::take_shared<StreamsRegistry<TEST_USDC>>(scenario);
    let mut treasury = ts::take_shared<TreasuryRegistry<TEST_USDC>>(scenario);
    let ctx = ts::ctx(scenario);
    vault_driver::collect_vault(
        &vault_driver,
        &mut vault_registry,
        &mut drips,
        &mut streams,
        &mut treasury,
        vault_id,
        clock,
        ctx,
    );
    ts::return_shared(vault_driver);
    ts::return_shared(vault_registry);
    ts::return_shared(drips);
    ts::return_shared(streams);
    ts::return_shared(treasury);
}

public fun withdraw_market(
    scenario: &mut Scenario,
    who: address,
    vault_id: vector<u8>,
    clock: &Clock,
): u128 {
    ts::next_tx(scenario, who);
    let mut market_driver = ts::take_shared<MarketDriverRegistry>(scenario);
    let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(scenario);
    let nft = ts::take_from_address<MarketPositionNFT>(scenario, who);
    let ctx = ts::ctx(scenario);
    let amt = market_driver::withdraw(
        &market_driver,
        &nft,
        &mut vault_registry,
        vault_id,
        @0x0,
        clock,
        ctx,
    );
    ts::return_to_address(who, nft);
    ts::return_shared(market_driver);
    ts::return_shared(vault_registry);
    amt
}

public fun withdraw_seed(
    scenario: &mut Scenario,
    who: address,
    vault_id: vector<u8>,
    clock: &Clock,
): u128 {
    ts::next_tx(scenario, who);
    let vault_driver = ts::take_shared<VaultDriverRegistry>(scenario);
    let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(scenario);
    let ctx = ts::ctx(scenario);
    let amt = vault_driver::withdraw_seed(&mut vault_registry, &vault_driver, vault_id, clock, ctx);
    ts::return_shared(vault_driver);
    ts::return_shared(vault_registry);
    amt
}

public fun stop_all_refund(
    scenario: &mut Scenario,
    who: address,
    clock: &Clock,
): u128 {
    ts::next_tx(scenario, who);
    let mut market_driver = ts::take_shared<MarketDriverRegistry>(scenario);
    let mut vault_driver = ts::take_shared<VaultDriverRegistry>(scenario);
    let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(scenario);
    let mut drips = ts::take_shared<DripsRegistry<TEST_USDC>>(scenario);
    let mut streams = ts::take_shared<StreamsRegistry<TEST_USDC>>(scenario);
    let nft = ts::take_from_address<MarketPositionNFT>(scenario, who);
    let ctx = ts::ctx(scenario);
    let refunded = market_driver::stop_all(
        &mut market_driver,
        &nft,
        &mut vault_driver,
        &mut vault_registry,
        &mut drips,
        &mut streams,
        clock,
        ctx,
    );
    ts::return_to_address(who, nft);
    ts::return_shared(market_driver);
    ts::return_shared(vault_driver);
    ts::return_shared(vault_registry);
    ts::return_shared(drips);
    ts::return_shared(streams);
    refunded
}

public fun advance_both(scenario: &mut Scenario, who: address, vault_id: vector<u8>, clock: &Clock) {
    ts::next_tx(scenario, who);
    let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(scenario);
    vault::advance(&mut vault_registry, vault_id, side::yes(), 64, clock);
    vault::advance(&mut vault_registry, vault_id, side::no(), 64, clock);
    ts::return_shared(vault_registry);
}

public fun catch_up_vault(scenario: &mut Scenario, who: address, vault_id: vector<u8>, clock: &Clock) {
    ts::next_tx(scenario, who);
    let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(scenario);
    let mut guard = 0u64;
    while (!vault::caught_up(&vault_registry, &vault_id, side::yes(), clock)) {
        vault::advance(&mut vault_registry, vault_id, side::yes(), 64, clock);
        guard = guard + 1;
        assert!(guard < 20, 0);
    };
    vault::advance(&mut vault_registry, vault_id, side::no(), 200, clock);
    ts::return_shared(vault_registry);
}

public fun harvest_both_sides(scenario: &mut Scenario, vault_id: vector<u8>, clock: &Clock) {
    harvest_side(scenario, vault_id, side::yes(), clock);
    harvest_side(scenario, vault_id, side::no(), clock);
}

public fun stop_all_if_lanes(
    scenario: &mut Scenario,
    who: address,
    token_id: u256,
    clock: &Clock,
): u128 {
    ts::next_tx(scenario, who);
    let mut market_driver = ts::take_shared<MarketDriverRegistry>(scenario);
    if (market_driver::lane_count(&market_driver, token_id) == 0) {
        ts::return_shared(market_driver);
        return 0
    };
    ts::return_shared(market_driver);
    stop_all_refund(scenario, who, clock)
}

public fun setup_market_driver_fixture(
    scenario: &mut Scenario,
    clock: &Clock,
): (vector<u8>, vector<u8>, u256, u256) {
    setup_stack(scenario, admin());
    let market_id = register_market(scenario, admin(), b"market", b"s", clock);
    let v1 = bond_vault(scenario, market_id, b"Q1?", side::yes(), clock);
    let alice_token = mint_nft(scenario, alice(), market_id);
    let bob_token = mint_nft(scenario, bob(), market_id);
    (market_id, v1, alice_token, bob_token)
}

public fun mint_with_salt_nft(
    scenario: &mut Scenario,
    who: address,
    market_id: vector<u8>,
    salt: u64,
): u256 {
    ts::next_tx(scenario, who);
    let mut market_driver = ts::take_shared<MarketDriverRegistry>(scenario);
    let market_registry = ts::take_shared<MarketRegistry>(scenario);
    let token_id = market_driver::calc_token_id_with_salt(&market_driver, who, salt);
    let ctx = ts::ctx(scenario);
    let metadata = vector<AccountMetadata>[];
    market_driver::mint_with_salt(
        &mut market_driver,
        &market_registry,
        market_id,
        salt,
        who,
        metadata,
        ctx,
    );
    ts::return_shared(market_driver);
    ts::return_shared(market_registry);
    token_id
}

public fun transfer_nft(scenario: &mut Scenario, from: address, to: address) {
    ts::next_tx(scenario, from);
    let nft = ts::take_from_address<MarketPositionNFT>(scenario, from);
    transfer::public_transfer(nft, to);
}

public fun stop_lane(
    scenario: &mut Scenario,
    who: address,
    vault_id: vector<u8>,
    stop_side: u8,
    clock: &Clock,
) {
    ts::next_tx(scenario, who);
    let mut market_driver = ts::take_shared<MarketDriverRegistry>(scenario);
    let mut vault_driver = ts::take_shared<VaultDriverRegistry>(scenario);
    let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(scenario);
    let mut drips = ts::take_shared<DripsRegistry<TEST_USDC>>(scenario);
    let mut streams = ts::take_shared<StreamsRegistry<TEST_USDC>>(scenario);
    let nft = ts::take_from_address<MarketPositionNFT>(scenario, who);
    let ctx = ts::ctx(scenario);
    market_driver::stop(
        &mut market_driver,
        &nft,
        &mut vault_driver,
        &mut vault_registry,
        &mut drips,
        &mut streams,
        vault_id,
        stop_side,
        clock,
        ctx,
    );
    ts::return_to_address(who, nft);
    ts::return_shared(market_driver);
    ts::return_shared(vault_driver);
    ts::return_shared(vault_registry);
    ts::return_shared(drips);
    ts::return_shared(streams);
}

public fun set_lanes(
    scenario: &mut Scenario,
    who: address,
    vault_ids: vector<vector<u8>>,
    sides: vector<u8>,
    rates: vector<u256>,
    add_deposit: u64,
    clock: &Clock,
) {
    ts::next_tx(scenario, who);
    let mut market_driver = ts::take_shared<MarketDriverRegistry>(scenario);
    let mut vault_driver = ts::take_shared<VaultDriverRegistry>(scenario);
    let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(scenario);
    let mut drips = ts::take_shared<DripsRegistry<TEST_USDC>>(scenario);
    let mut streams = ts::take_shared<StreamsRegistry<TEST_USDC>>(scenario);
    let nft = ts::take_from_address<MarketPositionNFT>(scenario, who);
    let payment = if (add_deposit > 0) {
        option::some(mint_usdc(scenario, add_deposit))
    } else {
        option::none()
    };
    let ctx = ts::ctx(scenario);
    market_driver::set_lanes(
        &mut market_driver,
        &nft,
        &mut vault_driver,
        &mut vault_registry,
        &mut drips,
        &mut streams,
        vault_ids,
        sides,
        rates,
        (add_deposit as u128),
        payment,
        clock,
        ctx,
    );
    ts::return_to_address(who, nft);
    ts::return_shared(market_driver);
    ts::return_shared(vault_driver);
    ts::return_shared(vault_registry);
    ts::return_shared(drips);
    ts::return_shared(streams);
}

public fun advance_side(
    scenario: &mut Scenario,
    who: address,
    vault_id: vector<u8>,
    advance_side: u8,
    clock: &Clock,
) {
    ts::next_tx(scenario, who);
    let mut vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(scenario);
    vault::advance(&mut vault_registry, vault_id, advance_side, 64, clock);
    ts::return_shared(vault_registry);
}

public fun claim_loss_lvst(
    scenario: &mut Scenario,
    who: address,
    vault_id: vector<u8>,
    loss_side: u8,
): u256 {
    ts::next_tx(scenario, who);
    let mut treasury = ts::take_shared<TreasuryRegistry<TEST_USDC>>(scenario);
    let vault_registry = ts::take_shared<VaultRegistry<TEST_USDC>>(scenario);
    let nft = ts::take_from_address<MarketPositionNFT>(scenario, who);
    let token_id = market_driver::get_token_id(&nft);
    let lost_usdc = vault::loss_claimable(&vault_registry, token_id, &vault_id, loss_side);
    let ctx = ts::ctx(scenario);
    let minted = treasury::mint_loss_lvst_for_test(
        &mut treasury,
        token_id,
        who,
        vault_id,
        loss_side,
        lost_usdc,
        ctx,
    );
    ts::return_to_address(who, nft);
    ts::return_shared(treasury);
    ts::return_shared(vault_registry);
    minted
}

public fun stake_lvst_from_wallet(scenario: &mut Scenario, who: address) {
    ts::next_tx(scenario, who);
    let mut treasury = ts::take_shared<TreasuryRegistry<TEST_USDC>>(scenario);
    let payment = ts::take_from_address<Coin<LVST>>(scenario, who);
    let ctx = ts::ctx(scenario);
    treasury::stake_lvst(&mut treasury, payment, ctx);
    ts::return_shared(treasury);
}

public fun claim_dividends_usdc(
    scenario: &mut Scenario,
    who: address,
): u128 {
    ts::next_tx(scenario, who);
    let mut treasury = ts::take_shared<TreasuryRegistry<TEST_USDC>>(scenario);
    let ctx = ts::ctx(scenario);
    let paid = treasury::claim_dividends(&mut treasury, ctx);
    ts::return_shared(treasury);
    paid
}

public fun usdc_balance_of(scenario: &mut Scenario, who: address): u64 {
    ts::next_tx(scenario, who);
    if (!ts::has_most_recent_for_address<Coin<TEST_USDC>>(who)) {
        return 0
    };
    let coin = ts::take_from_address<Coin<TEST_USDC>>(scenario, who);
    let bal = coin::value(&coin);
    ts::return_to_address(who, coin);
    bal
}

public fun lvst_balance_of(scenario: &mut Scenario, who: address): u64 {
    ts::next_tx(scenario, who);
    if (!ts::has_most_recent_for_address<Coin<LVST>>(who)) {
        return 0
    };
    let coin = ts::take_from_address<Coin<LVST>>(scenario, who);
    let bal = coin::value(&coin);
    ts::return_to_address(who, coin);
    bal
}

public fun setup_stewards(
    scenario: &mut Scenario,
    owner: address,
    steward_a_addr: address,
    steward_b_addr: address,
    market_id: vector<u8>,
) {
    ts::next_tx(scenario, owner);
    {
        let mut reg = ts::take_shared<StewardRegistry>(scenario);
        let ctx = ts::ctx(scenario);
        steward_registry::register_steward(&mut reg, steward_a_addr, ctx);
        steward_registry::register_steward(&mut reg, steward_b_addr, ctx);
        steward_registry::set_default_steward(&mut reg, steward_a_addr, ctx);
        steward_registry::set_market_steward(&mut reg, market_id, steward_a_addr, ctx);
        ts::return_shared(reg);
    };
}

public fun bond_vault_question(
    scenario: &mut Scenario,
    market_id: vector<u8>,
    question: vector<u8>,
    seed_side: u8,
    clock: &Clock,
): vector<u8> {
    bond_vault(scenario, market_id, question, seed_side, clock)
}
