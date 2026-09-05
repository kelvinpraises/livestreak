// SPDX-License-Identifier: MIT

module livestreak::lvst;

use sui::coin::{Self, TreasuryCap};

public struct LVST has drop {}

public struct LvstTreasuryCap has key {
    id: UID,
    cap: TreasuryCap<LVST>,
}

// D2 DECISION: LVST decimals are chain-LOCAL and intentionally divergent — Sui = 9, EVM = 18
// (see LvstToken.sol). Do NOT "standardize" this 9. Sui `Coin` value is u64, so 9 decimals is the
// idiomatic choice and preserves headroom; the mint RATE (100/1/$10k per USDC) is identical to EVM.
// Any consumer that formats LVST must read decimals per-chain (app `LVST_SCALE` is chain-aware).
const LVST_DECIMALS: u8 = 9;

fun init(otw: LVST, ctx: &mut TxContext) {
    let (treasury_cap, metadata) = coin::create_currency<LVST>(
        otw,
        LVST_DECIMALS,
        b"LiveStreak",
        b"LVST",
        b"",
        option::none(),
        ctx,
    );
    transfer::public_freeze_object(metadata);
    let wrapper = LvstTreasuryCap {
        id: object::new(ctx),
        cap: treasury_cap,
    };
    transfer::share_object(wrapper);
}

public fun mint(cap: &mut LvstTreasuryCap, amount: u128, recipient: address, ctx: &mut TxContext) {
    let mut remaining = amount;
    while (remaining > 0) {
        let chunk = if (remaining > (std::u64::max_value!() as u128)) {
            std::u64::max_value!()
        } else {
            (remaining as u64)
        };
        coin::mint_and_transfer(&mut cap.cap, chunk, recipient, ctx);
        remaining = remaining - (chunk as u128);
    };
}

#[test_only]
public fun mint_for_test(amount: u128, recipient: address, ctx: &mut TxContext) {
    let mut remaining = amount;
    while (remaining > 0) {
        let chunk = if (remaining > (std::u64::max_value!() as u128)) {
            std::u64::max_value!()
        } else {
            (remaining as u64)
        };
        let payment = coin::mint_for_testing<LVST>(chunk, ctx);
        transfer::public_transfer(payment, recipient);
        remaining = remaining - (chunk as u128);
    };
}

// NOTE: there is intentionally no `pull_from`. Sui staking moves `Coin<LVST>` directly into
// treasury::stake_lvst (object-transfer model), so EVM's allowance-pull entrypoint has no Sui analog.
