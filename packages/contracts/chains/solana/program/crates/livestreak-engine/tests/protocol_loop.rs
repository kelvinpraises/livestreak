//! The full keynote loop at engine level, through the real driver entry points:
//! seeded vault -> minted position -> funded lane -> resolve -> collect (skim to
//! treasury + dividends) -> withdraw winners -> loss-mint LVST for the loser ->
//! global conservation across every escrow.

use ruint::aliases::U256;
use livestreak_engine::*;

const USD: u128 = 1_000_000;
const CREATOR: [u8; 32] = [1u8; 32];
const BETTOR: [u8; 32] = [2u8; 32];
const STAKER: [u8; 32] = [3u8; 32];

#[test]
fn full_protocol_loop_conserves_and_pays_the_right_people() {
    let mut p = Protocol::default();
    let market_id = [7u8; 32];
    let t0 = 1_000;

    // ── Bookmaker seeds the vault on NO at $5/s with $500 ─────────────────────
    let seed_deposit = 500 * USD;
    let vault_id = p
        .create_vault_seeded(
            market_id,
            b"goal scored?".to_vec(),
            CREATOR,
            SIDE_NO,
            U256::from(5 * USD),
            seed_deposit,
            t0,
        )
        .unwrap();

    // ── Bettor mints a position and funds YES at $7/s with $700 ───────────────
    let token_id = p.mint_with_salt(market_id, true, BETTOR, 42).unwrap();
    assert_eq!(token_id, p.calc_token_id_with_salt(&BETTOR, 42)); // client precompute parity
    let bet_deposit = 700 * USD;
    p.fund(token_id, &vault_id, SIDE_YES, U256::from(7 * USD), bet_deposit, t0)
        .unwrap();

    // Live pool caps: boundaries expose each active stream (seed + bettor).
    let (yes_ends, yes_rates) = p.vault.get_boundaries(&vault_id, SIDE_YES);
    assert_eq!(yes_rates, vec![U256::from(7 * USD)]);
    assert_eq!(yes_ends.len(), 1);

    // ── 60 seconds of live streaming, then steward resolves YES ───────────────
    let t_resolve = t0 + 60;
    p.vault.resolve(&vault_id, SIDE_YES, t_resolve).unwrap();

    // Bettor stops 20s after resolution (overage owed for those 20s).
    let t_stop = t_resolve + 20;
    p.stop(token_id, &vault_id, SIDE_YES, t_stop).unwrap();
    let bettor_refund = p.stop_all(token_id, t_stop).unwrap();
    let creator_refund = p.stop_seed(&vault_id, CREATOR, t_stop).unwrap();

    // ── Collect: harvest both sides, finalize pot, skim 2% of losing pool ─────
    let t_collect = t_stop + 40;
    let skimmed = p.collect_vault(&vault_id, t_collect).unwrap();
    let yes_pool = 7 * USD * 60; // $420 by resolve
    let no_pool = 5 * USD * 60; // $300 by resolve
    assert_eq!(skimmed, no_pool * 200 / 10_000); // 2% of losing pool = $6
    assert_eq!(
        p.vault.pot(&vault_id),
        U256::from(yes_pool + no_pool - skimmed)
    );

    // Treasury got the skim; a staker later gets it as dividends.
    assert_eq!(p.treasury.usdc_held, skimmed);
    p.treasury.stake_lvst(STAKER, 1_000).unwrap();
    p.treasury.notify_skim(U256::ZERO); // no-op distribution check
    // (skim was notified pre-stake -> parked as undistributed, released next notify)
    assert_eq!(p.treasury.undistributed as u128 + p.treasury.pending_dividends(&STAKER), skimmed);

    // ── Winner withdraws: sole YES funder takes the whole pot + overage ───────
    let paid_bettor = p.withdraw(token_id, &vault_id, t_collect).unwrap();
    let overage = 7 * USD * 20; // resolve..stop
    assert_eq!(paid_bettor, (yes_pool + no_pool - skimmed) + overage);

    // Loser (seed creator, NO side) gets nothing from the pot — but the $100 they
    // streamed AFTER resolution comes back as overage (money after the market was
    // decided is not a bet).
    let paid_creator = p.withdraw_seed(&vault_id, CREATOR, t_collect).unwrap();
    let creator_overage = 5 * USD * 20; // resolve..stop on the seed lane
    assert_eq!(paid_creator, creator_overage);

    // ...but loss-mints LVST on the pool-driven curve (fresh pool -> 100 LVST/$).
    let seed_account = p.vault_driver.seed_account(&CREATOR, &vault_id);
    let minted = p.claim_loss_lvst(seed_account, &vault_id, SIDE_NO).unwrap();
    let expected_rate = p.treasury.mint_rate(); // knee dented by $6 skim
    assert_eq!(minted, U256::from(no_pool) * expected_rate / U256::from(USD));
    // Anti-dupe: second claim refuses.
    assert!(p.claim_loss_lvst(seed_account, &vault_id, SIDE_NO).is_err());

    // ── Global conservation: every deposited unit is somewhere legitimate ─────
    let total_in = seed_deposit + bet_deposit;
    let total_out = bettor_refund + creator_refund + paid_bettor + paid_creator;
    let escrows = p.drips.held + p.vault.usdc_held + p.treasury.usdc_held;
    assert_eq!(total_in, total_out + escrows);
    // The vault escrow retains exactly the unclaimed winning-side rounding dust
    // plus nothing else once the sole winner has withdrawn.
    assert!(p.vault.usdc_held < USD, "vault residue is dust, got {}", p.vault.usdc_held);
}

