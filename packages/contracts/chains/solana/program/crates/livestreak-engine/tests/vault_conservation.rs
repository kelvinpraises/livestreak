//! Vault-level conservation over the full betting flow: fund -> stream -> resolve ->
//! collect (pot + skim) -> withdraw (winnings + overage). The test plays the
//! market_driver's mechanical role (drips streams to the vault receivers + on_fund),
//! mirroring the Sui run_conservation_seed shape at engine level.

use ruint::aliases::U256;
use livestreak_engine::*;

const CYCLE: u64 = 10;
const M: u128 = AMT_PER_SEC_MULTIPLIER;

fn acct(n: u64) -> AccountId {
    U256::from(n)
}

fn recv_to(receiver: AccountId, units_per_sec: u128) -> StreamReceiver {
    StreamReceiver {
        account_id: receiver,
        config: StreamConfig {
            stream_id: 0,
            amt_per_sec: U256::from(units_per_sec * M),
            start: 0,
            duration: 0,
        },
    }
}

/// USDC 6dp: $1 = 1e6 raw units. The curve moves per ~1e5 pool units, so realistic
/// rates are essential — microscopic toy rates make price() flat and dG = 0.
const USD: u128 = 1_000_000;

const FUNDER: u64 = 11;
const YES_RECEIVER: u64 = 21;
const NO_RECEIVER: u64 = 22;

#[test]
fn full_betting_flow_conserves_to_the_unit() {
    let mut streams = StreamsRegistry::new(CYCLE).unwrap();
    let mut drips = DripsRegistry::default();
    let mut vault_reg = VaultRegistry::default();
    vault_reg.treasury_set = true; // skim path active

    let t0 = 40;
    let deposit: u128 = 100_000 * USD;
    let rate: u128 = 7 * USD; // $7/sec on the YES side

    // Vault opens.
    let vault_id = vault_reg
        .create_vault([9u8; 32], b"goal scored?".to_vec(), [1u8; 32], t0)
        .unwrap();

    // Funder cash enters the drips escrow and streams to the YES receiver.
    drips.deposit(deposit);
    let receivers = [recv_to(acct(YES_RECEIVER), rate)];
    let applied = drips
        .set_streams(&mut streams, acct(FUNDER), &[], deposit as i128, &receivers, 0, 0, t0)
        .unwrap();
    assert_eq!(applied, deposit as i128);
    let (_, _, _, _, stream_max_end) = streams.streams_state(acct(FUNDER));

    // Driver mirrors the stream into the vault board.
    vault_reg
        .on_fund(acct(FUNDER), &vault_id, SIDE_YES, U256::from(rate), stream_max_end, t0)
        .unwrap();

    // Live for 100s, then steward resolves YES.
    let t_resolve = t0 + 100;
    vault_reg.resolve(&vault_id, SIDE_YES, t_resolve).unwrap();

    // Funder stops the stream after resolution (overage window opens).
    let t_stop = t_resolve + 30;
    let real = drips
        .set_streams(&mut streams, acct(FUNDER), &receivers, i128::MIN + 1, &[], 0, 0, t_stop)
        .unwrap();
    let refunded = (-real) as u128;
    drips.withdraw(refunded).unwrap(); // program layer pays the refund out of escrow
    vault_reg.on_stop(acct(FUNDER), &vault_id, SIDE_YES, t_stop).unwrap();

    // Collect: catch boards up to resolved_at, finalize pot + skim, harvest receivers.
    let t_collect = t_stop + 3 * CYCLE;
    vault_reg
        .collect(&mut drips, &mut streams, &vault_id, acct(YES_RECEIVER), acct(NO_RECEIVER), 200, t_collect)
        .unwrap();

    // Board pool == what the board math accrued to resolved_at; pot = pools - skim.
    let (yes_pool, no_pool, ..) = vault_reg.get_vault_pools(&vault_id).unwrap();
    assert_eq!(yes_pool, U256::from(rate * 100)); // $700 on the board by resolve
    assert_eq!(no_pool, U256::ZERO);
    let skim = vault_reg.skim_owed.get(&vault_id).copied().unwrap_or_default();
    let pot = vault_reg.pot(&vault_id);
    assert_eq!(pot + skim, yes_pool + no_pool);

    // Winner withdraws: winnings (sole funder -> whole pot) + overage (post-resolve
    // streamed cash comes back).
    let claimable = vault_reg.claimable(acct(FUNDER), &vault_id, SIDE_YES);
    let paid = vault_reg.withdraw(acct(FUNDER), &vault_id, t_collect).unwrap();
    let overage = rate * 30; // resolved_at..stop
    assert_eq!(U256::from(paid), claimable + U256::from(overage));

    // Skim drains to the treasury.
    let skimmed = vault_reg.drain_skim(&vault_id);
    assert_eq!(skimmed, skim);

    // ── The money ledger closes to the unit ──────────────────────────────────────
    // Every deposited unit is either: refunded, paid as winnings/overage, skimmed,
    // or still sitting in one of the two escrows.
    let (drips_streams_bal, drips_collectable) = drips.balances();
    assert_eq!(
        deposit,
        refunded
            + paid
            + livestreak_math::wide::narrow(skimmed, "skim") as u128
            + vault_reg.usdc_held
            + drips.held,
    );
    // And the drips escrow is internally consistent.
    assert!(drips.held >= drips_streams_bal + drips_collectable);
}

