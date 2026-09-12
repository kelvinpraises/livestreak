// --- exports ---

import type {
  LvstAccount,
  OptionsMarketSnapshot,
  OptionsNftSnapshot,
  OptionsUserOptionsSnapshot,
  OptionsVaultSide,
  OptionsVaultSnapshot
} from "../../model/index.js";
import {
  lvstToNumber,
  priceOf,
  projectVaultLivePools,
  rateToPerMinUSDC,
  sharesToNumber,
  totalVaultPool,
  usdcToNumber
} from "../../model/index.js";
import type { OptionsBoardState } from "../../model/math/accrual.js";
import type { FunderBoundary } from "../../model/math/live-pool.js";
import type {
  OptionsAccountStatus,
  OptionsControlsView,
  OptionsFunctionTarget,
  OptionsFunctionView,
  OptionsLanePanel,
  OptionsLaneStatus,
  OptionsLvstPanel,
  OptionsMarketPanel,
  OptionsNftPanel,
  OptionsPanel,
  OptionsVaultPanel
} from "./types.js";

/** A paused lane the runtime remembers (dropped on-chain, intent to resume). The board re-injects it as a
 *  `status: "paused"` lane so the row survives the poll; this is the SDK's canonical home for pause state. */
export interface OptionsPausedLane {
  readonly tokenId: string;
  readonly vaultId: string;
  readonly side: OptionsVaultSide;
  readonly rate: bigint; // base units/sec to resume at
}

export interface ProjectPanelContext {
  /** LVST decimals for the active chain (EVM 18 / Sui 9) — normalizes the LVST panel. */
  readonly lvstDecimals: number;
  /** Paused lanes (session intent), overlaid onto the matching ledger position by tokenId/vault/side. */
  readonly pausedLanes?: readonly OptionsPausedLane[];
  /** Per-vault total shares (yes/no), for each position's `percentOfSide`. Built from the snapshot. */
  readonly shareTotalsByVault?: ReadonlyMap<string, { readonly yes: bigint; readonly no: bigint }>;
}

const DEFAULT_CTX: ProjectPanelContext = { lvstDecimals: 18 };

export const projectOptionsPanel = (
  snapshot: OptionsUserOptionsSnapshot,
  ctx: ProjectPanelContext = DEFAULT_CTX
): OptionsPanel => {
  // Per-vault share totals for each position's `percentOfSide` — assembled once from the snapshot.
  const shareTotalsByVault = new Map(
    snapshot.vaults.map((entry) => [entry.vault.vaultId as string, entry.shareTotals])
  );
  const nftCtx: ProjectPanelContext = { ...ctx, shareTotalsByVault };

  return {
    account: snapshot.account,
    markets: snapshot.markets.map((marketSnapshot) =>
      projectMarketPanel(marketSnapshot, snapshot.vaults)
    ),
    nfts: snapshot.nfts.map((entry) => projectNftPanel(entry, nftCtx)),
    lvst: projectLvstPanel(snapshot.lvstAccount, ctx.lvstDecimals),
    ...(snapshot.protocol === undefined ? {} : { protocol: snapshot.protocol }),
    user: {
      account: snapshot.account,
      ...(snapshot.marketId === undefined ? {} : { marketId: snapshot.marketId }),
      ...(snapshot.usdcBalance === undefined
        ? {}
        : { usdcBalanceUSDC: usdcToNumber(snapshot.usdcBalance) })
    }
  };
};

export const projectOptionsFunctions = (panel: OptionsPanel): OptionsFunctionView[] => {
  const functions: OptionsFunctionView[] = [];

  projectMintFunctions(panel, functions);
  projectLvstFunctions(panel, functions);
  functions.push(enabledFunction(CATALOG.setApprovalForAll, { kind: "global" }));

  for (const nft of panel.nfts) {
    projectNftFunctions(panel, nft, functions);
  }

  const vaultIds = new Set<string>();
  for (const market of panel.markets) {
    for (const vault of market.vaults) {
      if (vaultIds.has(vault.vaultId)) {
        continue;
      }
      vaultIds.add(vault.vaultId);
      projectVaultFunctions(panel, market, vault, functions);
    }
  }

  return functions;
};

