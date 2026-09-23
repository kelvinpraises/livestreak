//! Engine core — 1:1 port of streams.move (constructors, core utilities so far;
//! receive/squeeze/set_streams land in the following sections of the port).

use ruint::aliases::U256;

extern crate alloc;

use crate::state::*;

pub const MAX_U64: u64 = u64::MAX;

impl StreamsRegistry {
    /// Move create_registry: cycle_secs > 1; min = ceil(multiplier / cycle_secs).
    pub fn new(cycle_secs: u64) -> StreamsResult<Self> {
        if cycle_secs <= 1 {
            return Err(StreamsError::CycleSecsTooLow);
        }
        let multiplier = U256::from(AMT_PER_SEC_MULTIPLIER);
        let min_amt_per_sec =
            (multiplier + U256::from(cycle_secs) - U256::from(1u8)) / U256::from(cycle_secs);
        Ok(Self {
            cycle_secs,
            min_amt_per_sec,
            states: Default::default(),
            amt_deltas: Default::default(),
            next_squeezed: Default::default(),
        })
    }

    /// Cycle containing ts. Never cycle 0.
    pub fn cycle_of(&self, ts: u64) -> u64 {
        ts / self.cycle_secs + 1
    }

    /// Start of the cycle containing `now`.
    pub fn curr_cycle_start(&self, now: u64) -> u64 {
        now - (now % self.cycle_secs)
    }
}

/// floor(end * rate / M) - floor(start * rate / M) — the engine's fundamental quantum.
///
/// Hot-path narrowing (doctrine: only WITH the conservation net green): when the
/// products provably fit u128 (checked_mul — no silent assumption), compute narrow;
/// the U256 fallback stays for the max_end binary search's u64::MAX-scale probes.
/// Both paths are the identical floor-pair expression.
pub fn streamed_amt(amt_per_sec: U256, start: u64, end: u64) -> U256 {
    if end <= start {
        return U256::ZERO;
    }
    if amt_per_sec <= U256::from(u128::MAX) {
        let aps = amt_per_sec.to::<u128>();
        if let (Some(pe), Some(ps)) =
            ((end as u128).checked_mul(aps), (start as u128).checked_mul(aps))
        {
            return U256::from(pe / AMT_PER_SEC_MULTIPLIER - ps / AMT_PER_SEC_MULTIPLIER);
        }
    }
    let m = U256::from(AMT_PER_SEC_MULTIPLIER);
    let amt_end = U256::from(end) * amt_per_sec / m;
    let amt_start = U256::from(start) * amt_per_sec / m;
    amt_end - amt_start
}

/// Receiver's streamed window, capped to [start_cap, end_cap].
pub fn stream_range(
    config: &StreamConfig,
    update_time: u64,
    max_end: u64,
    start_cap: u64,
    end_cap: u64,
) -> (u64, u64) {
    let stream_start = if config.start == 0 { update_time } else { config.start };
    let mut stream_end = stream_start.saturating_add(config.duration);
    if stream_end == stream_start || stream_end > max_end {
        stream_end = max_end;
    }
    let start = stream_start.max(start_cap);
    let end = stream_end.min(end_cap).max(start);
    (start, end)
}

pub fn stream_range_in_future(
    receiver: &StreamReceiver,
    update_time: u64,
    max_end: u64,
    now: u64,
) -> (u64, u64) {
    stream_range(&receiver.config, update_time, max_end, now, MAX_U64)
}

/// Receiver ordering: account_id, then config lexicographically.
pub fn is_ordered(prev: &StreamReceiver, next: &StreamReceiver) -> bool {
    if prev.account_id != next.account_id {
        return prev.account_id < next.account_id;
    }
    config_lt(&prev.config, &next.config)
}