#[test]
fn depletion_boundary_drains_and_lane_is_refundable() {
    let mut vault_reg = VaultRegistry::default();
    let t0 = 100;
    let vault_id = vault_reg
        .create_vault([9u8; 32], b"keeper save?".to_vec(), [1u8; 32], t0)
        .unwrap();

    // Fund YES at 5/s with a max_end 60s out (deposit runs dry there).
    let max_end = t0 + 60;
    vault_reg.on_fund(acct(FUNDER), &vault_id, SIDE_YES, U256::from(5 * USD), max_end, t0).unwrap();
    assert_eq!(vault_reg.pending_boundaries(&vault_id, SIDE_YES), 1);

    // Double-funding an active lane is refused.
    assert_eq!(
        vault_reg.on_fund(acct(FUNDER), &vault_id, SIDE_YES, U256::from(3 * USD), max_end + 50, t0 + 1),
        Err(VaultError::AlreadyFunding)
    );

    // Advance past the boundary: lane depletes, rate returns to zero, pool froze at max_end.
    vault_reg.advance(&vault_id, SIDE_YES, 0, max_end + 25).unwrap();
    let (_rate, _gp, shares, _me, depleted, ..) =
        vault_reg.get_position(&vault_id, SIDE_YES, acct(FUNDER));
    assert!(depleted);
    assert!(shares > U256::ZERO);
    let (pool, side_rate, ..) = vault_reg.get_board(&vault_id, SIDE_YES);
    assert_eq!(pool, U256::from(5 * USD * 60));
    assert_eq!(side_rate, U256::ZERO);
    // The board's boundary schedule is drained.
    assert_eq!(vault_reg.pending_boundaries(&vault_id, SIDE_YES), 0);

    // A depleted lane is re-fundable (top-up after dry — the strand fix semantics).
    vault_reg
        .on_fund(acct(FUNDER), &vault_id, SIDE_YES, U256::from(2 * USD), max_end + 120, max_end + 30)
        .unwrap();
    let (rate2, _gp2, shares2, _me2, depleted2, ..) =
        vault_reg.get_position(&vault_id, SIDE_YES, acct(FUNDER));
    assert_eq!(rate2, U256::from(2 * USD));
    assert!(!depleted2);
    assert_eq!(shares2, shares); // banked shares carried over
}

#[test]
fn account_vault_ledger_is_append_only_and_deduped() {
    let mut vault_reg = VaultRegistry::default();
    let v1 = vault_reg.create_vault([1u8; 32], b"q1".to_vec(), [1u8; 32], 10).unwrap();
    let v2 = vault_reg.create_vault([1u8; 32], b"q2".to_vec(), [1u8; 32], 10).unwrap();

    vault_reg.on_fund(acct(7), &v1, SIDE_YES, U256::from(1u8), 100, 10).unwrap();
    vault_reg.on_fund(acct(7), &v1, SIDE_NO, U256::from(1u8), 100, 10).unwrap();
    vault_reg.on_fund(acct(7), &v2, SIDE_YES, U256::from(1u8), 100, 10).unwrap();

    // Both sides of v1 dedupe to one ledger entry.
    assert_eq!(vault_reg.get_account_vault_ids(acct(7)), vec![v1, v2]);
}
