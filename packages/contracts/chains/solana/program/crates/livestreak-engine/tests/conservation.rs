//! Engine-level conservation spec (the vault-level Sui seed suite lands with the
//! vault module; these pin the streams engine itself, same seeded-walk style).
//!
//! Invariant: every unit deposited is exactly accounted for —
//!   deposits == withdrawals + received + squeezed + remaining balance.
//! Exactness (not tolerance) is the point: the floor-pair streamed_amt makes
//! every split lossless, so conservation must hold to the unit.

use ruint::aliases::U256;
use livestreak_engine::*;

const CYCLE: u64 = 10;
const RATE_1: u128 = AMT_PER_SEC_MULTIPLIER; // 1 unit/sec, scaled

fn acct(n: u64) -> AccountId {
    U256::from(n)
}

fn recv(n: u64, rate_units_per_sec: u128) -> StreamReceiver {
    StreamReceiver {
        account_id: acct(n),
        config: StreamConfig {
            stream_id: 0,
            amt_per_sec: U256::from(rate_units_per_sec * RATE_1),
            start: 0,
            duration: 0,
        },
    }
}

fn mix(seed: u64, i: u64, salt: u64) -> u64 {
    (seed ^ salt)
        .wrapping_mul(6364136223846793005)
        .wrapping_add(i.wrapping_mul(1442695040888963407))
        >> 33
}

#[test]
fn single_stream_conserves_exactly() {
    let mut reg = StreamsRegistry::new(CYCLE).unwrap();
    let deposit: i128 = 1_000_003; // deliberately not a multiple of the rate
    let t0 = 25;

    let applied = reg
        .set_streams(acct(1), &[], deposit, &[recv(2, 7)], 0, 0, t0)
        .unwrap();
    assert_eq!(applied, deposit);

    let (_, _, _, _, max_end) = reg.streams_state(acct(1));
    let t_end = max_end + 3 * CYCLE;

    let received = reg.receive_streams(acct(2), u64::MAX, t_end);
    let remaining = reg.balance_at(acct(1), &[recv(2, 7)], t_end).unwrap();

    assert!(received > 0);
    assert_eq!(received as i128 + remaining as i128, deposit);
}

#[test]
fn reconfigure_mid_flight_conserves_exactly() {
    let mut reg = StreamsRegistry::new(CYCLE).unwrap();
    let deposit: i128 = 5_000_000;
    let t0 = 100;

    // A -> {B@3/s, C@5/s}, then at t0+13 reroute everything to C@11/s.
    let first = [recv(2, 3), recv(3, 5)];
    reg.set_streams(acct(1), &[], deposit, &first, 0, 0, t0).unwrap();
    let second = [recv(3, 11)];
    reg.set_streams(acct(1), &first, 0, &second, 0, 0, t0 + 13).unwrap();

    let (_, _, _, _, max_end) = reg.streams_state(acct(1));
    let t_end = max_end + 3 * CYCLE;

    let received_b = reg.receive_streams(acct(2), u64::MAX, t_end);
    let received_c = reg.receive_streams(acct(3), u64::MAX, t_end);
    let remaining = reg.balance_at(acct(1), &second, t_end).unwrap();

    assert!(received_b > 0 && received_c > 0);
    assert_eq!(
        received_b as i128 + received_c as i128 + remaining as i128,
        deposit
    );
}

#[test]
fn receive_is_idempotent() {
    let mut reg = StreamsRegistry::new(CYCLE).unwrap();
    reg.set_streams(acct(1), &[], 1_000_000, &[recv(2, 7)], 0, 0, 0).unwrap();
    let t = 5 * CYCLE;
    let first = reg.receive_streams(acct(2), u64::MAX, t);
    assert!(first > 0);
    assert_eq!(reg.receive_streams(acct(2), u64::MAX, t), 0);
}