fn config_lt(a: &StreamConfig, b: &StreamConfig) -> bool {
    if a.stream_id != b.stream_id {
        return a.stream_id < b.stream_id;
    }
    if a.amt_per_sec != b.amt_per_sec {
        return a.amt_per_sec < b.amt_per_sec;
    }
    if a.start != b.start {
        return a.start < b.start;
    }
    a.duration < b.duration
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_min_rate_is_one_token_per_cycle() {
        let r = StreamsRegistry::new(3600).unwrap();
        // ceil(1e9 / 3600) = 277_778
        assert_eq!(r.min_amt_per_sec, U256::from(277_778u64));
        assert!(StreamsRegistry::new(1).is_err());
    }

    #[test]
    fn streamed_amt_floor_pair_never_overcounts() {
        // rate 1.5 tokens/s (1_500_000_000 scaled): floor-pair over [0,3] = 4 units... no:
        // floor(3*1.5)-floor(0)=4. Split at t=1: floor(1.5)=1, then floor(4.5)-floor(1.5)=3.
        // Total identical — the floor-pair form makes split points lossless.
        let rate = U256::from(1_500_000_000u64);
        let whole = streamed_amt(rate, 0, 3);
        let split = streamed_amt(rate, 0, 1) + streamed_amt(rate, 1, 3);
        assert_eq!(whole, split);
        assert_eq!(whole, U256::from(4u8));
    }

    #[test]
    fn stream_range_caps_and_zero_start_uses_update_time() {
        let cfg = StreamConfig { stream_id: 0, amt_per_sec: U256::from(1u8), start: 0, duration: 0 };
        // start=0 → update_time; duration=0 → forever → capped at max_end.
        assert_eq!(stream_range(&cfg, 100, 500, 0, MAX_U64), (100, 500));
        let cfg2 = StreamConfig { stream_id: 0, amt_per_sec: U256::from(1u8), start: 200, duration: 50 };
        assert_eq!(stream_range(&cfg2, 100, 500, 220, 240), (220, 240));
        // end below start clamps to start (empty range).
        assert_eq!(stream_range(&cfg2, 100, 500, 260, 240), (260, 260));
    }

    // The delta-jump `process_cycles` must return the EXACT same (received, rate) as the naive
    // per-cycle loop it replaced — including across a 100k-cycle idle gap (which the loop walks
    // one-by-one and the delta form skips in O(1)) — and must NOT leak a neighbouring account's
    // deltas. The naive loop is kept here as the reference oracle. See the warning on process_cycles.
    #[test]
    fn delta_jump_matches_naive_loop() {
        use alloc::collections::BTreeMap;

        fn naive(
            amt_deltas: &BTreeMap<(AccountId, u64), AmtDelta>,
            account_id: AccountId,
            from_cycle: u64,
            to_cycle: u64,
            received_amt: u128,
            amt_per_cycle: i128,
        ) -> (u128, i128) {
            let mut acc_received = received_amt;
            let mut acc_rate = amt_per_cycle;
            for cycle in from_cycle..to_cycle {
                if let Some(delta) = amt_deltas.get(&(account_id, cycle)) {
                    acc_rate += delta.this_cycle;
                    acc_received += u128::try_from(acc_rate).expect("negative cycle rate");
                    acc_rate += delta.next_cycle;
                } else {
                    acc_received += u128::try_from(acc_rate).expect("negative cycle rate");
                }
            }
            (acc_received, acc_rate)
        }

        let acct = U256::from(7u8);
        let other = U256::from(99u8); // deltas here must be invisible to `acct`'s receive
        let mut d: BTreeMap<(AccountId, u64), AmtDelta> = BTreeMap::new();
        // Rate rises at cycle 3 (partial-cycle split), then the stream ends at cycle 100.
        d.insert((acct, 3), AmtDelta { this_cycle: 10, next_cycle: -2 });
        d.insert((acct, 100), AmtDelta { this_cycle: -8, next_cycle: 0 });
        // Neighbour account with big deltas INSIDE the same window — a bad range bound would leak these.
        d.insert((other, 50), AmtDelta { this_cycle: 500, next_cycle: 500 });

        // (from, to, seed_rate): small window, 100k-cycle idle gap, mid-run start, empty, single-cycle,
        // pure trailing-zero tail after the stream ended.
        for &(from, to, seed) in &[
            (0u64, 6u64, 5i128),
            (0, 100_000, 5),
            (4, 120, 13),
            (200, 200, 0),
            (3, 4, 0),
            (101, 100_000, 0),
        ] {
            assert_eq!(
                process_cycles(&d, acct, from, to, 0, seed),
                naive(&d, acct, from, to, 0, seed),
                "delta-jump != naive for [{from},{to}) seed={seed}",
            );
        }
    }
}