export const projectOptionsControls = (
  panel: OptionsPanel,
  revision: number
): OptionsControlsView => ({
  account: panel.account,
  revision,
  functions: projectOptionsFunctions(panel)
});

// --- helpers ---

type CatalogEntry = {
  readonly name: string;
  readonly scope: string;
  readonly label: string;
  readonly input?: string;
  readonly targetKind: OptionsFunctionTarget["kind"];
};

const CATALOG = {
  mint: {
    name: "mint",
    scope: "options:market:mint",
    label: "Enter market",
    input: "MintNftInput",
    targetKind: "market"
  },
  mintWithSalt: {
    name: "mintWithSalt",
    scope: "options:market:mintWithSalt",
    label: "Enter market (deterministic)",
    input: "MintWithSaltInput",
    targetKind: "market"
  },
  fund: {
    name: "fund",
    scope: "options:vault:fund",
    label: "Fund",
    input: "FundStreamInput",
    targetKind: "vault"
  },
  setLanes: {
    name: "setLanes",
    scope: "options:nft:setLanes",
    label: "Adjust lanes",
    input: "SetLanesInput",
    targetKind: "nft"
  },
  addFunds: {
    name: "addFunds",
    scope: "options:nft:addFunds",
    label: "Add funds",
    input: "AddFundsInput",
    targetKind: "nft"
  },
  stopFunding: {
    name: "stopFunding",
    scope: "options:vault:stop",
    label: "Stop streaming",
    input: "StopFundingInput",
    targetKind: "vault"
  },
  stopAllFunding: {
    name: "stopAllFunding",
    scope: "options:nft:stopAll",
    // stopAll halts lanes AND withdraws the remaining balance to the wallet.
    label: "Sweep to wallet",
    input: "StopAllFundingInput",
    targetKind: "nft"
  },
  withdraw: {
    name: "withdraw",
    scope: "options:vault:withdraw",
    label: "Withdraw winnings",
    input: "WithdrawInput",
    targetKind: "vault"
  },
  withdrawMany: {
    name: "withdrawMany",
    scope: "options:nft:withdrawMany",
    label: "Withdraw all",
    input: "WithdrawManyInput",
    targetKind: "nft"
  },
  claimLossLvst: {
    name: "claimLossLvst",
    scope: "options:vault:claimLoss",
    label: "Claim LVST",
    input: "ClaimLossLvstInput",
    targetKind: "vault"
  },
  stakeLvst: {
    name: "stakeLvst",
    scope: "options:lvst:stake",
    label: "Stake LVST",
    input: "StakeLvstInput",
    targetKind: "lvst"
  },
  unstakeLvst: {
    name: "unstakeLvst",
    scope: "options:lvst:unstake",
    label: "Unstake LVST",
    input: "UnstakeLvstInput",
    targetKind: "lvst"
  },
  claimDividends: {
    name: "claimDividends",
    scope: "options:lvst:claimDividends",
    label: "Claim dividends",
    targetKind: "lvst"
  },
  transferNft: {
    name: "transferNft",
    scope: "options:nft:transfer",
    label: "Transfer NFT",
    input: "TransferNftInput",
    targetKind: "nft"
  },
  approveNft: {
    name: "approveNft",
    scope: "options:nft:approve",
    label: "Approve operator",
    input: "ApproveNftInput",
    targetKind: "nft"
  },
  setApprovalForAll: {
    name: "setApprovalForAll",
    scope: "options:nft:setApprovalForAll",
    label: "Approve all",
    input: "SetApprovalForAllInput",
    targetKind: "global"
  }
} as const satisfies Record<string, CatalogEntry>;

