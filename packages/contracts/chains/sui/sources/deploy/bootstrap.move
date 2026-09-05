// SPDX-License-Identifier: MIT

module livestreak::bootstrap;

use livestreak::driver_registry::{Self, DriverRegistry};
use livestreak::drips::DripsRegistry;
use livestreak::market_driver::{Self, MarketDriverRegistry};
use livestreak::market_registry::MarketRegistry;
use livestreak::protocol::{Self, Protocol};
use livestreak::steward_registry::{Self, StewardRegistry};
use livestreak::streams::StreamsRegistry;
use livestreak::treasury::TreasuryRegistry;
use livestreak::vault::{Self, VaultRegistry};
use livestreak::vault_driver::{Self, VaultDriverRegistry};

public fun wire_core<T>(
    protocol: &mut Protocol,
    vault_registry: &mut VaultRegistry<T>,
    treasury: &TreasuryRegistry<T>,
    market_registry: &MarketRegistry,
    drips: &DripsRegistry<T>,
    streams: &StreamsRegistry<T>,
    vault_driver: &mut VaultDriverRegistry,
    market_driver: &mut MarketDriverRegistry,
    steward: &mut StewardRegistry,
    driver_registry: &mut DriverRegistry,
    steward_addr: address,
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
    steward_registry::register_steward(steward, steward_addr, ctx);
    steward_registry::set_default_steward(steward, steward_addr, ctx);
}