// ── Cycle accumulation (Move process_cycles) ────────────────────────────────────
//
// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  ⚠  SOLANA-ONLY DIVERGENCE — DELTA-JUMP RECEIVE — NOT PARITY WITH EVM / SUI  ⚠ ║
// ║  ⚠  MONEY MATH: SCRUTINIZE FOR BUGS BEFORE TRUSTING THIS PATH               ⚠ ║
// ╚══════════════════════════════════════════════════════════════════════════════╝
//
// EVM (`Streams.sol::_receiveStreamsResult`) and Sui (Move) still receive by LOOPING
// EVERY cycle from `from` to `to` — the faithful Radicle Drips shape. That is
// O(cycles-elapsed): with our cycle_secs = 10, a vault left idle mints ~8,640
// cycles/day, and the loop replays each as a `+= rate` — the vast majority `+= 0`
// once every stream has ended. That is what blew Solana's `collect` past the 1.4M CU
// ceiling ("exceeded CUs meter"): hundreds of iterations adding zero.
//
// This Solana version is DELTA-BASED. `amt_deltas` only holds entries where the rate
// CHANGES (one per fund / depletion — a handful). Between two such entries the rate is
// constant, so a K-cycle run is ONE multiply (`rate × K`) instead of K identical
// additions. Repeated addition of a constant IS multiplication, so the RESULT is
// byte-identical to the loop — only the step count collapses from O(cycles) to
// O(rate-changes). Idle time and cycle length stop costing compute.
//
// ⚠  PARITY: this makes Solana's cycle accounting DIVERGE from the EVM/Sui ports (they
//    still loop). A FUTURE pass must port the same delta-jump into `Streams.sol` and the
//    Move engine, then cross-check all three against shared fixtures. Until then Solana
//    is the odd one out — re-verify any conservation invariant on THIS path specifically.
//
// ⚠  BUGS TO WATCH (the `delta_jump_matches_naive_loop` test pins these):
//    1. the BTreeMap range must select EXACTLY this account's deltas in [from,to) —
//       a wrong bound leaks another account's cycles or drops one;
//    2. an empty run must accumulate `acc_rate` as it stood BEFORE the next delta's
//       `this_cycle` is applied;
//    3. the TRAILING run (last delta cycle+1 .. to) is easy to forget;
//    4. a negative `acc_rate` must still panic exactly as the loop's per-cycle
//       `try_from` did — never silently coerce.

/// Sum the amount received over cycles [from, to), folding rate-change deltas — delta-jump
/// (O(rate-changes)), byte-identical to the naive per-cycle loop. See the warning above.
pub fn process_cycles(
    amt_deltas: &alloc::collections::BTreeMap<(AccountId, u64), AmtDelta>,
    account_id: AccountId,
    from_cycle: u64,
    to_cycle: u64,
    received_amt: u128,
    amt_per_cycle: i128,
) -> (u128, i128) {
    let mut acc_received = received_amt;
    let mut acc_rate = amt_per_cycle;
    // `next` = first cycle in [from,to) not yet accounted for. Walk ONLY the delta-bearing
    // cycles for this account; collapse each constant-rate gap between them into one multiply.
    let mut next = from_cycle;
    for (&(_, cycle), delta) in amt_deltas.range((account_id, from_cycle)..(account_id, to_cycle)) {
        // Constant-rate run [next, cycle): `acc_rate` added `cycle - next` times == one multiply.
        if cycle > next {
            let rate = u128::try_from(acc_rate).expect("negative cycle rate");
            acc_received += rate * u128::from(cycle - next);
        }
        // The delta cycle itself — byte-identical to the loop's `Some(delta)` branch.
        acc_rate += delta.this_cycle;
        acc_received += u128::try_from(acc_rate).expect("negative cycle rate");
        acc_rate += delta.next_cycle;
        next = cycle + 1;
    }
    // Trailing constant-rate run [next, to): the empty tail after the last rate change.
    if to_cycle > next {
        let rate = u128::try_from(acc_rate).expect("negative cycle rate");
        acc_received += rate * u128::from(to_cycle - next);
    }
    (acc_received, acc_rate)
}

// ── Hash chain (Move hash_streams / hash_streams_history) ───────────────────────
//
// blake2b-256 like the Move source. The preimage encoding is this engine's own
// canonical fixed-width layout, NOT Sui's BCS: these hashes never leave the chain
// they were written on — they only need to be internally consistent + collision
// resistant. (EVM uses keccak/abi for the same role; the chains never compare.)

use blake2::digest::consts::U32;
use blake2::{Blake2b, Digest};

type Blake2b256 = Blake2b<U32>;

pub fn hash_streams(receivers: &[StreamReceiver]) -> alloc::vec::Vec<u8> {
    if receivers.is_empty() {
        return alloc::vec::Vec::new();
    }
    let mut h = Blake2b256::new();
    for r in receivers {
        h.update(r.account_id.to_be_bytes::<32>());
        h.update(r.config.stream_id.to_le_bytes());
        h.update(r.config.amt_per_sec.to_be_bytes::<32>());
        h.update(r.config.start.to_le_bytes());
        h.update(r.config.duration.to_le_bytes());
    }
    h.finalize().to_vec()
}

pub fn hash_streams_history(
    old_streams_history_hash: &[u8],
    streams_hash: &[u8],
    update_time: u64,
    max_end: u64,
) -> alloc::vec::Vec<u8> {
    let mut h = Blake2b256::new();
    h.update(old_streams_history_hash);
    h.update(streams_hash);
    h.update(update_time.to_le_bytes());
    h.update(max_end.to_le_bytes());
    h.finalize().to_vec()
}

