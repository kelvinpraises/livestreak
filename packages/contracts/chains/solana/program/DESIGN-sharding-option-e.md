# Solana PDA Sharding — Option E

Status: DESIGN (no code). Successor to the one-blob-per-market `ProtocolState`.
Grounded against: `programs/livestreak/src/{state.rs,instructions/protocol.rs}`,
`crates/livestreak-engine/src/{drivers.rs,vault.rs,treasury.rs,drips.rs,state.rs}`,
commits c7a7379 (grow ladder), fd028e7 (compaction), ffeaa41 (bounded catch-up),
52db324 (treasury-global RULING).

## 0. What "one blob" means today

`ProtocolState` PDA `["protocol", market_id]` carries `data: Vec<u8>` — a postcard
encoding of the whole `Protocol` composite:

```
Protocol {
  streams:       StreamsRegistry   // states/amt_deltas keyed by receiver AccountId
  drips:         DripsRegistry      // held + streams_balance + collectable (market-wide cash conduit)
  vault:         VaultRegistry      // vaults/boards/positions/boundaries/pot/... — grows with vaults×funders
  vault_driver:  VaultDriverState   // pool_id_of, seeds  (per vault-side)
  market_driver: MarketDriverState  // minted_tokens, used_salts, market_id_of, lane_keys, lanes (per position)
  treasury:      TreasuryRegistry   // LVST economy — MOVES OUT (§3)
}
```

Every money instruction does `load()` (full postcard decode → BTreeMaps) → mutate →
`store()` (full re-encode) → `assert_conserved`. ONE shared USDC escrow ATA
`["escrow", market_id]` (authority = protocol_state PDA); LVST staking escrow
`["lvst_escrow", market_id]`; LVST mint authority `["lvst_authority"]` is already global.

Conservation, live, atomic (protocol.rs `assert_conserved`):
`escrow.amount == drips.held + vault.usdc_held + treasury.usdc_held`.

## 1. WHY — the three walls the interim work only postpones

1. **Byte / heap ceiling.** `store()` guards `PROTOCOL_HEADER + bytes.len() <= account_len`;
   grow_protocol reallocs to `MAX_PROTOCOL_BYTES = 10*10_240 = 102_400`. The real cap is
   not the 10 MiB account limit — it is the requestable 256 KB BPF heap that must hold the
   FULLY-DECODED `Protocol` (nested BTreeMaps) on every op. A market with enough vaults ×
   funders decodes into a structure that OOMs the heap long before any account limit.
2. **Whole-blob CU per op.** Every instruction pays to decode AND re-encode ALL vaults,
   positions, and boundary queues even to touch one vault. `fund` on vault A re-serializes
   vault Z's boards. Cost grows O(total market state) per op, unbounded in market size — the
   dominant CU term next to the `seg_math` ln kernel.
3. **Write-lock contention.** Every money op marks `protocol_state` `mut`. Solana serializes
   writers of one account, so two positions funding two DIFFERENT vaults in the same market
   cannot land in parallel — the whole market throughput collapses to one op per slot per
   account, plus the shared escrow ATA is `mut` on every cash op too.

The ladder buys #1 headroom; compaction slows #1's growth; the catch-up cap bounds a
symptom of #2. None touch #3, and none change that every op still decodes the whole blob.

## 2. SHARD MAP

Split the one blob along its natural key boundaries. The `vault` registry (walls #1/#2/#3's
main driver) shards cleanly per-vault; `market_driver` shards per-position; the
`streams`/`drips` conduit does NOT shard below the market (honest residual, below).

```
GLOBAL (singletons)
  ["registry"]                          Registry           market_count, default_steward, lvst_mint
  ["treasury"]                          GlobalTreasury      §3 — LVST economy, protocol-wide
  ["treasury_escrow"]  ATA USDC         skim intake + dividend float
  ["lvst_stake_escrow"] ATA LVST        all staked LVST (replaces per-market lvst_escrow)
  ["lvst_authority"]                    mint-authority PDA (unchanged)

PER MARKET
  ["market", mid]                       Market             meta + stream lifecycle (unchanged)
  ["core", mid]                         MarketCore         market_driver counters + streams + drips
  ["drips_escrow", mid] ATA USDC        the streamed-cash conduit escrow (was the shared escrow)

PER VAULT  (mid, vid)
  ["vault", mid, vid]                   VaultShard         VaultData + boards[YES,NO] + boundaries[YES,NO]
                                                           + positions on this vault + pot/collected/skim_owed
                                                           + overage/claimed + vault_driver pool_id/seeds
  ["vault_escrow", mid, vid] ATA USDC   this vault's held cash (harvested + pot)

PER POSITION  (mid, token_id)
  ["position", mid, tid]                PositionShard      PositionOwner (owner gate) + lane_keys/lanes
                                                           + account_vaults membership for this token
```