const projectMintFunctions = (panel: OptionsPanel, functions: OptionsFunctionView[]): void => {
  for (const market of panel.markets) {
    const target: OptionsFunctionTarget = { kind: "market", marketId: market.marketId };
    const hasNft = panel.nfts.some((nft) => nft.marketId === market.marketId);

    functions.push(
      hasNft
        ? disabledFunction(CATALOG.mint, target, "Already entered this market")
        : enabledFunction(CATALOG.mint, target)
    );
    functions.push(
      hasNft
        ? disabledFunction(CATALOG.mintWithSalt, target, "Already entered this market")
        : enabledFunction(CATALOG.mintWithSalt, target)
    );
  }
};

const projectLvstFunctions = (panel: OptionsPanel, functions: OptionsFunctionView[]): void => {
  const target: OptionsFunctionTarget = { kind: "lvst" };
  const { canStake, canUnstake, canClaimDividends } = panel.lvst.actions;

  functions.push(
    canStake
      ? enabledFunction(CATALOG.stakeLvst, target)
      : disabledFunction(CATALOG.stakeLvst, target, "No unstaked LVST")
  );
  functions.push(
    canUnstake
      ? enabledFunction(CATALOG.unstakeLvst, target)
      : disabledFunction(CATALOG.unstakeLvst, target, "Nothing staked")
  );
  functions.push(
    canClaimDividends
      ? enabledFunction(CATALOG.claimDividends, target)
      : disabledFunction(CATALOG.claimDividends, target, "No dividends pending")
  );
};

const projectNftFunctions = (
  panel: OptionsPanel,
  nft: OptionsNftPanel,
  functions: OptionsFunctionView[]
): void => {
  const target: OptionsFunctionTarget = {
    kind: "nft",
    marketId: nft.marketId,
    tokenId: nft.tokenId
  };
  const ownsNft = nft.owner === panel.account;

  functions.push(
    ownsNft
      ? enabledFunction(CATALOG.setLanes, target)
      : disabledFunction(CATALOG.setLanes, target, "NFT not owned")
  );

  // Balance-first: add funds anytime you own the NFT, no active stream required.
  functions.push(
    ownsNft
      ? enabledFunction(CATALOG.addFunds, target)
      : disabledFunction(CATALOG.addFunds, target, "NFT not owned")
  );

  // Sweep is available with an active stream OR a parked balance to pull back.
  const hasSweepable = nft.account.status === "streaming" || nft.account.status === "idle";
  functions.push(
    ownsNft && hasSweepable
      ? enabledFunction(CATALOG.stopAllFunding, target)
      : disabledFunction(
          CATALOG.stopAllFunding,
          target,
          ownsNft ? "Nothing to sweep" : "NFT not owned"
        )
  );

  const hasWinningClaim = nft.lanes.some((lane) => lane.settlement?.canClaimWin === true);
  functions.push(
    hasWinningClaim
      ? enabledFunction(CATALOG.withdrawMany, target)
      : disabledFunction(CATALOG.withdrawMany, target, "No winnings to claim")
  );

  functions.push(
    ownsNft
      ? enabledFunction(CATALOG.transferNft, target)
      : disabledFunction(CATALOG.transferNft, target, "NFT not owned")
  );
  functions.push(
    ownsNft
      ? enabledFunction(CATALOG.approveNft, target)
      : disabledFunction(CATALOG.approveNft, target, "NFT not owned")
  );
};