// ── Config preprocessing (Move build_configs) ───────────────────────────────────

impl StreamsRegistry {
    /// Validate ordering + min rate, window each receiver to the future, skip expired.
    pub fn build_configs(
        &self,
        receivers: &[StreamReceiver],
        now: u64,
    ) -> StreamsResult<alloc::vec::Vec<ProcessedConfig>> {
        if receivers.len() > MAX_STREAMS_RECEIVERS {
            return Err(StreamsError::TooManyReceivers);
        }
        let mut configs = alloc::vec::Vec::new();
        for (i, receiver) in receivers.iter().enumerate() {
            if i > 0 && !is_ordered(&receivers[i - 1], receiver) {
                return Err(StreamsError::ReceiversNotSorted);
            }
            if receiver.config.amt_per_sec < self.min_amt_per_sec {
                return Err(StreamsError::AmtPerSecTooLow);
            }
            let (start, end) = stream_range_in_future(receiver, now, MAX_U64, now);
            if start != end {
                configs.push(ProcessedConfig {
                    amt_per_sec: receiver.config.amt_per_sec,
                    start,
                    end,
                });
            }
        }
        Ok(configs)
    }
}

// ── Hash verification (Move verify_streams_receivers / verify_streams_history) ──

pub fn verify_streams_receivers(
    receivers: &[StreamReceiver],
    state: &StreamsState,
) -> StreamsResult<()> {
    if hash_streams(receivers) != state.streams_hash {
        return Err(StreamsError::InvalidStreamsReceivers);
    }
    Ok(())
}

/// Verify a history chain; returns the hash valid BEFORE each entry (for squeezing).
pub fn verify_streams_history(
    history_hash: alloc::vec::Vec<u8>,
    streams_history: &[StreamsHistory],
    final_history_hash: &[u8],
) -> StreamsResult<alloc::vec::Vec<alloc::vec::Vec<u8>>> {
    let mut history_hashes = alloc::vec::Vec::new();
    let mut current_hash = history_hash;
    for entry in streams_history {
        let streams_hash = if !entry.receivers.is_empty() {
            if !entry.streams_hash.is_empty() {
                return Err(StreamsError::EntryWithHashAndReceivers);
            }
            hash_streams(&entry.receivers)
        } else {
            entry.streams_hash.clone()
        };
        history_hashes.push(current_hash.clone());
        current_hash =
            hash_streams_history(&current_hash, &streams_hash, entry.update_time, entry.max_end);
    }
    if current_hash != final_history_hash {
        return Err(StreamsError::InvalidStreamsHistory);
    }
    Ok(history_hashes)
}

// ── Delta accounting (Move add_delta / add_delta_range) ─────────────────────────
//
// Signed-256 site: transliterated via ethnum I256 (division truncates toward zero,
// matching the Move i256 emulation and Solidity int256). The i128 storage cast is
// the same bit-truncation as Move i128::from_bits(i256::as_i128(..)).

use ethnum::I256;

fn cycle_of_secs(ts: u64, cycle_secs: u64) -> u64 {
    ts / cycle_secs + 1
}

pub fn add_delta(
    amt_deltas: &mut alloc::collections::BTreeMap<(AccountId, u64), AmtDelta>,
    account_id: AccountId,
    timestamp: u64,
    amt_per_sec: I256,
    cycle_secs: u64,
) {
    let multiplier = I256::from(AMT_PER_SEC_MULTIPLIER);
    let full_cycle = I256::from(cycle_secs) * amt_per_sec / multiplier;
    let remainder = timestamp % cycle_secs;
    let next_cycle = I256::from(remainder) * amt_per_sec / multiplier;
    let cycle = cycle_of_secs(timestamp, cycle_secs);

    let delta = amt_deltas.entry((account_id, cycle)).or_default();
    delta.this_cycle += (full_cycle - next_cycle).as_i128();
    delta.next_cycle += next_cycle.as_i128();
}

/// Apply a rate over [start, end): +delta at start, -delta at end.
pub fn add_delta_range(
    amt_deltas: &mut alloc::collections::BTreeMap<(AccountId, u64), AmtDelta>,
    account_id: AccountId,
    start: u64,
    end: u64,
    amt_per_sec: I256,
    cycle_secs: u64,
) {
    if start == end {
        return;
    }
    add_delta(amt_deltas, account_id, start, amt_per_sec, cycle_secs);
    add_delta(amt_deltas, account_id, end, -amt_per_sec, cycle_secs);
}

// ── Receiver-state diffing (Move update_receiver_states) ────────────────────────

