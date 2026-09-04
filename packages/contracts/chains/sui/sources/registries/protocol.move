// SPDX-License-Identifier: MIT

module livestreak::protocol;

use sui::event;

const E_ALREADY_SET: u64 = 1;
const E_ZERO_ID: u64 = 2;
const E_NOT_OWNER: u64 = 3;

public struct Protocol has key {
    id: UID,
    owner: address,
    market_registry: Option<ID>,
    vault: Option<ID>,
    drips: Option<ID>,
    streams: Option<ID>,
    market_driver: Option<ID>,
    vault_driver: Option<ID>,
    steward_registry: Option<ID>,
    lvst_metadata: Option<ID>,
    treasury: Option<ID>,
}

public struct ProtocolCreated has copy, drop {
    protocol_id: ID,
    owner: address,
}

public fun create(owner: address, ctx: &mut TxContext) {
    let id_obj = object::new(ctx);
    let protocol_id = object::uid_to_inner(&id_obj);
    let protocol = Protocol {
        id: id_obj,
        owner,
        market_registry: option::none(),
        vault: option::none(),
        drips: option::none(),
        streams: option::none(),
        market_driver: option::none(),
        vault_driver: option::none(),
        steward_registry: option::none(),
        lvst_metadata: option::none(),
        treasury: option::none(),
    };
    event::emit(ProtocolCreated { protocol_id, owner });
    transfer::share_object(protocol);
}

public fun owner(protocol: &Protocol): address {
    protocol.owner
}

public fun market_registry_id(protocol: &Protocol): Option<ID> {
    protocol.market_registry
}

public fun vault_id(protocol: &Protocol): Option<ID> {
    protocol.vault
}

public fun steward_registry_id(protocol: &Protocol): Option<ID> {
    protocol.steward_registry
}

public fun treasury_id(protocol: &Protocol): Option<ID> {
    protocol.treasury
}

public fun market_driver_id(protocol: &Protocol): Option<ID> {
    protocol.market_driver
}

public fun vault_driver_id(protocol: &Protocol): Option<ID> {
    protocol.vault_driver
}

public fun set_market_registry(protocol: &mut Protocol, id: ID, ctx: &TxContext) {
    assert_owner(protocol, ctx);
    set_once(&mut protocol.market_registry, id);
}

public fun set_vault(protocol: &mut Protocol, id: ID, ctx: &TxContext) {
    assert_owner(protocol, ctx);
    set_once(&mut protocol.vault, id);
}

public fun set_drips(protocol: &mut Protocol, id: ID, ctx: &TxContext) {
    assert_owner(protocol, ctx);
    set_once(&mut protocol.drips, id);
}

public fun set_streams(protocol: &mut Protocol, id: ID, ctx: &TxContext) {
    assert_owner(protocol, ctx);
    set_once(&mut protocol.streams, id);
}

public fun set_market_driver(protocol: &mut Protocol, id: ID, ctx: &TxContext) {
    assert_owner(protocol, ctx);
    set_once(&mut protocol.market_driver, id);
}

public fun set_vault_driver(protocol: &mut Protocol, id: ID, ctx: &TxContext) {
    assert_owner(protocol, ctx);
    set_once(&mut protocol.vault_driver, id);
}

public fun set_steward_registry(protocol: &mut Protocol, id: ID, ctx: &TxContext) {
    assert_owner(protocol, ctx);
    set_once(&mut protocol.steward_registry, id);
}

public fun set_lvst_metadata(protocol: &mut Protocol, id: ID, ctx: &TxContext) {
    assert_owner(protocol, ctx);
    set_once(&mut protocol.lvst_metadata, id);
}

public fun set_treasury(protocol: &mut Protocol, id: ID, ctx: &TxContext) {
    assert_owner(protocol, ctx);
    set_once(&mut protocol.treasury, id);
}

// --- helpers ---

fun assert_owner(protocol: &Protocol, ctx: &TxContext) {
    assert!(ctx.sender() == protocol.owner, E_NOT_OWNER);
}

fun set_once(slot: &mut Option<ID>, id: ID) {
    assert!(option::is_none(slot), E_ALREADY_SET);
    assert!(id != object::id_from_address(@0x0), E_ZERO_ID);
    *slot = option::some(id);
}
