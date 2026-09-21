//! Settled-state compaction: the persisted per-market blob (postcard) grows
//! monotonically as funders deplete / refresh streams and as vaults settle. These
//! tests prove `VaultRegistry::compact` deletes only PROVABLY-dead storage — the
//! byte size drops by a meaningful margin while every surviving read (boundaries
//! views, winnings, overage, loss-mint) returns byte-identical results.

use livestreak_engine::*;
use ruint::aliases::U256;

const USD: u128 = 1_000_000;
const CYCLE: u64 = 10;

fn acct(n: u64) -> AccountId {
    U256::from(n)
}

fn recv_to(receiver: AccountId, units_per_sec: u128) -> StreamReceiver {
    StreamReceiver {
        account_id: receiver,
        config: StreamConfig {
            stream_id: 0,
            amt_per_sec: U256::from(units_per_sec * AMT_PER_SEC_MULTIPLIER),
            start: 0,
            duration: 0,
        },
    }
}

fn blob_len(v: &VaultRegistry) -> usize {
    postcard::to_allocvec(v).expect("serialize").len()
}

/// Byte-size regression: churn many fund -> deplete -> refund cycles across several
/// vaults/sides (each depletion advances a boundary head, so a fat dead prefix piles
/// up), then compact. The blob must shrink by a meaningful margin AND the live
/// boundary views must be byte-identical before and after.
#[test]
fn boundary_prefix_compaction_shrinks_blob_and_preserves_views() {
    let mut v = VaultRegistry::default();
    v.treasury_set = true;

    let vaults: Vec<VaultId> = (0..3u8)
        .map(|i| v.create_vault([i; 32], vec![b'q', i], [1u8; 32], 100).unwrap())
        .collect();

    let funder = acct(11);
    let churn_cycles = 8;
    let mut t_final = 0u64;

    // Deterministic fund -> deplete -> refund churn, identical across every key.
    for vid in &vaults {
        for side in [SIDE_YES, SIDE_NO] {
            let mut t = 100u64;
            let mut me = t + 20;
            v.on_fund(funder, vid, side, U256::from(3 * USD), me, t).unwrap();
            for _ in 0..churn_cycles {
                v.advance(vid, side, 0, me + 5).unwrap(); // deplete: head advances
                t = me + 5;
                me = t + 20;
                v.on_fund(funder, vid, side, U256::from(3 * USD), me, t).unwrap();
            }
            // Final refund with a far max_end so the active suffix lane survives.
            v.advance(vid, side, 0, me + 5).unwrap();
            t = me + 5;
            v.on_fund(funder, vid, side, U256::from(3 * USD), t + 1_000_000, t).unwrap();
            t_final = t;
        }
    }

    // Each (vault, side) now holds `churn_cycles + 2` boundary entries with all but
    // the last (active) entry sitting below head — the dead prefix.
    for vid in &vaults {
        for side in [SIDE_YES, SIDE_NO] {
            assert_eq!(v.pending_boundaries(vid, side), 1, "one active lane in suffix");
        }
    }

    // Snapshot every live view over the boundary suffix.
    let snap: Vec<(Vec<u64>, Vec<U256>, u64)> = vaults
        .iter()
        .flat_map(|vid| {
            [SIDE_YES, SIDE_NO].into_iter().map(move |side| (vid, side))
        })
        .map(|(vid, side)| {
            let (ends, rates) = v.get_boundaries(vid, side);
            (ends, rates, v.pending_boundaries(vid, side))
        })
        .collect();

    let uncompacted = blob_len(&v);
    v.compact();
    let compacted = blob_len(&v);

    // Idempotent.
    v.compact();
    assert_eq!(blob_len(&v), compacted, "compact is idempotent");

    // Views are byte-identical post-compaction.
    let snap_after: Vec<(Vec<u64>, Vec<U256>, u64)> = vaults
        .iter()
        .flat_map(|vid| {
            [SIDE_YES, SIDE_NO].into_iter().map(move |side| (vid, side))
        })
        .map(|(vid, side)| {
            let (ends, rates) = v.get_boundaries(vid, side);
            (ends, rates, v.pending_boundaries(vid, side))
        })
        .collect();
    assert_eq!(snap, snap_after, "boundary views unchanged by compaction");

    // Every dead prefix entry is gone: only the active suffix remains.
    for vid in &vaults {
        for side in [SIDE_YES, SIDE_NO] {
            assert_eq!(v.pending_boundaries(vid, side), 1);
        }
    }

    let dead_entries = 3 * 2 * (churn_cycles + 1); // vaults * sides * prefix-per-key
    println!(
        "boundary compaction: uncompacted={uncompacted}B compacted={compacted}B \
         saved={}B ({} dead boundaries, t_final={t_final})",
        uncompacted - compacted,
        dead_entries,
    );
    assert!(compacted < uncompacted, "blob must shrink");
    // Each Boundary is 40 bytes (u64 + U256) plus postcard framing; a conservative
    // floor well below the ~1.7KB actually reclaimed here.
    assert!(
        uncompacted - compacted > 800,
        "expected a meaningful margin, saved only {}B",
        uncompacted - compacted
    );
}