/// Move casts rate u256 -> u128 with an aborting `as` cast before signing; narrow()
/// is the same abort, then the value signs into I256 losslessly.
fn rate_i256(amt_per_sec: U256) -> I256 {
    I256::from(livestreak_math::wide::narrow(amt_per_sec, "amt_per_sec"))
}

impl StreamsRegistry {
    fn ensure_state_exists(&mut self, account_id: AccountId) {
        self.states.entry(account_id).or_default();
    }

    /// Two-pointer merge diffing old vs new receiver lists; adjusts deltas and
    /// next_receivable_cycle per account. 1:1 with the Move control flow.
    #[allow(clippy::too_many_arguments)]
    pub fn update_receiver_states(
        &mut self,
        curr_receivers: &[StreamReceiver],
        last_update: u64,
        curr_max_end: u64,
        new_receivers: &[StreamReceiver],
        new_max_end: u64,
        now: u64,
    ) {
        let cycle_secs = self.cycle_secs;
        let mut curr_idx = 0usize;
        let mut new_idx = 0usize;

        loop {
            let mut pick_curr = curr_idx < curr_receivers.len();
            let mut pick_new = new_idx < new_receivers.len();
            if !pick_curr && !pick_new {
                break;
            }

            let default_recv = StreamReceiver {
                account_id: U256::ZERO,
                config: StreamConfig {
                    stream_id: 0,
                    amt_per_sec: U256::ZERO,
                    start: 0,
                    duration: 0,
                },
            };
            let curr_recv = if pick_curr { curr_receivers[curr_idx] } else { default_recv };
            let new_recv = if pick_new { new_receivers[new_idx] } else { default_recv };

            // Pick both only when they differ solely by time window.
            if pick_curr && pick_new {
                if curr_recv.account_id != new_recv.account_id
                    || curr_recv.config.amt_per_sec != new_recv.config.amt_per_sec
                {
                    pick_curr = is_ordered(&curr_recv, &new_recv);
                    pick_new = !pick_curr;
                }
            }

            if pick_curr && pick_new {
                // Shift the existing stream: adjust only the start and end deltas.
                self.ensure_state_exists(curr_recv.account_id);
                let (curr_start, curr_end) =
                    stream_range(&curr_recv.config, last_update, curr_max_end, now, MAX_U64);
                let (new_start, new_end) =
                    stream_range(&new_recv.config, now, new_max_end, now, MAX_U64);
                let amt = rate_i256(curr_recv.config.amt_per_sec);

                add_delta_range(
                    &mut self.amt_deltas, curr_recv.account_id,
                    curr_start, new_start, -amt, cycle_secs,
                );
                add_delta_range(
                    &mut self.amt_deltas, curr_recv.account_id,
                    curr_end, new_end, amt, cycle_secs,
                );

                let curr_start_cycle = cycle_of_secs(curr_start, cycle_secs);
                let new_start_cycle = cycle_of_secs(new_start, cycle_secs);
                let state = self.states.get_mut(&curr_recv.account_id).unwrap();
                if curr_start_cycle > new_start_cycle
                    && state.next_receivable_cycle > new_start_cycle
                {
                    state.next_receivable_cycle = new_start_cycle;
                }
                curr_idx += 1;
                new_idx += 1;
            } else if pick_curr {
                // Remove an existing stream.
                self.ensure_state_exists(curr_recv.account_id);
                let (start, end) =
                    stream_range(&curr_recv.config, last_update, curr_max_end, now, MAX_U64);
                let amt = rate_i256(curr_recv.config.amt_per_sec);
                add_delta_range(
                    &mut self.amt_deltas, curr_recv.account_id, start, end, -amt, cycle_secs,
                );
                curr_idx += 1;
            } else {
                // Create a new stream.
                self.ensure_state_exists(new_recv.account_id);
                let (start, end) =
                    stream_range(&new_recv.config, now, new_max_end, now, MAX_U64);
                let amt = rate_i256(new_recv.config.amt_per_sec);
                add_delta_range(
                    &mut self.amt_deltas, new_recv.account_id, start, end, amt, cycle_secs,
                );
                let start_cycle = cycle_of_secs(start, cycle_secs);
                let state = self.states.get_mut(&new_recv.account_id).unwrap();
                if state.next_receivable_cycle == 0 || state.next_receivable_cycle > start_cycle {
                    state.next_receivable_cycle = start_cycle;
                }
                new_idx += 1;
            }
        }
    }
}

// ── Balance & max-end (Move balance_at / calc_balance / calc_max_end) ──────────

