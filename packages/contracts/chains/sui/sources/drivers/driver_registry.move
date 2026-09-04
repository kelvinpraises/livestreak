// SPDX-License-Identifier: GPL-3.0-only

module livestreak::driver_registry;

use sui::event;

public struct DriverRegistry has key {
    id: UID,
    next_driver_id: u32,
}

public struct DriverRegistryCreated has copy, drop {
    registry_id: ID,
}

fun init(ctx: &mut TxContext) {
    create_registry(ctx);
}

public fun create_registry(ctx: &mut TxContext) {
    let id_obj = object::new(ctx);
    let registry_id = object::uid_to_inner(&id_obj);
    let registry = DriverRegistry {
        id: id_obj,
        next_driver_id: 0,
    };
    event::emit(DriverRegistryCreated { registry_id });
    transfer::share_object(registry);
}

public fun register_driver(registry: &mut DriverRegistry): u32 {
    let id = registry.next_driver_id;
    registry.next_driver_id = id + 1;
    id
}

public fun next_driver_id(registry: &DriverRegistry): u32 {
    registry.next_driver_id
}