const projectVaultFunctions = (
  panel: OptionsPanel,
  market: OptionsMarketPanel,
  vault: OptionsVaultPanel,
  functions: OptionsFunctionView[]
): void => {
  const vaultTarget: OptionsFunctionTarget = {
    kind: "vault",
    marketId: market.marketId,
    vaultId: vault.vaultId
  };
  const nft = panel.nfts.find((entry) => entry.marketId === market.marketId);
  const vaultOpen = vault.status === "open" || vault.status === "hot";
  const lanesOnVault = lanesForVault(panel, vault.vaultId);
  const hasLaneOnVault = lanesOnVault.length > 0;
  const alreadyFundedReason =
    "Vault already funded (one side per vault) — stop or adjust lanes to change";

  for (const side of ["yes", "no"] as const) {
    const fundTarget: OptionsFunctionTarget = { ...vaultTarget, side };
    const fundLabel = `Fund ${side === "yes" ? "YES" : "NO"}`;

    if (nft === undefined) {
      functions.push(
        disabledFunction(CATALOG.fund, fundTarget, "Mint an NFT first", fundLabel)
      );
      continue;
    }

    if (hasLaneOnVault) {
      functions.push(
        disabledFunction(CATALOG.fund, fundTarget, alreadyFundedReason, fundLabel)
      );
      continue;
    }

    if (!vaultOpen) {
      functions.push(disabledFunction(CATALOG.fund, fundTarget, "Vault closed", fundLabel));
      continue;
    }

    functions.push(enabledFunction(CATALOG.fund, fundTarget, fundLabel));
  }

  const activeLane = lanesOnVault.find(isActiveLane);
  functions.push(
    activeLane === undefined
      ? disabledFunction(CATALOG.stopFunding, vaultTarget, "No active stream")
      : enabledFunction(CATALOG.stopFunding, { ...vaultTarget, side: activeLane.side })
  );

  const hasWinningClaim = lanesOnVault.some((lane) => lane.settlement?.canClaimWin === true);
  functions.push(
    hasWinningClaim
      ? enabledFunction(CATALOG.withdraw, vaultTarget)
      : disabledFunction(CATALOG.withdraw, vaultTarget, "No winnings to claim")
  );

  const hasLosingClaim = lanesOnVault.some((lane) => lane.settlement?.canClaimLoss === true);
  functions.push(
    hasLosingClaim
      ? enabledFunction(CATALOG.claimLossLvst, vaultTarget)
      : disabledFunction(CATALOG.claimLossLvst, vaultTarget, "No losing position")
  );
};

const enabledFunction = (
  entry: CatalogEntry,
  target: OptionsFunctionTarget,
  label = entry.label
): OptionsFunctionView => ({
  name: entry.name,
  scope: entry.scope,
  label,
  ...(entry.input === undefined ? {} : { input: entry.input }),
  target,
  disabled: false
});

const disabledFunction = (
  entry: CatalogEntry,
  target: OptionsFunctionTarget,
  disabledReason: string,
  label = entry.label
): OptionsFunctionView => ({
  name: entry.name,
  scope: entry.scope,
  label,
  ...(entry.input === undefined ? {} : { input: entry.input }),
  target,
  disabled: true,
  disabledReason
});

const lanesForVault = (panel: OptionsPanel, vaultId: string): readonly OptionsLanePanel[] =>
  panel.nfts.flatMap((nft) => nft.lanes.filter((lane) => lane.vaultId === vaultId));

const isActiveLane = (lane: OptionsLanePanel): boolean => lane.status === "streaming";

// The pool's CURRENT growth rate (USDC base units/sec): the on-chain side rate (set at the last
// advance) minus any funder lane whose runway has already ended by `nowMs`. Subtracting the expired
// boundaries keeps the slope honest — a lane that has run dry no longer adds to the pool, so the UI
// won't over-tick and then snap back on the next poll.
const currentSideRate = (
  board: OptionsBoardState,
  boundaries: readonly FunderBoundary[] | undefined,
  nowMs: number
): bigint => {
  let rate = board.sideRate;
  if (boundaries !== undefined) {
    for (const boundary of boundaries) {
      if (boundary.rate > 0n && boundary.maxEndMs <= nowMs) {
        rate -= boundary.rate;
      }
    }
  }
  return rate > 0n ? rate : 0n;
};