impl StreamsRegistry {
    /// Stored streaming balance for an account (position token) — the remaining shared budget it
    /// streams from, as of the last set_streams/fund. Matches EVM `streamsState(id).balance` and the
    /// Move `balance` field (a lower bound between updates; a live read would subtract streamed-since).
    /// 0 when the account has never been funded.
    pub fn state_balance(&self, account_id: AccountId) -> u128 {
        self.states.get(&account_id).map(|st| st.balance).unwrap_or(0)
    }

    /// Account balance at `timestamp` (>= update_time), receivers must match hash.
    pub fn balance_at(
        &self,
        account_id: AccountId,
        curr_receivers: &[StreamReceiver],
        timestamp: u64,
    ) -> StreamsResult<u128> {
        let Some(state) = self.states.get(&account_id) else {
            return Ok(0);
        };
        if timestamp < state.update_time {
            return Err(StreamsError::TimestampBeforeUpdate);
        }
        verify_streams_receivers(curr_receivers, state)?;
        Ok(calc_balance(
            state.balance,
            state.update_time,
            state.max_end,
            curr_receivers,
            timestamp,
        ))
    }

    /// Binary-search the timestamp funds run out (with two search hints).
    pub fn calc_max_end(
        &self,
        balance: u128,
        receivers: &[StreamReceiver],
        hint1: u64,
        hint2: u64,
        now: u64,
    ) -> StreamsResult<u64> {
        let configs = self.build_configs(receivers, now)?;
        let min_guaranteed_end = now;
        if configs.is_empty() || balance == 0 {
            return Ok(min_guaranteed_end);
        }
        if is_balance_enough(balance, &configs, MAX_U64) {
            return Ok(MAX_U64);
        }

        let mut enough_end = min_guaranteed_end;
        let mut not_enough_end = MAX_U64;

        for hint in [hint1, hint2] {
            if hint > enough_end && hint < not_enough_end {
                if is_balance_enough(balance, &configs, hint) {
                    enough_end = hint;
                } else {
                    not_enough_end = hint;
                }
            }
        }

        loop {
            // u64 midpoint without overflow (Move widens to u256 for this).
            let mid = enough_end + (not_enough_end - enough_end) / 2;
            if mid == enough_end {
                return Ok(mid);
            }
            if is_balance_enough(balance, &configs, mid) {
                enough_end = mid;
            } else {
                not_enough_end = mid;
            }
        }
    }
}

/// last_balance minus everything streamed in [last_update, timestamp].
fn calc_balance(
    last_balance: u128,
    last_update: u64,
    max_end: u64,
    receivers: &[StreamReceiver],
    timestamp: u64,
) -> u128 {
    let mut balance = U256::from(last_balance);
    for receiver in receivers {
        let (start, end) =
            stream_range(&receiver.config, last_update, max_end, last_update, timestamp);
        balance -= streamed_amt(receiver.config.amt_per_sec, start, end);
    }
    livestreak_math::wide::narrow(balance, "balance")
}

fn is_balance_enough(balance: u128, configs: &[ProcessedConfig], max_end: u64) -> bool {
    let mut spent = U256::ZERO;
    let balance_wide = U256::from(balance);
    for config in configs {
        if max_end <= config.start {
            continue;
        }
        let end = config.end.min(max_end);
        spent += streamed_amt(config.amt_per_sec, config.start, end);
        if spent > balance_wide {
            return false;
        }
    }
    true
}

// ── Receiving (Move receivable_streams_cycles / receive_streams) ────────────────

impl StreamsRegistry {
    fn receivable_streams_cycles_range(&self, account_id: AccountId, now: u64) -> (u64, u64) {
        let Some(state) = self.states.get(&account_id) else {
            return (0, 0);
        };
        let from_cycle = state.next_receivable_cycle;
        let to_cycle = self.cycle_of(now);
        if from_cycle == 0 || to_cycle < from_cycle {
            (from_cycle, from_cycle)
        } else {
            (from_cycle, to_cycle)
        }
    }

    pub fn receivable_streams_cycles(&self, account_id: AccountId, now: u64) -> u64 {
        let (from_cycle, to_cycle) = self.receivable_streams_cycles_range(account_id, now);
        to_cycle.saturating_sub(from_cycle)
    }

    /// (received_amt, receivable_cycles_left, from_cycle, to_cycle, amt_per_cycle).
    pub fn receive_streams_result(
        &self,
        account_id: AccountId,
        max_cycles: u64,
        now: u64,
    ) -> (u128, u64, u64, u64, i128) {
        let (from_cycle, to_cycle_raw) = self.receivable_streams_cycles_range(account_id, now);

        let (receivable_cycles, to_cycle) = if to_cycle_raw - from_cycle > max_cycles {
            let remaining = to_cycle_raw - from_cycle - max_cycles;
            (remaining, to_cycle_raw - remaining)
        } else {
            (0, to_cycle_raw)
        };

        let (received_amt, amt_per_cycle) =
            if self.states.contains_key(&account_id) && from_cycle < to_cycle {
                process_cycles(&self.amt_deltas, account_id, from_cycle, to_cycle, 0, 0)
            } else {
                (0, 0)
            };

        (received_amt, receivable_cycles, from_cycle, to_cycle, amt_per_cycle)
    }