/// Semantics preservation: a fully cash-funded winner/loser flow taken through
/// resolve -> collect -> withdraw, then compacted. Winnings, overage crumbs, and the
/// treasury loss-mint (which reads vault position state) must all still pay exactly.
#[test]
fn compaction_preserves_winnings_overage_and_loss_mint() {
    let mut streams = StreamsRegistry::new(CYCLE).unwrap();
    let mut drips = DripsRegistry::default();
    let mut v = VaultRegistry::default();
    v.treasury_set = true;
    let mut treasury = TreasuryRegistry::default();

    let t0 = 40;
    let yes_dep = 100_000 * USD;
    let no_dep = 100_000 * USD;
    let yes_rate = 7 * USD;
    let no_rate = 5 * USD;

    const FUNDER_YES: u64 = 11;
    const FUNDER_NO: u64 = 12;
    const YES_RECEIVER: u64 = 21;
    const NO_RECEIVER: u64 = 22;

    let vault_id = v
        .create_vault([9u8; 32], b"goal scored?".to_vec(), [1u8; 32], t0)
        .unwrap();

    // Both sides stream real cash into the drips escrow.
    drips.deposit(yes_dep + no_dep);
    let yes_recv = [recv_to(acct(YES_RECEIVER), yes_rate)];
    let no_recv = [recv_to(acct(NO_RECEIVER), no_rate)];
    drips
        .set_streams(&mut streams, acct(FUNDER_YES), &[], yes_dep as i128, &yes_recv, 0, 0, t0)
        .unwrap();
    drips
        .set_streams(&mut streams, acct(FUNDER_NO), &[], no_dep as i128, &no_recv, 0, 0, t0)
        .unwrap();
    let (_, _, _, _, yes_me) = streams.streams_state(acct(FUNDER_YES));
    let (_, _, _, _, no_me) = streams.streams_state(acct(FUNDER_NO));
    v.on_fund(acct(FUNDER_YES), &vault_id, SIDE_YES, U256::from(yes_rate), yes_me, t0).unwrap();
    v.on_fund(acct(FUNDER_NO), &vault_id, SIDE_NO, U256::from(no_rate), no_me, t0).unwrap();

    // Live 100s, resolve YES (NO is the loser).
    let t_resolve = t0 + 100;
    v.resolve(&vault_id, SIDE_YES, t_resolve).unwrap();

    // Both stop 30s after resolution -> overage owed on both sides.
    let t_stop = t_resolve + 30;
    for (funder, rcv) in [(FUNDER_YES, &yes_recv), (FUNDER_NO, &no_recv)] {
        let real = drips
            .set_streams(&mut streams, acct(funder), rcv, i128::MIN + 1, &[], 0, 0, t_stop)
            .unwrap();
        drips.withdraw((-real) as u128).unwrap();
    }
    v.on_stop(acct(FUNDER_YES), &vault_id, SIDE_YES, t_stop).unwrap();
    v.on_stop(acct(FUNDER_NO), &vault_id, SIDE_NO, t_stop).unwrap();

    // Collect: harvest streamed cash into the vault escrow, finalize pot + skim.
    let t_collect = t_stop + 3 * CYCLE;
    v.collect(&mut drips, &mut streams, &vault_id, acct(YES_RECEIVER), acct(NO_RECEIVER), 200, t_collect)
        .unwrap();

    // Winner withdraws -> zeroes their claim + overage_paid (rate==0 overage crumb).
    let claimable_yes = v.claimable(acct(FUNDER_YES), &vault_id, SIDE_YES);
    let paid_yes = v.withdraw(acct(FUNDER_YES), &vault_id, t_collect).unwrap();
    let yes_overage = yes_rate * 30;
    assert_eq!(U256::from(paid_yes), claimable_yes + U256::from(yes_overage));

    // Loser withdraws -> gets overage only, leaving a ZERO overage_owed crumb.
    let paid_no = v.withdraw(acct(FUNDER_NO), &vault_id, t_collect).unwrap();
    assert_eq!(paid_no, no_rate * 30);

    // Snapshot the loss basis (must survive compaction — it feeds the treasury mint).
    let loss_before = v.loss_claimable(acct(FUNDER_NO), &vault_id, SIDE_NO);
    assert!(loss_before > U256::ZERO, "loser has a loss basis");

    // A ZERO overage_owed crumb exists for at least one stopped position.
    let crumbs = v.overage_owed.values().filter(|x| **x == U256::ZERO).count();
    assert!(crumbs > 0, "fully-paid rate==0 overage crumb present");

    let uncompacted = blob_len(&v);
    v.compact();
    let compacted = blob_len(&v);
    println!(
        "settled-flow compaction: uncompacted={uncompacted}B compacted={compacted}B saved={}B \
         ({crumbs} overage crumbs)",
        uncompacted - compacted
    );
    assert!(compacted < uncompacted, "overage crumbs reclaimed");

    // The crumb pair is gone; every ZERO-owed entry removed.
    assert_eq!(
        v.overage_owed.values().filter(|x| **x == U256::ZERO).count(),
        0
    );

    // Reads still pay correctly AFTER compaction:
    // - loss basis unchanged, so the treasury loss-mint reads the same value.
    assert_eq!(v.loss_claimable(acct(FUNDER_NO), &vault_id, SIDE_NO), loss_before);
    let minted = treasury
        .mint_loss_lvst(&v, acct(FUNDER_NO), &vault_id, SIDE_NO)
        .unwrap();
    assert_eq!(minted, loss_before * treasury.mint_rate() / U256::from(USDC_ONE));
    assert!(minted > U256::ZERO);

    // - already-claimed winner is still zero (double-withdraw remains a no-op).
    assert_eq!(v.claimable(acct(FUNDER_YES), &vault_id, SIDE_YES), U256::ZERO);
    assert_eq!(v.withdraw(acct(FUNDER_YES), &vault_id, t_collect).unwrap(), 0);
    // - re-withdrawing the loser pays nothing further (overage crumb stayed settled).
    assert_eq!(v.withdraw(acct(FUNDER_NO), &vault_id, t_collect).unwrap(), 0);
}
