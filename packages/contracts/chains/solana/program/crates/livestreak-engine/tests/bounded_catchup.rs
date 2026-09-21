//! Bounded implicit catch-up: an op arriving at a board with more elapsed funder
//! boundaries than `MAX_IMPLICIT_CATCHUP_STEPS` fails typed `BoardBehind` WITHOUT
//! mutating the board, and the caller drains the backlog with the uncapped, bounded
//! `advance(max_steps)` entrypoint before the op succeeds. Guards the CU/heap brick
//! the Phase-3 idle markets hit while keeping money conservation exact.

use livestreak_engine::*;
use ruint::aliases::U256;

const USD: u128 = 1_000_000;

fn acct(n: u64) -> AccountId {
    U256::from(n)
}

/// Fund `n` distinct accounts on SIDE_YES at `t0`, each at `rate` with the same
/// `max_end` — a schedule of `n` boundaries that all come due once time passes
/// `max_end`. All are funded while the board is caught up (their max_ends are still in
/// the future at t0), so setup never trips the implicit cap.
fn fund_n_boundaries(reg: &mut VaultRegistry, vault_id: &VaultId, n: u64, rate: u128, t0: u64, max_end: u64) {
    for k in 0..n {
        reg.on_fund(acct(1000 + k), vault_id, SIDE_YES, U256::from(rate), max_end, t0)
            .expect("funding a future-max_end lane on a caught-up board never trips the cap");
    }
    assert_eq!(reg.pending_boundaries(vault_id, SIDE_YES), n);
}

/// A backlog of `cap + 1` elapsed boundaries bricks the implicit path with a typed
/// error and no board mutation; the bounded drain clears it and the op then succeeds,
/// with the pool conserving every streamed unit exactly.
#[test]
fn over_cap_backlog_errors_board_behind_without_mutation_then_drains() {
    let cap = MAX_IMPLICIT_CATCHUP_STEPS;
    let n = cap + 1; // one past the ceiling → the implicit catch-up must refuse

    let mut reg = VaultRegistry::default();
    let t0 = 100u64;
    let rate = USD; // $1/s per lane — realistic scale, non-flat curve
    let dur = 100u64;
    let max_end = t0 + dur;

    let vault_id = reg
        .create_vault([9u8; 32], b"bounded catch-up?".to_vec(), [1u8; 32], t0)
        .unwrap();
    fund_n_boundaries(&mut reg, &vault_id, n, rate, t0, max_end);

    // Time jumps far past every max_end: all `n` boundaries are now due.
    let now = max_end + 500;

    // Snapshot the board (both sides) + boundary queue BEFORE the failing op.
    let board_yes_before = reg.get_board(&vault_id, SIDE_YES);
    let board_no_before = reg.get_board(&vault_id, SIDE_NO);
    let pending_yes_before = reg.pending_boundaries(&vault_id, SIDE_YES);

    // An op (fund) hitting the over-cap board fails typed BoardBehind ...
    let newcomer = acct(9999);
    let err = reg
        .on_fund(newcomer, &vault_id, SIDE_YES, U256::from(rate), now + dur, now)
        .unwrap_err();
    assert_eq!(err, VaultError::BoardBehind);

    // ... and the board is byte-for-byte what it was: no partial advance escaped.
    assert_eq!(reg.get_board(&vault_id, SIDE_YES), board_yes_before);
    assert_eq!(reg.get_board(&vault_id, SIDE_NO), board_no_before);
    assert_eq!(reg.pending_boundaries(&vault_id, SIDE_YES), pending_yes_before);
    // last_advance in particular is untouched (== t0, the funding time).
    assert_eq!(board_yes_before.3, t0);

    // Drain the backlog with the uncapped, per-call-bounded advance entrypoint.
    let mut calls = 0u64;
    while !reg.caught_up(&vault_id, SIDE_YES, now) {
        reg.advance(&vault_id, SIDE_YES, MAX_STEPS, now).unwrap();
        calls += 1;
        assert!(calls < UNLIMITED_STEPS, "drain must terminate");
    }

    // Board is now caught up: every lane depleted, schedule empty.
    let (pool, side_rate, _g, last_advance) = reg.get_board(&vault_id, SIDE_YES);
    assert_eq!(side_rate, U256::ZERO);
    assert_eq!(reg.pending_boundaries(&vault_id, SIDE_YES), 0);
    assert_eq!(last_advance, now);

    // Conservation: the pool grew by exactly (all lanes' rate) × (their live seconds).
    // Every lane streamed `rate` for `dur` seconds before depleting at max_end, so the
    // pool holds `n × rate × dur` units — each streamed unit banked once, no leak/dup.
    assert_eq!(pool, U256::from(n as u128 * rate * dur as u128));

    // The op that previously bricked now succeeds against the caught-up board.
    reg.on_fund(newcomer, &vault_id, SIDE_YES, U256::from(rate), now + dur, now)
        .expect("fund succeeds once the backlog is drained");
    let (r, ..) = reg.get_position(&vault_id, SIDE_YES, newcomer);
    assert_eq!(r, U256::from(rate));
}

/// The boundary condition: a backlog of exactly `cap` elapsed boundaries is within the
/// implicit budget and must NOT trip — the cap only catches pathological idle, and
/// clears every normal test/demo timescale.
#[test]
fn at_cap_backlog_is_absorbed_implicitly() {
    let cap = MAX_IMPLICIT_CATCHUP_STEPS;

    let mut reg = VaultRegistry::default();
    let t0 = 100u64;
    let rate = USD;
    let dur = 100u64;
    let max_end = t0 + dur;

    let vault_id = reg
        .create_vault([7u8; 32], b"at-cap?".to_vec(), [1u8; 32], t0)
        .unwrap();
    fund_n_boundaries(&mut reg, &vault_id, cap, rate, t0, max_end);

    let now = max_end + 500;

    // An implicit op (stop) drives the whole `cap`-deep backlog through in one call —
    // no BoardBehind — leaving the board caught up.
    reg.on_stop(acct(1000), &vault_id, SIDE_YES, now).unwrap();
    assert!(reg.caught_up(&vault_id, SIDE_YES, now));

    let (pool, side_rate, ..) = reg.get_board(&vault_id, SIDE_YES);
    assert_eq!(side_rate, U256::ZERO);
    assert_eq!(pool, U256::from(cap as u128 * rate * dur as u128));
    assert_eq!(reg.pending_boundaries(&vault_id, SIDE_YES), 0);
}