    /// Receive from finished cycles; deletes drained deltas (unbounded-growth guard)
    /// and re-anchors the residual rate as an absolute delta on to_cycle.
    pub fn receive_streams(&mut self, account_id: AccountId, max_cycles: u64, now: u64) -> u128 {
        let (received_amt, _left, from_cycle, to_cycle, final_amt_per_cycle) =
            self.receive_streams_result(account_id, max_cycles, now);

        if from_cycle != to_cycle {
            self.ensure_state_exists(account_id);
            self.states.get_mut(&account_id).unwrap().next_receivable_cycle = to_cycle;

            for cycle in from_cycle..to_cycle {
                self.amt_deltas.remove(&(account_id, cycle));
            }

            if final_amt_per_cycle != 0 {
                let delta = self.amt_deltas.entry((account_id, to_cycle)).or_default();
                delta.this_cycle += final_amt_per_cycle;
            }
        }

        received_amt
    }
}

// ── Squeezing (Move squeeze_streams / squeeze_streams_result / squeezed_amt) ────

impl StreamsRegistry {
    /// (amt, squeezed_indexes oldest-to-newest, history_hashes, curr_cycle_configs).
    pub fn squeeze_streams_result(
        &self,
        account_id: AccountId,
        sender_id: AccountId,
        history_hash: alloc::vec::Vec<u8>,
        streams_history: &[StreamsHistory],
        now: u64,
    ) -> StreamsResult<(u128, alloc::vec::Vec<u64>, alloc::vec::Vec<alloc::vec::Vec<u8>>, u64)>
    {
        let final_history_hash = self
            .states
            .get(&sender_id)
            .map(|s| s.streams_history_hash.clone())
            .unwrap_or_default();

        let history_hashes =
            verify_streams_history(history_hash, streams_history, &final_history_hash)?;

        let curr_cycle_start_ts = self.curr_cycle_start(now);
        let curr_cycle_configs = match self.states.get(&sender_id) {
            Some(sender_state) if sender_state.update_time >= curr_cycle_start_ts => {
                sender_state.curr_cycle_configs
            }
            _ => 1,
        };

        let mut amt: u128 = 0;
        let mut squeezed_indexes = alloc::vec::Vec::new();
        let mut squeeze_end_cap = now;

        // Newest to oldest, at most curr_cycle_configs entries.
        let history_len = streams_history.len() as u64;
        let mut i: u64 = 1;
        while i <= history_len && i <= curr_cycle_configs {
            let entry = &streams_history[(history_len - i) as usize];
            if !entry.receivers.is_empty() {
                let next_squeezed_ts = self
                    .next_squeezed
                    .get(&(account_id, sender_id, curr_cycle_configs - i))
                    .copied()
                    .unwrap_or(0);
                let squeeze_start_cap =
                    next_squeezed_ts.max(curr_cycle_start_ts).max(entry.update_time);
                if squeeze_start_cap < squeeze_end_cap {
                    squeezed_indexes.push(i);
                    amt += squeezed_amt(account_id, entry, squeeze_start_cap, squeeze_end_cap);
                }
            }
            squeeze_end_cap = entry.update_time;
            i += 1;
        }

        squeezed_indexes.reverse();
        Ok((amt, squeezed_indexes, history_hashes, curr_cycle_configs))
    }

    /// Squeeze the running cycle from one sender; marks squeezed windows and applies
    /// the compensating negative delta so receive_streams can't double-count.
    pub fn squeeze_streams(
        &mut self,
        account_id: AccountId,
        sender_id: AccountId,
        history_hash: alloc::vec::Vec<u8>,
        streams_history: &[StreamsHistory],
        now: u64,
    ) -> StreamsResult<u128> {
        let (amt, squeezed_indexes, _hashes, curr_cycle_configs) =
            self.squeeze_streams_result(account_id, sender_id, history_hash, streams_history, now)?;

        let cycle_secs = self.cycle_secs;
        self.ensure_state_exists(account_id);

        for idx in &squeezed_indexes {
            let config_index = curr_cycle_configs - idx;
            self.next_squeezed.insert((account_id, sender_id, config_index), now);
        }

        if amt > 0 {
            let cycle_start = self.curr_cycle_start(now);
            let neg_amt_per_sec = -(I256::from(amt) * I256::from(AMT_PER_SEC_MULTIPLIER));
            add_delta_range(
                &mut self.amt_deltas,
                account_id,
                cycle_start,
                cycle_start + 1,
                neg_amt_per_sec,
                cycle_secs,
            );
        }

        Ok(amt)
    }
}