#[test]
fn set_lanes_reshape_and_hedge_flow() {
    let mut p = Protocol::default();
    let market_id = [8u8; 32];
    let t0 = 500;

    let v1 = p
        .create_vault_seeded(market_id, b"q1".to_vec(), CREATOR, SIDE_NO, U256::from(USD), 100 * USD, t0)
        .unwrap();
    let v2 = p
        .create_vault_seeded(market_id, b"q2".to_vec(), CREATOR, SIDE_NO, U256::from(USD), 100 * USD, t0)
        .unwrap();

    let token = p.mint(market_id, true).unwrap();
    p.fund(token, &v1, SIDE_YES, U256::from(2 * USD), 200 * USD, t0).unwrap();

    // Declarative reshape: keep v1, add v2, one call (sequential side-switch = hedge).
    let desired = [
        (v1, SIDE_YES, U256::from(2 * USD)),
        (v2, SIDE_YES, U256::from(3 * USD)),
    ];
    p.set_lanes(token, &desired, 300 * USD, t0 + 10).unwrap();
    assert_eq!(p.lane_count(token), 2);

    // Duplicate vault in desired set refuses.
    let dup = [(v1, SIDE_YES, U256::from(USD)), (v1, SIDE_NO, U256::from(USD))];
    assert_eq!(p.set_lanes(token, &dup, 0, t0 + 11).unwrap_err(), DriverError::DuplicateVault);

    // Cross-market vault refuses.
    let mut q = Protocol::default();
    let foreign = q
        .create_vault_seeded([9u8; 32], b"x".to_vec(), CREATOR, SIDE_NO, U256::from(USD), USD, t0)
        .unwrap();
    assert!(matches!(
        p.fund(token, &foreign, SIDE_YES, U256::from(USD), USD, t0 + 12),
        Err(DriverError::Vault(VaultError::UnknownVault))
    ));

    // stop_all refunds the un-streamed remainder and clears every lane.
    let refunded = p.stop_all(token, t0 + 20).unwrap();
    assert!(refunded > 0);
    assert_eq!(p.lane_count(token), 0);
}

/// The program layer persists Protocol as a postcard blob — a populated state
/// (every map non-empty) must round-trip byte-exactly.
#[test]
fn protocol_state_round_trips_through_postcard() {
    let mut p = Protocol::default();
    let market_id = [3u8; 32];
    let vault_id = p
        .create_vault_seeded(market_id, b"rt".to_vec(), CREATOR, SIDE_NO, U256::from(USD), 50 * USD, 100)
        .unwrap();
    let token = p.mint_with_salt(market_id, true, BETTOR, 1).unwrap();
    p.fund(token, &vault_id, SIDE_YES, U256::from(USD), 25 * USD, 100).unwrap();
    p.treasury.stake_lvst(STAKER, 42).unwrap();

    let bytes = p.to_bytes();
    let q = Protocol::from_bytes(&bytes).unwrap();
    assert_eq!(q.to_bytes(), bytes);
    assert_eq!(q.lane_count(token), 1);
    assert_eq!(q.vault.get_board(&vault_id, SIDE_YES), p.vault.get_board(&vault_id, SIDE_YES));
    assert_eq!(q.drips.held, p.drips.held);
}