const projectMarketPanel = (
  marketSnapshot: OptionsMarketSnapshot,
  vaultSnapshots: readonly OptionsVaultSnapshot[]
): OptionsMarketPanel => {
  // One wall-clock instant for the whole panel so every vault's live pool AND its growth rate are
  // measured at the same moment (the rate must be the slope at exactly the pool's read time).
  const nowMs = Date.now();
  const marketCreatedAtMs = marketSnapshot.market.timing?.createdAtMs;
  const vaultPanels = marketSnapshot.vaults.map((vault) => {
    const enriched = vaultSnapshots.find((entry) => entry.vault.vaultId === vault.vaultId);
    return projectVaultPanel(vault, enriched, nowMs, marketCreatedAtMs);
  });

  const totalPooled = marketSnapshot.vaults.reduce(
    (sum, vault) => sum + totalVaultPool(vault.pools),
    0n
  );
  const livePooled = vaultPanels.reduce((sum, vault) => sum + vault.pools.livePoolUSDC, 0);
  const livePooledRate = vaultPanels.reduce(
    (sum, vault) => sum + vault.pools.poolRatePerSecUSDC,
    0
  );

  const activeVaults = marketSnapshot.vaults.filter(
    (vault) => vault.status === "open" || vault.status === "hot"
  ).length;
  const resolvedVaults = marketSnapshot.vaults.filter(
    (vault) => vault.status === "resolved" || vault.status === "disputed"
  ).length;

  return {
    marketId: marketSnapshot.market.marketId,
    title: marketSnapshot.market.title,
    creator: marketSnapshot.market.creator,
    ...(marketSnapshot.market.streamId === undefined
      ? {}
      : { streamId: marketSnapshot.market.streamId }),
    ...(marketSnapshot.market.category === undefined
      ? {}
      : { category: marketSnapshot.market.category }),
    status: marketSnapshot.market.status,
    vaultIds: [...marketSnapshot.market.vaultIds],
    totals: {
      pooledUSDC: usdcToNumber(totalPooled),
      totalPooledUSDC: usdcToNumber(totalPooled),
      livePooledUSDC: livePooled,
      livePooledRatePerSecUSDC: livePooledRate,
      activeVaults,
      resolvedVaults
    },
    ...(marketSnapshot.market.timing === undefined
      ? {}
      : { timing: marketSnapshot.market.timing }),
    vaults: vaultPanels,
    ...(marketSnapshot.streamState === undefined
      ? {}
      : {
          stream: {
            status: marketSnapshot.streamState.status,
            scheme: marketSnapshot.streamState.scheme,
            id: marketSnapshot.streamState.id,
            ...(marketSnapshot.streamState.updatedAtMs === 0
              ? {}
              : { updatedAtMs: marketSnapshot.streamState.updatedAtMs }),
            ...(marketSnapshot.streamState.endedAtMs === 0
              ? {}
              : { endedAtMs: marketSnapshot.streamState.endedAtMs })
          }
        })
  };
};