/// One history entry's squeezable amount for account_id (receivers sorted by id —
/// binary search to the first match, then walk the run).
fn squeezed_amt(
    account_id: AccountId,
    history_entry: &StreamsHistory,
    squeeze_start_cap: u64,
    squeeze_end_cap: u64,
) -> u128 {
    let receivers = &history_entry.receivers;
    let mut idx = receivers.partition_point(|r| r.account_id < account_id);

    let mut amt = U256::ZERO;
    while idx < receivers.len() {
        let receiver = &receivers[idx];
        if receiver.account_id != account_id {
            break;
        }
        let (start, end) = stream_range(
            &receiver.config,
            history_entry.update_time,
            history_entry.max_end,
            squeeze_start_cap,
            squeeze_end_cap,
        );
        amt += streamed_amt(receiver.config.amt_per_sec, start, end);
        idx += 1;
    }
    livestreak_math::wide::narrow(amt, "squeezed amt")
}

// ── Set streams (Move set_streams — the main configuration entry point) ─────────

impl StreamsRegistry {
    /// Returns the actually-applied balance delta (withdrawals cap at the balance).
    #[allow(clippy::too_many_arguments)]
    pub fn set_streams(
        &mut self,
        account_id: AccountId,
        curr_receivers: &[StreamReceiver],
        balance_delta: i128,
        new_receivers: &[StreamReceiver],
        max_end_hint1: u64,
        max_end_hint2: u64,
        now: u64,
    ) -> StreamsResult<i128> {
        let cycle_secs = self.cycle_secs;

        let (curr_balance, last_update, curr_max_end, old_history_hash, old_curr_cycle_configs) =
            match self.states.get(&account_id) {
                None => (0u128, 0u64, 0u64, alloc::vec::Vec::new(), 0u64),
                Some(state) => {
                    verify_streams_receivers(curr_receivers, state)?;
                    if now < state.update_time {
                        return Err(StreamsError::TimestampBeforeUpdate);
                    }
                    let balance = calc_balance(
                        state.balance,
                        state.update_time,
                        state.max_end,
                        curr_receivers,
                        now,
                    );
                    (
                        balance,
                        state.update_time,
                        state.max_end,
                        state.streams_history_hash.clone(),
                        state.curr_cycle_configs,
                    )
                }
            };

        // Withdrawals cap at the whole balance (Move i128 compare + neg_from).
        let neg_curr_balance = -i128::try_from(curr_balance).expect("balance exceeds i128");
        let real_balance_delta = balance_delta.max(neg_curr_balance);

        let new_balance = if real_balance_delta >= 0 {
            curr_balance + real_balance_delta as u128
        } else {
            curr_balance - real_balance_delta.unsigned_abs()
        };

        let new_max_end =
            self.calc_max_end(new_balance, new_receivers, max_end_hint1, max_end_hint2, now)?;

        self.ensure_state_exists(account_id);
        self.update_receiver_states(
            curr_receivers,
            last_update,
            curr_max_end,
            new_receivers,
            new_max_end,
            now,
        );

        let new_streams_hash = hash_streams(new_receivers);
        let state = self.states.get_mut(&account_id).unwrap();
        state.update_time = now;
        state.max_end = new_max_end;
        state.balance = new_balance;

        // History exists + crossed a cycle boundary → reset to 2, else increment.
        state.curr_cycle_configs = if !old_history_hash.is_empty()
            && cycle_of_secs(last_update, cycle_secs) != cycle_of_secs(now, cycle_secs)
        {
            2
        } else {
            old_curr_cycle_configs + 1
        };

        state.streams_history_hash =
            hash_streams_history(&old_history_hash, &new_streams_hash, now, new_max_end);
        if new_streams_hash != state.streams_hash {
            state.streams_hash = new_streams_hash;
        }

        Ok(real_balance_delta)
    }

    /// View: (streams_hash, history_hash, update_time, balance, max_end).
    pub fn streams_state(
        &self,
        account_id: AccountId,
    ) -> (alloc::vec::Vec<u8>, alloc::vec::Vec<u8>, u64, u128, u64) {
        match self.states.get(&account_id) {
            None => Default::default(),
            Some(s) => (
                s.streams_hash.clone(),
                s.streams_history_hash.clone(),
                s.update_time,
                s.balance,
                s.max_end,
            ),
        }
    }
}
