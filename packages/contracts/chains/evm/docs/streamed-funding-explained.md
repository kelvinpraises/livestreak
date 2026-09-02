# Streamed Funding: The Full Picture

> **Status: implemented.** The Board, `advance`/`settle`/`pendingShares`, the per-funder depletion
> settle, and the resolution payout now live on the **Vault** (`src/vault/Vault.sol`, math in
> `src/vault/BondingBoard.sol`), funded through a **vault-aware `AddressDriver`**
> (`src/streaming/drivers/AddressDriver.sol`) over the mined `DripsStreaming` rail. Proven in
> `test/vault/VaultBoard.t.sol`, `test/vault/VaultResolution.t.sol`, and
> `test/streaming/drivers/AddressDriver.t.sol`.
>
> **One architecture note, because an earlier draft of this doc said otherwise.** That draft had a
> single *module* own everything — your stream included (the "valet"). **The shipped design is
> different and better: you own your funding account** (only you can operate it, via the driver), the
> **Board lives on the Vault**, and the driver streams **only** into vault-sides. The math below — the
> Board, the `ln`, fairness, depletion, I1 — is unchanged and accurate. Where an older section says
> "the module owns your stream," read "**you** own it; the **Vault** holds the Board." The
> **[Appendix — Code Map](#appendix--code-map-grep-these)** at the bottom is the current source of truth.

---

## The Problem We're Solving

In LiveStreak you back a side of a bet — YES or NO — by **streaming money in over time**. Not
one big deposit. A slow drip: say one dollar every second, for as long as you like.

For that money you get **shares**. Shares are your claim on the winnings if your side is right.

Here's the catch. The price of a share is **not fixed**. The more money piles onto a side, the
more each new share costs. Think of a small parking lot: the first cars park cheap, but as it
fills, each remaining spot gets pricier. That rising price is called a **bonding curve**, and
the rule is simple:

```
price of a share  =  starting price  +  starting price × (money on this side ÷ a constant)
```

So a steady one-dollar-a-second drip does **not** buy the same number of shares each second.
Early seconds (cheap) buy more shares; later seconds (pricey) buy fewer. Fine — that's the
curve doing its job.

Now the real problem. The old way priced your drip **at the moment someone happened to "poke"
the system to settle it**. And here's why that's rotten:

> Imagine a shared taxi where the fare is decided by **whenever the driver glances at the
> meter**. Two riders go the exact same distance — but one gets charged at a glance taken in
> light traffic, the other at a glance taken in a jam. Same ride, different fare, decided by a
> random glance. That's not a price. That's a coin flip.

Settling is just like that glance. Anyone can poke at any time. If your price depends on **when
someone pokes**, then your price is luck, not law. Two people who stream the same dollar-per-
second over the same minute should pay the **same** — no matter who pokes, or when.

That's the whole job: **make a streamed funder's price depend only on the real journey of the
pool, never on who pokes when.** Cheaply. And in a way you can ask about at any moment.

---

## The Core Idea

Three images. Hold onto them and the rest falls into place.

**1. The Pool.** Picture a tank of money for each side. It fills as people stream in. Its level
is public and rises on a schedule everyone can compute from the clock and the known streaming
rates — *not* from who pokes. Like the time of day: it's the same number whether or not you
look at your watch.

**2. The Price.** The price of a share is just the tank's level read off the bonding curve. Low
tank, cheap shares. Full tank, dear shares. (At the start, a dollar buys **ten** shares. By the
time the side holds $10,000, a dollar buys only **five** — the price has doubled.)

**3. The Board.** This is the trick. We keep **one** public running tally per side. Call it the
Board. The Board answers a single question: *"So far, how many shares has a steady one-dollar-
per-second drip earned?"* Everyone on that side reads the **same** Board. And your shares are:

```
your shares  =  your streaming rate  ×  ( Board now  −  Board when you joined )
```

That's it. No per-person history. No looping over seconds. One number does it for everyone.

> **You're about to ask:** *"Why does one shared number work for everybody? People joined at
> different times and stream at different rates."* — Because the Board only measures the
> **journey of the price**, which is the same for everyone on the side. Your rate and your join
> time are *your* two private numbers; the Board is the *shared* one. Multiply your rate by how
> much the Board rose **while you were in**, and you get your fair slice. We'll prove this is
> dead-on fair later, with real numbers. Be patient — that payoff is worth the wait.

It's a loyalty-points board. The shop's "points per dollar" changes through the day as it gets
busy, but the shop keeps **one** cumulative board, not a diary for each customer. At checkout,
your points = your spending rate × how much the board climbed since you walked in. The shop
never replays your visit minute by minute. Neither do we.

---

## The Pieces (who's who)

```
funder        You. Approve the driver, then call fund() / stop() / claim() on the AddressDriver.
AddressDriver The vault-aware driver — src/streaming/drivers/AddressDriver.sol. YOUR funding account
              is (FD_user<<224)|you; only you operate it (via this driver), and it streams ONLY into
              vault-sides. fund() opens the real stream AND tells the Vault, in one call.
Vault         src/vault/Vault.sol — holds the Board (pricing) per (vault, side), the per-funder
              positions, and the resolution payout; it is ALSO the Drips receiver driver (FD_vault)
              for its own receiver accounts. Board math lives in BondingBoard.sol.
Drips         DripsStreaming — src/streaming/DripsStreaming.sol. Holds the USDC and runs the cycle
              streaming math (mined from Drips; proven in test/streaming/DripsStreaming.t.sol).
USDC          The money. A 6-decimal dollar-token (test double: test/mocks/MockUSDC.sol).
```

Two "accounts" inside Drips matter. Don't overthink the bit-shuffling — what counts is **who
owns them**:

```
S  = YOUR sender account, (FD_user<<224)|you.  "Where your drip flows FROM." You own it: only
     you can operate it, through the AddressDriver.
R  = the VAULT's receiver account for a (vault, side), (FD_vault<<224)|poolId.  The tank drips
     flow INTO. The Vault owns it (it's the receiver driver), so only the Vault collects it.
```

Ownership splits cleanly. **Your sender `S` is yours** — the AddressDriver only ever lets you operate
your *own* account (`calcAccountId(msg.sender)`), so you keep self-custody of your unspent deposit.
**The receiver `R` is the Vault's** — the Vault is its driver, so only the Vault collects it at
resolution. (In code, an account id's top 32 bits are its driver id, `DRIVER_ID_OFFSET = 224` in
`src/streaming/DripsStreaming.sol`: `S` carries `FD_user`, `R` carries `FD_vault`.) The real defense
against cheating isn't "a module holds your money" — it's that the driver **streams only into vaults
and updates the Board in the same call**, so the Board can never drift out of sync.

> **The turnstile analogy, plant it now:** the AddressDriver is a turnstile that only opens toward
> the vaults. You still hold your own ticket (your account) — nobody can push you through, and you
> can always walk back out with your unspent fare. The turnstile just guarantees that every time you
> go in, the vault's tally (the Board) moves in the same motion. You never hand your money to a valet.

---

## The Money Trail, at a Glance

```
your wallet ──fund──▶ Drips (your S, "streams" bucket) ──flows over time──▶ Drips (R, the tank)
            ──stop refund──▶ your wallet
            ──resolution──▶ Vault.collect ──claim──▶ winners' wallets

★ shares are EARNED smoothly the whole time (in the Board).
$ tokens only MOVE at four moments: funding in, refunding out, resolution, claim.
```

This decoupling is on purpose. It's airline miles versus the ticket: your **miles tick up every
day you're subscribed** (your shares accrue continuously off the Board), but **the actual ticket
prints once** (tokens only move at refund/resolution/claim). Don't expect shares and tokens to
move at the same instant — they're deliberately on different clocks.

Now let's walk every path. Each one shows the mechanical steps, then plain talk underneath.

---

## Path A — Funding a side

```
 funder
   │ (1) usdc.approve(module, deposit)          allow the module to take your dollars
   ▼
 module.fund(vaultId, side, rate, deposit):
   │ (2) settle you first                       lock in any shares you already earned
   │ (3) usdc.transferFrom(you → Drips)     $   your dollars move into the Drips vault
   │ (4) drips.setStreams(S, +deposit, →R, rate)    open the drip: S pays into the tank R
   │ (5) sideRate += rate                       the tank now fills a little faster
   │ (6) read maxEnd; file a "you-run-dry" note here  note WHEN (and that it's YOU) the drip ends
   ▼
 your dollars now sit in Drips, dripping toward the tank. No shares minted yet (except step 2).
```

You hand the module two things: a **rate** (how fast you want to drip, e.g. $1/sec) and a
**deposit** (how much you're loading, e.g. $50). First the module settles whatever you'd
already earned, so nothing gets blurred by what you're about to change (step 2). Then it pulls
your dollars into the Drips vault (step 3) and opens the drip (step 4): your personal sender
`S` now pays into the shared tank `R` at your rate. The side's total fill-speed goes up by your
rate (step 5). Finally — and this is quietly important — the module reads back from Drips the
exact time your $50 will run out (step 6). At $1/sec, $50 lasts 50 seconds, so it notes "this
person's drip stops 50 seconds from now." It will need that fact later, in Path D.

> **You're about to ask:** *"Why does the module take my money before I get any shares?"* —
> Because your shares are *earned over time as the drip flows*, not bought up front. Loading the
> deposit is like topping up a prepaid meter; the meter then spends it second by second, and the
> shares trickle in as it does. The next path is where that trickle actually gets counted.

**In code —** `AddressDriver.fund()` (`src/streaming/drivers/AddressDriver.sol`) opens the drip with
`DripsStreaming.setStreams()`, reads your run-dry time via `DripsStreaming.streamsState() → maxEnd`,
and in the same call seats you on the Board through `Vault.onFund()` — all **REAL**.

---

## Path B — The Heart: Advance, then Settle

This is the one to slow down on. Everything fair and cheap lives here.

```
 anyone (a "poke" — totally permissionless)
   │ advance(side):  bring the Board up to date
   │   for each stretch of time where the fill-speed didn't change:
   │       price_start = curve(pool)                    read price at the stretch's start
   │       pool       += sideRate × (time of stretch)   tank rises on the clock's schedule
   │       price_end   = curve(pool)                    read price at the stretch's end
   │       Board      += (one clean formula using price_start, price_end)   ← the magic step
   │   (apply any "rate ends" notes as you pass their moment)
   ▼
 settle(funder):  hand this person their slice
   │   your shares += your rate × (Board − Board_when_you_last_settled)
   │   remember the Board value for you, for next time
   ▼
 Tokens don't move here. Only the Board climbs and your share-count grows.
```

Read it as two beats. **Beat one, "advance":** catch the shared Board up to the present. We walk
the timeline in stretches where the fill-speed was steady. For each stretch we know where the
price started, we let the tank rise by `rate × time` (pure clock arithmetic — no pokes
involved), we see where the price ended, and we bump the Board by a clean formula built from
those two prices. **Beat two, "settle":** now that the Board is current, your slice is simply
your rate times how far the Board climbed since you last collected. We jot down the new Board
value next to your name so we never double-count.

> **You're about to ask:** *"Wait — 'one clean formula'? Don't you have to add up every single
> second to get the shares, since the price changes every second?"* — That's the fear, and the
> answer is the prettiest part. There's a formula (it uses a logarithm) that gives the **exact**
> area under the price curve for the whole stretch **in one shot**. So no matter how long the
> stretch — a second or a week — it's *one* calculation, not thousands.
>
> You do **not** need to love logarithms to trust this. Here's the whole idea in words: adding
> up a smoothly-rising thing, instant by instant, has a shortcut — the same way you can find the
> area of a triangle with `½ × base × height` instead of counting tiny squares. We use the
> shortcut. (If you *do* like formulas, there's a box at the end of this section. If you don't,
> skip it — nothing later depends on it.)

> **And you might ask:** *"Why is the tank's rise allowed to ignore who pokes?"* — Because it
> rises by `fill-speed × elapsed time`, and both of those are **known facts**, not opinions. The
> clock is the clock. The rates are on record. So anyone, poking at any time, computes the **same
> tank level** for the same moment. That's exactly what kills the unfair taxi-meter glance: the
> price is now a fact about time, not a fact about who looked.

**Let's make it real.** Alice streams $1/sec into YES and loads $50, so her drip runs 50
seconds. Say she's the only funder and the tank starts empty.

- Start: tank = $0, price = the base (a dollar buys ~10 shares).
- 50 seconds later: tank = $50. That's tiny next to the $10,000 it takes to double the price, so
  the price barely moved — a dollar still buys just under 10 shares.
- Her shares come out to **about 498.75**.

Why not a round 500? Because if *every* dollar had bought at the rock-bottom start price, she'd
get exactly 500. She gets a hair less — **498.75** — because the price crept up as she filled
the tank. That tiny shortfall **is** the curve working, measured exactly. Hold that 498.75
number; it's the star of the fairness proof later.

```
 (optional formula box — skip freely)
 Over a steady-rate stretch, the Board rises by:
     ΔBoard = SHARE_SCALE × CURVE_K / (BASE_PRICE × sideRate) × ln(price_end / price_start)
 Your shares for the stretch = your_rate × ΔBoard.
 Sum over all funders (their rates add up to sideRate) = SHARE_SCALE × CURVE_K / BASE_PRICE ×
 ln(price_end/price_start) — exactly the curve's shares for the dollars that flowed in. It
 conserves. Nothing is invented or lost.
```

**In code —** `Vault.advance()` and `Vault.settle()` (**REAL**, `src/vault/Vault.sol`) walk the Board;
the price and the one-shot `ln` step are `BondingBoard.price()` / `segMath()`
(`src/vault/BondingBoard.sol`), using solady `FixedPointMathLib.lnWad` (vendored in `lib/solady`).

---

## Path C — Changing or Stopping

```
 module.editFunding(side, newRate, more/less deposit):
   │ settle you first                       freeze what you've earned at today's Board
   │ move money in/out of your S            top up, or pull some back
   │ sideRate += (newRate − oldRate)        tank fills faster or slower from now on
   │ re-read maxEnd; re-note when you'll run dry
   ▼
 module.stopFunding(side):
   │ settle you first                       freeze your earned shares
   │ close your drip (S → empty)
   │ refund your unspent deposit        $   leftover dollars go back to your wallet
   │ sideRate −= your rate                  tank stops filling from you
```

Want to drip faster, add more money, or quit? You ask the valet. Every such request **settles
you first**, so the shares you've already earned are locked in at the current Board before
anything changes — you can never lose earned shares by editing. Stopping closes your drip and
**refunds whatever you didn't spend** straight back to your wallet.

> **You're about to ask:** *"If lots of other people are mid-stream and the system is busy, can I
> still get my refund, or am I stuck waiting?"* — You're never stuck. Your refund comes from
> **your own** account `S` through Drips, and that path does **not** wait on anyone else's
> bookkeeping. A crowd can slow down how fast *share-counting* catches up, but it can **never**
> trap your money. (We'll stress this hard in *Where Can't You Cheat?*)

**In code —** `AddressDriver.stop()` (**REAL**) closes the drip with `DripsStreaming.setStreams()` (a
negative balance delta pulls your unspent back) + `DripsStreaming.withdraw()`, then settles you on the
Board via `Vault.onStop()`. (Editing/topping-up a live position is the documented multi-vault next step.)

---

## Path D — When the Money Runs Out

```
 No transaction happens at the run-dry moment. Back in Path A we filed a note —
 a (run-dry time → WHO) entry, kept in time order for the side.
 The next time anyone advances the Board and the walk reaches that exact moment, it does
 FOUR things right there, before stepping one second further:
   (1) the Board is now standing at its value FOR that moment   (the walk halted right here)
   (2) settle YOU at that frozen Board:
         your shares += your rate × (Board_here − your last Board mark)
   (3) your rate → 0           you earn nothing after your own dollars stop
   (4) sideRate −= your rate   the tank stops filling from you, to the second
```

Remember step 6 of funding, where the module noted *when* your $50 would run dry — and under
*whose* name? This is why. A drip is like a **prepaid meter**: load $50, it spends at $1/sec,
and after 50 seconds it's empty and stops **on its own** — nobody flips a switch.

But "stop filling the tank" is only half the job. The other half is **you**. At that exact
moment the module also **locks in your final shares** — reading the Board *as it stood right
there* — and then zeroes your rate. That freeze is what makes your number honest: your shares
are pinned to the Board value of your run-dry instant, so nothing that happens afterward (other
people still dripping, the price still climbing) can ever be credited to you. You stopped
paying; you stop earning — the same second. That's why the note has to remember **who**, not
just **when**: the walk doesn't merely drop the fill-speed as it passes your moment, it *pays
you out* there. And because the walk steps boundary-to-boundary, it's always holding the exact
Board for your instant — it never has to guess it or rebuild it.

> **You're about to ask:** *"What if nobody pokes right when my meter empties? Does the tank
> keep pretending I'm still paying, and hand out shares against money that never came?"* — No,
> and this is the safety bolt. The catch-up **never steps past a run-dry moment it hasn't
> applied yet** — it always stops *at* your meter's end, settles you there, and only then moves
> on. So two guarantees land together: the tank can't run ahead of the real dollars, **and**
> your share-count is sealed at your run-dry Board. The worst a late poke causes is that the
> *paperwork* arrives later — never that you're paid for a second you didn't fund, and never
> that shares get conjured from nothing.

**In code —** the run-dry time is `maxEnd`, read via `DripsStreaming.streamsState()` and computed in
`Streams.sol` (`_calcMaxEnd`). The `(run-dry → who)` schedule and the settle-at-boundary in steps
(1)–(4) are **REAL** on the Vault — `_scheduleBoundary()` + the boundary walk in `_advance()`, fed by
that `maxEnd`.

---

## Path E — "What Am I Owed Right Now?"

```
 pendingShares(funder, side):   a pure question — changes nothing
   │ replay the SAME Board math in memory, up to right now
   │ return  your_rate × (Board_now − Board_when_you_last_settled)
```

You'll want to glance at your earned shares without paying gas or changing anything. This is a
**read-only** question. It runs the exact same Board math as the real settle — just in memory,
touching no storage — and tells you your number as of this instant.

> **Why use the *same* math, not a separate estimate?** Because if the preview used different
> arithmetic than the real thing, the preview could lie. By sharing one routine, the preview is
> a **promise**: what it shows is exactly what you'd get if you settled right now. (In the rare
> case the system is badly behind from a flood, the preview shows a safe **lower bound** — never
> more than you'll really get.)

**In code —** `Vault.pendingShares()` (**REAL**, `src/vault/Vault.sol`) replays the Board math
read-only — a gas-free view of what you've earned right now, exactly what `settle()` would bank.

---

## Path F — Resolution (winners take the pot)

```
 steward.resolveVault(outcome):  the registry is the Vault's resolver; outcome frozen at resolvedAt
   │
 funder.settle(funder):          squeeze each live stream's in-flight cycle into the tank R
   │ (a market resolves mid-cycle, so the current Drips cycle hasn't been delivered yet)
   ▼
 module.collect(R):              only the module can do this — it owns R
   │ pull the streamed dollars out of Drips into the module       $ tank → module
   ▼
 claim(funder):
   │ final shares = your earned shares, rounded down at the very last step
   │ payout = pot × your shares ÷ all winning shares          $ module → your wallet
```

When the bet resolves, the **pot is fixed from the Board** — `yesPool + noPool` at `resolvedAt`, which
is exactly the dollars both sides streamed up to resolution (invariant I1: `pool == delivered`). It is
*not* whatever happens to be sitting in the tank when someone calls `collect`. So the pot is correct no
matter when, or in what order, anyone collects. Winners then claim a slice of the pot sized by shares.

**The mid-cycle catch.** Drips only *delivers* a cycle's dollars once that cycle finishes, but a real
market resolves at an arbitrary second — mid-cycle. Because the pot is read off the Board, it is always
right; the only open question is *liquidity* — getting the cash into the tank so claims can pay. So
`collect` is **idempotent**: it banks whatever Drips has delivered and is safe to call again, and an
early `collect` can no longer strand anyone (it just pulls less cash that moment; a later `settle` +
`collect` tops the tank up). `AddressDriver.settle(funder)` (and `stop`) does the pulling: a
permissionless `squeezeStreams` banks the in-flight cycle into `R`. The **driver** does the squeeze —
not the module — because only the sender's driver holds the stream history a squeeze needs.

> **One honest detail you'll want to know:** the final rounding-to-whole-shares happens **here,
> at claim — once.** Not on every settle. That's deliberate, and it's what makes the fairness
> proof below land *exactly* instead of *almost*. Keep reading.

**Overage — money streamed *after* the bell.** Streams don't stop at `resolvedAt`; a funder who keeps
streaming is paying into a settled market. That surplus is **not** part of the pot (the Board froze at
`resolvedAt`), so it is never handed to the winners. Instead it is recorded when the funder `stop`s and
**refunded to them** via `AddressDriver.reclaim` → `Vault.reclaimOverage`. The books then close exactly:
every collected dollar is either pot (to the winner) or overage (back to the streamer).

> **What's still left for later, eyes open:** (1) a funder who *never* stops forfeits their overage to
> vault surplus — a steward sweep is the refinement; (2) **who** may resolve is v0-simple: a single
> registered steward, no stake, no penalty. Quorum, a challenge window, and **slashing** a steward who
> resolves wrongly are the steward-mechanism slice (see `README.md`).

**In code —** `StewardRegistry.resolveVault()` → `Vault.resolve()` (**REAL**, gated to `Vault.resolver`)
freezes the outcome at `resolvedAt`; `Vault.collect()` (**REAL**, idempotent) sets `pot = yesPool +
noPool` from the Board and banks delivered USDC; `AddressDriver.settle()` / `stop()` (**REAL**) squeeze
each live funder's in-flight cycle into the tank; `Vault.claimFor()` / `AddressDriver.claim()` (**REAL**)
pay the winner `pot · shares / sideShares`; `Vault.reclaimOverage()` / `AddressDriver.reclaim()`
(**REAL**) refund post-resolution overage. Proven in `test/vault/VaultResolution.t.sol`.

---

## Where Can't You Cheat?

Let's hand the keys to an attacker and watch every door stay shut. (This mirrors how you'd
stress-test it yourself.)

**Can a funder mess with the stream behind the module's back?** This is the scary one. Your
drip flows from an account `S` — couldn't you just go straight to Drips and top it up, cut it,
or drain it, skipping the module so its records go stale?

No. Remember the valet. `S` and the tank `R` are registered under the **module's** driver id.
Drips guards every change with a check that reads, in plain terms, *"only the account's driver
may touch it."* You are not that driver — the module is. A direct attempt **reverts** with
`"Callable only by the driver"`. And the normal user tool (AddressDriver) can only ever name
*its own* accounts, never the module's — it can't even spell your `S`. So the only way to change
your stream is to ask the module, which always settles-first and re-checks your run-dry time.
**The stream genuinely cannot drift out of sync, because nobody but the module can move it.** (In
code: the guard is `onlyDriver` → `_assertCallerIsDriver()` in `src/streaming/DripsStreaming.sol`,
which runs `require(driverAddress(driverId) == msg.sender, "Callable only by the driver")`. The
everyday user tool is `AddressDriver` (`src/streaming/drivers/AddressDriver.sol`); its
`calcAccountId(addr)` can only name accounts under *its own* driver id — never the module's `FD`,
so it literally cannot spell your `S`.)

**Can you trick the tank into over-filling (minting shares for money that never arrived)?**
No. The tank only rises by `fill-speed × time`, fill-speed only drops at real run-dry moments,
and the catch-up refuses to step past an unapplied run-dry. So the tank level can never exceed
the dollars actually delivered.

**Can you trick it into under-filling (cheating the curve to pay too little)?** No — same
machinery in reverse. Every top-up and cut goes through the module, which settles and re-reads
the truth from Drips before changing anything.

**Can you flood the system to jam it?** Here's the only attack with teeth. You could open
hundreds of tiny drips that run dry at staggered times, so the next person to poke has a huge
backlog of run-dry moments to process. Our answer is the **mailroom rule**: the catch-up
processes at most a fixed batch (say 64) of moments per poke, then stops cleanly. The backlog
drains over a few pokes; no single poke is ever overwhelmed, so nothing bricks. And it isn't
even cheap to attack — **every** one of those run-dry moments costs the attacker a real funded
drip (a transaction and a real deposit). They pay dearly to make you click a few extra times.
Meanwhile, nobody's refund is ever blocked, because refunds ride your own `S`, not the shared
catch-up.

> The shape of this is the same comfort as a good trust model: **no single thing can be turned
> against you.** The funder can't move the stream — only the module can. The module can't make
> the tank lie — the clock and the run-dry notes pin it to real dollars. A flood can't jam it —
> the mailroom rule batches it and the attacker foots the bill.

---

## The Fairness Proof, Felt

Now the payoff. Here is the test that, if it passes, the whole thing is right.

Two funders, **Alice** and **Bob**. Same side, same rate ($1/sec), same 50-second window.

- **Alice pokes constantly** — she settles herself every single second.
- **Bob never pokes** — he settles once, at the very end.

Do they end up with the same shares?

**Yes. Exactly the same — 498.75 each.** Not "about the same." Identical, to the last unit.

Why? Because both of them earn `rate × (Board at exit − Board at entry)`. The Board is one
shared number that climbs the same way no matter who pokes. Alice poking every second just
collects her slice in tiny steps; those steps add up — *telescope* — to precisely the single
jump Bob takes at the end:

```
Alice:  (B1−B0) + (B2−B1) + (B3−B2) + … + (B50−B49)   =   B50 − B0
Bob:                                                       B50 − B0
```

The in-between numbers cancel. Same start, same end, same answer. **Poking changes when you
collect, never how much.** That is the taxi-meter injustice, gone — replaced by a price that is
a fact about the road, not the glance.

> **One subtle promise that makes "exactly" true:** we add up your slices as exact whole numbers
> and only round to final shares **once**, at claim (that was Path F's honest detail). If we
> rounded on every settle instead, Alice's 50 tiny roundings would shave a sliver off, and she'd
> end up a touch behind Bob. By rounding once at the end, the steps telescope perfectly and the
> two match to the unit. Small rule, big consequence.

---

## Who Holds What

```
 Layer     What it guarantees                                  Who controls it
 ─────────────────────────────────────────────────────────────────────────────
 Module    Fair pricing + the only door to the streams         The funding contract (driver FD)
 Drips     Real custody of dollars + honest streaming math      Battle-tested mined code
 Vault     The share ledger and the payout                      Written by the protocol
 Clock     The tank's level (price) — same for everyone         Nobody; it's just time
```

No single point of trust. The funder can't bypass the module. The module can't make the tank
disagree with the clock. The clock plays no favorites. Everyone reads one Board and gets the
same law.

---

## That's Streamed Funding

Step back and feel the shape of it.

Money flows in like water, slowly, through time. The price climbs as the tank fills, the honest
way a crowded thing gets pricey. And the thing that decides what your steady drip earned is not
a person's lucky glance, not who rushed to poke first — it's **one public number that only
listens to the clock**. Whether you watch it like a hawk or forget about it for a week, it owes
you exactly the same.

That's the feeling worth leaving with: a system where **time is the only judge**, the math
settles up the same for the patient and the anxious alike, and no one's whim can tilt the
scales. Fair by construction — not by promise.

---

## Appendix — Code Map (grep these)

Every symbol this doc names, and where it lives — all real now.

**Streaming rail (mined Drips), `src/streaming/`**

| Function / symbol | File | Role |
|---|---|---|
| `DripsStreaming` | `DripsStreaming.sol` | Holds USDC, runs cycle streaming, the driver registry |
| `setStreams()` | `DripsStreaming.sol` | Open / change / close a drip (`onlyDriver`) |
| `streamsState() → maxEnd` | `DripsStreaming.sol` | A stream's run-dry time |
| `receiveStreams()` / `squeezeStreams()` | `DripsStreaming.sol` | Settle finished / force-settle the in-progress cycle |
| `collect()` / `withdraw()` | `DripsStreaming.sol` | Pull a receiver's funds out (`onlyDriver`) / transfer out |
| `registerDriver()` / `driverAddress()` / `DRIVER_ID_OFFSET` (224) | `DripsStreaming.sol` | Driver registry + account-id layout |
| `onlyDriver` / `"Callable only by the driver"` | `DripsStreaming.sol` | The lock — Where Can't You Cheat |
| `Streams` (`_streamedAmt`, `_calcMaxEnd`) | `Streams.sol` | Audited per-second engine (splits telescope exactly) |
| `AddressDriver`: `fund()` / `stop()` / `settle()` / `claim()` / `reclaim()` / `calcAccountId()` | `drivers/AddressDriver.sol` | Vault-aware user driver: streams only into vaults, syncs the Board; `settle`/`stop` squeeze the in-flight cycle into the vault-side; `reclaim` refunds post-resolution overage |
| rail + driver tests | `test/streaming/DripsStreaming.t.sol`, `test/streaming/drivers/AddressDriver.t.sol` | Cycle/custody/squeeze + fund/stop/settle/claim proofs |

**The Board + payout, `src/vault/`**

| Function / symbol | File | Role |
|---|---|---|
| `Vault` | `Vault.sol` | The Board per `(vault, side)`, positions, resolution, payout; also receiver driver `FD_vault` |
| `onFund()` / `onStop()` | `Vault.sol` | Driver-gated Board updates (settle-first → `sideRate` → schedule depletion) — Paths A, C |
| `advance()` / `settle()` / `pendingShares()` | `Vault.sol` | Catch the Board up / bank a funder / view-parity preview — Paths B, E |
| `getSharePrice()` / `getBoard()` / `getPosition()` | `Vault.sol` | Reads |
| `receiverAccount()` | `Vault.sol` | The `(vault, side)` Drips receiver id (assigns `poolId`) |
| `collect()` (idempotent) / `claimFor()` | `Vault.sol` | Pot = Board `yesPool + noPool` at resolvedAt, then a liquidity pull / pay winners `pot · shares / sideShares` — Path F |
| `reclaimOverage()` / `overageOwed` | `Vault.sol` | Refund USDC a funder streamed after `resolvedAt` (recorded in `onStop`) — Path F |
| `resolve()` / `resolver` (set-once) | `Vault.sol` | Steward-gated outcome via `StewardRegistry.resolveVault`; freezes `resolvedAt` — Path F |
| `BondingBoard.price()` / `segMath()` | `BondingBoard.sol` | Pure curve + `lnWad` segment math |
| `BASE_PRICE` (1e5), `CURVE_K` (10_000e6), `SHARE_SCALE` (1e6) | `BondingBoard.sol` | Curve constants — formula box |
| `FixedPointMathLib.lnWad` / `fullMulDiv` | `lib/solady` | The log + the exact payout ratio |
| Board + payout tests | `test/vault/VaultBoard.t.sol`, `test/vault/VaultResolution.t.sol`, `test/vault/BondingBoard.t.sol` | 498.75, I1, fairness, bounded advance, bounty split |