Escrow topology is the crux: **one shared escrow re-serializes every cash op even if state
shards** (wall #3 survives on the ATA). So each shard gets its OWN escrow ATA, and cash that
crosses a shard boundary is a real token transfer between escrows inside the one instruction
that spans both (still a token-program CPI, same as today — NOT a cross-program invoke into a
sibling program; the destination shard is just another account this same program owns).

### Cross-shard conservation

Today: three ledgers vs one escrow, asserted in one tx. Sharded, the invariant becomes
LOCAL-per-shard + a compositional GLOBAL that no single tx can see:

```
per-shard (checked in every op that writes the shard, mirror of assert_conserved):
  drips_escrow[mid].amount   == core.drips.held
  vault_escrow[mid,vid].amount == vaultShard.usdc_held
  treasury_escrow.amount     == treasury.usdc_held
  lvst_stake_escrow.amount   == treasury.staked_lvst_held

global (partition — provable by composition, NOT in one instruction):
  Σ vault_escrows + drips_escrow(s) + treasury_escrow == Σ all ledgers
```

Cash crossing a boundary (the two flows the blob did in-struct):
- **harvest** (`collect`/`withdraw`): streamed cash leaves `drips.held` → enters
  `vaultShard.usdc_held`. Op spans core + one vault shard; transfer `drips_escrow → vault_escrow`
  signed by the core PDA; decrement `drips.held`, increment `usdc_held` — both local invariants
  re-close in the same op. Atomic within the instruction.
- **skim** (`collect_vault`): `vault.drain_skim` → `treasury.deposit_skim + notify_skim`. Op
  spans one vault shard + the global treasury; transfer `vault_escrow → treasury_escrow` signed
  by the vault PDA.

**What weakens, stated honestly:** the single-tx all-ledgers guard becomes per-shard-atomic +
a global reconciliation only checkable off-chain or via a permissionless `audit` instruction
that walks shards over many txs. A bug can no longer corrupt the WHOLE market in one op (blast
radius shrinks to one shard) but a cross-shard step that half-lands (impossible today — one
account) must be an atomic 2-account write inside one instruction, never split across txs.
The `streams`/`drips` conduit is the residual serialization point: a position's ONE stream
account fans out to receivers across MANY vaults (bipartite funding graph), so `set_streams`
must write `core` on every fund/stop/collect. Core stays a per-market hot account — sharding
buys parallelism ACROSS markets and removes the per-vault ops (resolve/advance) from the hot
path, but same-market cash ops still serialize on `core`. This is a deliberate boundary, not
an oversight: pushing streams below market granularity would fracture the Drips receiver
namespace the Move port is 1:1 with.

## 3. GLOBAL TREASURY SHARD  (RULING — not open, per 52db324)

The per-market `TreasuryRegistry` inside the blob is a PORTING ARTIFACT. EVM's treasury is
ONE protocol-global contract; the canonical staking API carries no market
(`StakeLvstInput`/`UnstakeLvstInput`/`ClaimDividends` have nothing to scope to). Today
`packages/options/src/chains/solana/writer.ts:387-399` throws typed-unsupported for exactly
this reason. Carve it out:

```
GlobalTreasury  PDA ["treasury"]   (moved verbatim from TreasuryRegistry)
  skim_bps, mint_start/floor/knee, total_skimmed          // pool-driven mint curve, now protocol-wide
  total_staked, acc_usdc_per_stake, undistributed         // MasterChef accumulator across ALL markets
  usdc_held, staked_lvst_held                             // vs treasury_escrow / lvst_stake_escrow
  stake_of, reward_debt, accrued_dividends : per staker   // keyed [u8;32] pubkey — global
  loss_claimed : (AccountId, VaultId, side)               // vault_id is globally-unique keccak, no collision
```

- **Skim crosses in CPI-free** (same-program account passing): `collect_vault` takes the vault
  shard + `vault_escrow` AND `["treasury"]` + `treasury_escrow`. It drains skim from the vault
  escrow, SPL-transfers it `vault_escrow → treasury_escrow` (signed by the vault PDA), then calls
  `treasury.deposit_skim + notify_skim` on the passed global account. No sibling program, no
  route indirection — the treasury is just another `mut` account this instruction owns.
- **Dividend settle math lives on the global shard** (`settle_dividends`/`notify_skim`/
  `pending_dividends`). Because every market's skim now feeds ONE `acc_usdc_per_stake`,
  dividends become protocol-wide — which is the EVM semantic the ruling protects. A staker
  earns from ALL markets' skim, not one market's.
- **mint_loss_lvst** still reads the loss basis FROM THE VAULT (trust boundary, unchanged) —
  now cross-shard READ: `claim_loss_lvst` passes the vault shard (read `loss_claimable`) + the
  global treasury (guard `loss_claimed` + `mint_rate`) + the LVST mint/authority. Vault side is
  read-only.
- **stake_lvst / unstake_lvst / claim_dividends** retarget to `["treasury"]` +
  `lvst_stake_escrow` + `treasury_escrow` ONLY. No market account. **This directly UNBLOCKS the
  three writer methods** — the canonical market-less inputs now map 1:1 onto global accounts;
  the typed-unsupported throws at writer.ts:387/392/397 are deleted.

## 4. MIGRATION PATH

Greenfield: all chains redeploy from scratch (dev reality — no on-chain state to migrate). The
work is the instruction-set + test evolution, landed in phases.

**Instructions whose account list CHANGES:**
- `init_protocol` → splits: `init_core` (streams/drips + market_driver) once per market;
  vault shard lazily `init`'d inside `create_vault_seeded`; position shard `init`'d inside
  `mint_position`; treasury `init`'d ONCE globally at `initialize`.
- `create_vault_seeded`: + vault shard, + `vault_escrow`; writes core + new vault shard.
- `mint_position`: core (counter) + new position shard.
- `fund`/`stop_all`/`set_lanes`/`stop_funding`: core + position shard + the touched vault
  shard(s). `set_lanes` can touch up to `MAX_LANES=10` vault shards → 10×(shard+escrow) + core +
  position exceeds the base tx account budget → **requires an Address Lookup Table** (call out
  explicitly; single-lane `fund` fits without one).
- `withdraw`: core (harvest) + one vault shard + `vault_escrow` + user.
- `advance`/`collect`/`resolve`: ONE vault shard (collect also + global treasury for skim).
- `claim_loss_lvst`: vault shard (read) + global treasury + LVST mint/authority.
- `stake_lvst`/`unstake_lvst`/`claim_dividends`: global treasury + global escrows only.

**Instructions UNCHANGED:** `initialize`, `register_market`, `go_live`, `set_ended`,
`set_market_steward`, `set_default_steward`, `transfer_position` (pure PositionOwner reassign).

**litesvm test strategy.** The engine conservation suites (`conservation.rs`,
`vault_conservation.rs`, `protocol_loop.rs`, `compaction.rs`, `bounded_catchup.rs`) run on the
pure in-memory `Protocol` — they must be re-derivable PER SHARD. Split `Protocol` into
`MarketCore` + `VaultShard` + `GlobalTreasury` structs, each with its OWN local conservation
lemma (`escrow == ledger` for its escrow). Keep the single-blob suites' arithmetic, but assert
locally per shard; add ONE integration suite that wires N vault shards + core + treasury,
replays the keynote loop, and asserts the GLOBAL sum reconciles — this is the old atomic assert
re-expressed as a multi-shard composition proof. The cross-shard cash steps (harvest, skim) get
a dedicated test that both touched shards re-close their local invariant in the same step.

**Phased landing order** (value-descending, blast-radius-ascending):
1. **Treasury global** (§3). Smallest coupling — only `collect_vault` writes treasury, only via
   `deposit_skim`/`notify_skim`. Carve out `["treasury"]` + global escrows; retarget skim +
   stake/unstake/claim_dividends; UNBLOCK the writer. Ships value (staking on Solana) before any
   vault-shard churn.
2. **Vault shards.** Split `VaultRegistry` per-vault + `vault_escrow`; retarget
   resolve/advance/collect/withdraw; per-vault local conservation. Removes resolve/advance from
   core's write-lock (wall #3 for permissionless ops).
3. **Position shards + LUTs.** Split `market_driver`/positions; retarget fund/stop/set_lanes;
   introduce the Address Lookup Table for multi-lane.
4. **Retire the interim.** With core bounded and vault shards individually small, delete
   `grow_protocol` and `VaultRegistry::compact` (each shard reallocs independently if ever
   needed; neither wall #1 mechanism is load-bearing once state is partitioned).

## 5. NON-GOALS + what the interim already bought

**Non-goals:**
- No engine MATH change. Bonding/streams/settle stay 1:1 Move parity (frozen); ONLY the storage
  partition moves. The suites' expected numbers do not change.
- No cross-CHAIN topology parity. EVM/Sui keep their object models; this is a Solana-only
  account-layout milestone.
- No live state migration. Greenfield redeploy; no upgrade/backfill tool.
- No sharding streams/drips below market granularity (§2 residual — deliberate).
- The per-instruction conservation guard is RETAINED, per shard — not removed.

**What the interim bought (measured, from the commit messages/tests):**
- **grow_protocol (c7a7379):** headroom to `MAX_PROTOCOL_BYTES=102_400` via 10 realloc rungs of
  +10_240 B; litesvm drove a real `StateFull` at capacity 2_000, one rung unblocked the write,
  the ladder topped out at exactly 102_445 then failed typed. Postpones wall #1 ONLY.
- **compaction (fd028e7):** `VaultRegistry::compact()` at `collect_vault` swept the boundary-queue
  prefix `[0, head)` + fully-settled overage crumbs; measured **5483 → 3599 B (~34%)** on boundary
  churn, views byte-identical. Slows wall #1's growth; does nothing for #2/#3.
- **bounded catch-up (ffeaa41):** `MAX_IMPLICIT_CATCHUP_STEPS = 64` = exactly one
  `advance_internal` batch, gated by pure `pending_catchup_steps` → typed `BoardBehind` with the
  board byte-identical on refusal (also fixed a latent advance-then-error partial-mutation bug).
  Bounds the per-op CU of catch-up (a symptom of wall #2) — but every op still decodes the whole
  blob, so #2's baseline is untouched.
```