const projectVaultPanel = (
  vault: OptionsMarketSnapshot["vaults"][number],
  snapshot?: OptionsVaultSnapshot,
  nowMs: number = Date.now(),
  // The vault contract stores no creation timestamp (VaultData has only resolvedAt), so getVault can't
  // supply one and mapVault hardcodes 0 — which renders as "1:00:00 AM" and a ~29.7M "minute" downstream.
  // The market DOES record createdAt, and a vault is created right after its market, so the market's
  // timestamp is the correct, real, on-chain proxy. Threaded down from projectMarketPanel.
  marketCreatedAtMs?: number
): OptionsVaultPanel => {
  const pools = snapshot?.pools ?? vault.pools;
  const settledTotal = totalVaultPool(pools);
  // Cap the live pool at funder depletion using the contract's canonical boundary schedule (every
  // active funder's maxEnd + rate). Read straight from Vault.getBoundaries, so the cap holds for any
  // viewer — connected user, anonymous host pool reader, multi-funder — without reconstruction.
  const boundaries = snapshot?.boundaries;
  const livePools =
    snapshot?.boards === undefined
      ? pools
      : projectVaultLivePools({
          boards: snapshot.boards,
          atMs: nowMs,
          pendingBoundaries: snapshot.pendingBoundaries,
          funderBoundaries: boundaries,
          resolvedAtMs: vault.timing.resolvedAtMs
        });
  const liveTotal = totalVaultPool(livePools);
  // Odds, pool bars, and share price all read the LIVE per-side pools. The settled pools sit at 0
  // between advances (always, on a frozen dev chain), and computeOdds(0,0,0) returns a flat 50/50 —
  // so a vault that has clearly streamed in still showed even odds. Live is the truth the user sees.
  const odds = computeOdds(livePools.yes, livePools.no, liveTotal);

  // Current per-second growth of the live pool. 0 when there is no board (anonymous market view) or
  // the vault has resolved (its pool is frozen at resolution, so it no longer streams).
  const resolvedAtMs = vault.timing.resolvedAtMs;
  const frozen = resolvedAtMs !== undefined && resolvedAtMs <= nowMs;
  const poolRatePerSec =
    snapshot?.boards === undefined || frozen
      ? 0n
      : currentSideRate(snapshot.boards.yes, boundaries?.yes, nowMs) +
        currentSideRate(snapshot.boards.no, boundaries?.no, nowMs);

  return {
    vaultId: vault.vaultId,
    marketId: vault.marketId,
    question: vault.question,
    type: vault.type,
    creator: vault.creator,
    status: vault.status,
    outcome: vault.outcome,
    pools: {
      yesUSDC: usdcToNumber(pools.yes),
      noUSDC: usdcToNumber(pools.no),
      totalUSDC: usdcToNumber(settledTotal),
      settledPoolUSDC: usdcToNumber(settledTotal),
      livePoolUSDC: usdcToNumber(liveTotal),
      liveYesUSDC: usdcToNumber(livePools.yes),
      liveNoUSDC: usdcToNumber(livePools.no),
      poolRatePerSecUSDC: usdcToNumber(poolRatePerSec),
      sharePriceYes: usdcToNumber(priceOf(livePools.yes)),
      sharePriceNo: usdcToNumber(priceOf(livePools.no))
    },
    shareTotals: {
      yes: sharesToNumber(snapshot?.shareTotals.yes ?? 0n),
      no: sharesToNumber(snapshot?.shareTotals.no ?? 0n)
    },
    odds,
    // Fall back to the market's createdAt only when the vault carries none (EVM: always 0; Sui sets a
    // real one at decode). Keeps a genuine per-vault timestamp where it exists, kills the epoch-0 render
    // where it doesn't.
    timing: {
      ...vault.timing,
      createdAtMs: vault.timing.createdAtMs > 0 ? vault.timing.createdAtMs : (marketCreatedAtMs ?? vault.timing.createdAtMs)
    },
    steward: {
      hot: vault.steward.hot,
      ...(vault.steward.hotUntilMs === undefined
        ? {}
        : { hotUntilMs: vault.steward.hotUntilMs }),
      ...(vault.steward.hotReason === undefined ? {} : { hotReason: vault.steward.hotReason }),
      ...(vault.steward.severity === undefined ? {} : { severity: vault.steward.severity }),
      ...(vault.steward.exitBurnBps === undefined
        ? {}
        : { exitBurnBps: vault.steward.exitBurnBps }),
      ...(vault.steward.disputeId === undefined ? {} : { disputeId: vault.steward.disputeId })
    }
  };
};

