// SPDX-License-Identifier: MIT

#[test_only]
module livestreak::protocol_tests;

use livestreak::protocol::{Self, Protocol};
use sui::test_scenario::{Self as ts};

const OWNER: address = @0xAD;
const STRANGER: address = @0xBEEF;

#[test, expected_failure(abort_code = 3)]
fun test_setters_only_owner() {
    let mut scenario = ts::begin(OWNER);
    ts::next_tx(&mut scenario, OWNER);
    {
        protocol::create(OWNER, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, STRANGER);
    {
        let mut protocol = ts::take_shared<Protocol>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        protocol::set_vault(&mut protocol, object::id_from_address(@0x1), ctx);
        ts::return_shared(protocol);
    };

    ts::end(scenario);
}

#[test, expected_failure(abort_code = 2)]
fun test_zero_id_reverts() {
    let mut scenario = ts::begin(OWNER);
    ts::next_tx(&mut scenario, OWNER);
    {
        protocol::create(OWNER, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, OWNER);
    {
        let mut protocol = ts::take_shared<Protocol>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        protocol::set_vault(&mut protocol, object::id_from_address(@0x0), ctx);
        ts::return_shared(protocol);
    };

    ts::end(scenario);
}

#[test, expected_failure(abort_code = 1)]
fun test_reset_reverts() {
    let mut scenario = ts::begin(OWNER);
    ts::next_tx(&mut scenario, OWNER);
    {
        protocol::create(OWNER, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, OWNER);
    {
        let mut protocol = ts::take_shared<Protocol>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        let id = object::id_from_address(@0x1);
        protocol::set_vault(&mut protocol, id, ctx);
        protocol::set_vault(&mut protocol, object::id_from_address(@0x2), ctx);
        ts::return_shared(protocol);
    };

    ts::end(scenario);
}

#[test]
fun test_getters_return_what_was_set() {
    let mut scenario = ts::begin(OWNER);
    ts::next_tx(&mut scenario, OWNER);
    {
        protocol::create(OWNER, ts::ctx(&mut scenario));
    };

    ts::next_tx(&mut scenario, OWNER);
    {
        let mut protocol = ts::take_shared<Protocol>(&scenario);
        let ctx = ts::ctx(&mut scenario);
        let market = object::id_from_address(@0x11);
        let vault = object::id_from_address(@0x22);
        let drips = object::id_from_address(@0x33);
        let driver = object::id_from_address(@0x44);
        let vault_driver = object::id_from_address(@0x55);
        let steward = object::id_from_address(@0x66);
        let treasury = object::id_from_address(@0x77);

        protocol::set_market_registry(&mut protocol, market, ctx);
        protocol::set_vault(&mut protocol, vault, ctx);
        protocol::set_drips(&mut protocol, drips, ctx);
        protocol::set_market_driver(&mut protocol, driver, ctx);
        protocol::set_vault_driver(&mut protocol, vault_driver, ctx);
        protocol::set_steward_registry(&mut protocol, steward, ctx);
        protocol::set_treasury(&mut protocol, treasury, ctx);

        assert!(option::borrow(&protocol::market_registry_id(&protocol)) == &market, 0);
        assert!(option::borrow(&protocol::vault_id(&protocol)) == &vault, 1);
        assert!(option::borrow(&protocol::market_driver_id(&protocol)) == &driver, 2);
        assert!(option::borrow(&protocol::vault_driver_id(&protocol)) == &vault_driver, 3);
        assert!(option::borrow(&protocol::steward_registry_id(&protocol)) == &steward, 4);
        assert!(option::borrow(&protocol::treasury_id(&protocol)) == &treasury, 5);
        ts::return_shared(protocol);
    };

    ts::end(scenario);
}
