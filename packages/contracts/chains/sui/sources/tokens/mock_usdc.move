// SPDX-License-Identifier: MIT

module livestreak::mock_usdc;

use sui::coin::{Self, Coin, TreasuryCap};

public struct MOCK_USDC has drop {}

public struct MintCap has key {
    id: UID,
    cap: TreasuryCap<MOCK_USDC>,
}

fun init(otw: MOCK_USDC, ctx: &mut TxContext) {
    let (treasury_cap, metadata) = coin::create_currency<MOCK_USDC>(
        otw,
        6,
        b"Mock USDC",
        b"USDC",
        b"",
        option::none(),
        ctx,
    );
    transfer::public_freeze_object(metadata);
    transfer::share_object(MintCap {
        id: object::new(ctx),
        cap: treasury_cap,
    });
}

public fun mint(cap: &mut MintCap, amount: u64, ctx: &mut TxContext): Coin<MOCK_USDC> {
    coin::mint(&mut cap.cap, amount, ctx)
}

public fun mint_to(cap: &mut MintCap, amount: u64, recipient: address, ctx: &mut TxContext) {
    let payment = coin::mint(&mut cap.cap, amount, ctx);
    transfer::public_transfer(payment, recipient);
}