const projectNftPanel = (entry: OptionsNftSnapshot, ctx: ProjectPanelContext): OptionsNftPanel => {
  const { lvstDecimals } = ctx;
  const realLanes = entry.nft.lanes;
  const tokenId = entry.nft.tokenId.toString();

  // Per-NFT realized P&L from existing lane/NFT fields (no new reads).
  let returned = 0n;
  let lostLvst = 0n;
  for (const lane of realLanes) {
    if (lane.won === true && lane.claimable !== undefined) {
      returned += lane.claimable;
    } else if (lane.won === false && lane.lossClaimable !== undefined) {
      lostLvst += lane.lossClaimable;
    }
  }

  // Canonical account status from the LIVE balance + active lanes. The reader already drains the balance,
  // so depleted ⇒ ~0 with no special-case flooring. activeRate doubles as the UI's drain rate.
  const balance = entry.nft.balance ?? 0n;
  const activeRate = realLanes
    .filter((lane) => lane.rate > 0n && !lane.depleted)
    .reduce((sum, lane) => sum + lane.rate, 0n);
  const hasDepleted = realLanes.some((lane) => lane.depleted);
  const status: OptionsAccountStatus =
    activeRate > 0n ? "streaming" : hasDepleted ? "depleted" : balance > 0n ? "idle" : "empty";

  // Paused lanes (session intent) overlay the matching ledger position — forcing "paused" + the remembered
  // resume rate. A paused entry with NO ledger position (paused before any shares accrued) is re-injected.
  const pausedByKey = new Map(
    (ctx.pausedLanes ?? [])
      .filter((p) => p.tokenId === tokenId)
      .map((p) => [`${p.vaultId}:${p.side}`, p] as const)
  );
  const realKeys = new Set(realLanes.map((lane) => `${lane.vaultId}:${lane.side}`));
  const pausedOnly = [...pausedByKey.values()]
    .filter((p) => !realKeys.has(`${p.vaultId}:${p.side}`))
    .map(projectPausedLanePanel);

  return {
    tokenId,
    marketId: entry.nft.marketId,
    owner: entry.nft.owner,
    laneCount: entry.nft.laneCount,
    lanes: [
      ...realLanes.map((lane) =>
        projectLanePanel(
          lane,
          lvstDecimals,
          ctx.shareTotalsByVault?.get(lane.vaultId)?.[lane.side],
          pausedByKey.get(`${lane.vaultId}:${lane.side}`)?.rate,
          balance > 0n
        )
      ),
      ...pausedOnly
    ],
    transfer: {
      ...(entry.nft.approved === undefined ? {} : { approved: entry.nft.approved }),
      ...(entry.nft.isOperator === undefined ? {} : { isOperator: entry.nft.isOperator })
    },
    account: {
      status,
      ...(entry.nft.balance === undefined
        ? {}
        : { balanceUSDC: usdcToNumber(balance), balanceRaw: balance.toString() }),
      ...(status === "streaming" && entry.nft.runwayEndMs !== undefined
        ? { endsAtMs: entry.nft.runwayEndMs, drainRatePerSecUSDC: usdcToNumber(activeRate) }
        : {})
    },
    pnl: {
      returnedUSDC: usdcToNumber(returned),
      lostLVST: lvstToNumber(lostLvst, lvstDecimals),
      remainingUSDC: usdcToNumber(balance)
    }
  };
};