#[test]
fn squeeze_then_receive_never_double_counts() {
    let mut reg = StreamsRegistry::new(CYCLE).unwrap();
    let deposit: i128 = 1_000_000;
    let t0 = 20; // cycle-aligned start of cycle 3
    let receivers = [recv(2, 7)];
    reg.set_streams(acct(1), &[], deposit, &receivers, 0, 0, t0).unwrap();
    let (_, _, _, _, max_end) = reg.streams_state(acct(1));

    // Mid-cycle squeeze at t0+7 (same cycle as the config).
    let history = [StreamsHistory {
        streams_hash: Vec::new(),
        receivers: receivers.to_vec(),
        update_time: t0,
        max_end,
    }];
    let squeezed = reg
        .squeeze_streams(acct(2), acct(1), Vec::new(), &history, t0 + 7)
        .unwrap();
    assert_eq!(squeezed, 7 * 7); // 7 seconds at 7 units/s

    // Squeezing again in the same instant yields nothing.
    let again = reg
        .squeeze_streams(acct(2), acct(1), Vec::new(), &history, t0 + 7)
        .unwrap();
    assert_eq!(again, 0);

    // Drain everything after max_end: squeezed + received + remaining == deposit.
    let t_end = max_end + 3 * CYCLE;
    let received = reg.receive_streams(acct(2), u64::MAX, t_end);
    let remaining = reg.balance_at(acct(1), &receivers, t_end).unwrap();
    assert_eq!(
        squeezed as i128 + received as i128 + remaining as i128,
        deposit
    );
}

/// Seeded pseudo-random walks (Sui run_conservation_seed style): interleaved
/// top-ups, withdrawals, and receiver reconfigurations, then full drain.
#[test]
fn seeded_walks_conserve_exactly() {
    for seed in 1..=8u64 {
        let mut reg = StreamsRegistry::new(CYCLE).unwrap();
        let sender = acct(1);
        let mut now = 50;
        let mut deposits: i128 = 0;
        let mut withdrawn: i128 = 0;
        let mut received: i128 = 0;
        let mut curr: Vec<StreamReceiver> = Vec::new();

        let steps = 3 + (seed % 5);
        for i in 0..steps {
            let op = mix(seed, i, 0) % 4;
            match op {
                0 | 1 => {
                    // Top up + (re)configure receivers.
                    let d = (2 + (mix(seed, i, 1) % 18)) as i128 * 10_000;
                    let next: Vec<StreamReceiver> = match mix(seed, i, 2) % 3 {
                        0 => vec![recv(2, 3)],
                        1 => vec![recv(2, 3), recv(3, 5)],
                        _ => vec![recv(3, 11)],
                    };
                    let applied = reg
                        .set_streams(sender, &curr, d, &next, 0, 0, now)
                        .unwrap();
                    deposits += applied;
                    curr = next;
                }
                2 => {
                    // Withdraw (capped by the engine at the live balance).
                    let w = -((mix(seed, i, 3) % 40_000) as i128);
                    let applied = reg
                        .set_streams(sender, &curr, w, &curr.clone(), 0, 0, now)
                        .unwrap();
                    withdrawn += -applied;
                }
                _ => {
                    // Mid-walk receive by B (must not break conservation).
                    received += reg.receive_streams(acct(2), u64::MAX, now) as i128;
                }
            }
            now += 1 + (mix(seed, i, 4) % 7);
        }

        // Drain: far past any max_end, everyone receives, sender keeps the rest.
        let (_, _, _, _, max_end) = reg.streams_state(sender);
        let t_end = if max_end == u64::MAX { now + 100_000 } else { max_end + 100_000 };
        received += reg.receive_streams(acct(2), u64::MAX, t_end) as i128;
        received += reg.receive_streams(acct(3), u64::MAX, t_end) as i128;
        let remaining = reg.balance_at(sender, &curr, t_end).unwrap() as i128;

        // The ledger closes to the unit, and nothing stays receivable.
        assert_eq!(deposits, withdrawn + received + remaining, "seed {seed}");
        assert_eq!(reg.receive_streams(acct(2), u64::MAX, t_end), 0, "seed {seed}");
        assert_eq!(reg.receive_streams(acct(3), u64::MAX, t_end), 0, "seed {seed}");
    }
}