const projectLanePanel = (
  lane: OptionsNftSnapshot["nft"]["lanes"][number],
  lvstDecimals: number,
  sideShareTotal?: bigint,
  pausedRate?: bigint,
  hasBalance = false
): OptionsLanePanel => {
  const streaming = !lane.depleted && lane.rate > 0n;
  // Money-driven status: streaming while a rate flows; else PAUSED as long as the deposit (the NFT's shared
  // balance) is still there to resume from (stopped / switched-away / one leg streaming while the other
  // sits), or DEPLETED once the money is gone (ran dry or swept). No separate "banked" state.
  const status: OptionsLaneStatus = streaming ? "streaming" : hasBalance ? "paused" : "depleted";
  const displayRate = pausedRate ?? lane.rate; // remembered resume rate if paused via the button, else live

  return {
    vaultId: lane.vaultId,
    side: lane.side,
    status,
    stream: {
      ratePerMinUSDC: rateToPerMinUSDC(displayRate),
      ratePerSecRaw: displayRate.toString(),
      ...(streaming && lane.maxEndMs !== undefined ? { endsAtMs: lane.maxEndMs } : {})
    },
    shares: {
      accrued: sharesToNumber(lane.sharesAccrued),
      accruedRaw: lane.sharesAccrued.toString(),
      ...(sideShareTotal !== undefined && sideShareTotal > 0n
        ? { percentOfSide: Number((lane.sharesAccrued * 10_000n) / sideShareTotal) / 100 }
        : {})
    },
    ...(lane.won === undefined
      ? {}
      : {
          settlement: {
            won: lane.won,
            claimableUSDC: usdcToNumber(lane.claimable ?? 0n),
            lossClaimableLVST: lvstToNumber(lane.lossClaimable ?? 0n, lvstDecimals),
            canClaimWin: (lane.claimable ?? 0n) > 0n,
            canClaimLoss: (lane.lossClaimable ?? 0n) > 0n
          }
        })
  };
};

// A paused lane: dropped on-chain so shares aren't re-read (0 here), shown at the rate it resumes at.
const projectPausedLanePanel = (paused: OptionsPausedLane): OptionsLanePanel => ({
  vaultId: paused.vaultId,
  side: paused.side,
  status: "paused",
  stream: {
    ratePerMinUSDC: rateToPerMinUSDC(paused.rate),
    ratePerSecRaw: paused.rate.toString()
  },
  shares: { accrued: 0, accruedRaw: "0" }
});

const projectLvstPanel = (account: LvstAccount, lvstDecimals: number): OptionsLvstPanel => {
  // O3: staking REMOVES LVST from the wallet (Treasury._stake pulls it), so the reader's `balance`
  // (wallet balanceOf / getBalance) already excludes staked — it IS the stakeable amount. The old
  // `balance - staked` double-subtracted and under-reported (often 0) the unstaked total.
  const unstaked = account.balance;

  return {
    account: account.account,
    balanceLVST: lvstToNumber(account.balance, lvstDecimals),
    stakedLVST: lvstToNumber(account.staked, lvstDecimals),
    unstakedLVST: lvstToNumber(unstaked, lvstDecimals),
    pendingDividendsUSDC: usdcToNumber(account.pendingDividends),
    ...(account.totalEarned === undefined
      ? {}
      : { totalEarnedLVST: lvstToNumber(account.totalEarned, lvstDecimals) }),
    actions: {
      canStake: unstaked > 0n,
      canUnstake: account.staked > 0n,
      canClaimDividends: account.pendingDividends > 0n
    }
  };
};

const computeOdds = (
  yesPoolIn: bigint | number | string,
  noPoolIn: bigint | number | string,
  totalIn: bigint | number | string
): OptionsVaultPanel["odds"] => {
  // E2E pass-2 fix: pool/total values can arrive as JS numbers (e.g. catalog-sourced
  // market snapshots serialize uint256 as numbers), and mixing BigInt with number throws
  // "Cannot mix BigInt and other types". Coerce at the boundary so the panel projection
  // never crashes the whole live board over one stray number.
  const yesPool = BigInt(yesPoolIn);
  const noPool = BigInt(noPoolIn);
  const total = BigInt(totalIn);
  if (total === 0n) {
    return {
      yesMultiplier: 1,
      noMultiplier: 1,
      yesProbabilityBps: 5000,
      noProbabilityBps: 5000
    };
  }

  const yesProbabilityBps = Number((yesPool * 10_000n) / total);
  const noProbabilityBps = 10_000 - yesProbabilityBps;

  return {
    yesMultiplier: yesPool > 0n ? Number(total) / Number(yesPool) : 1,
    noMultiplier: noPool > 0n ? Number(total) / Number(noPool) : 1,
    yesProbabilityBps,
    noProbabilityBps
  };
};
