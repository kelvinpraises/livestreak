// --- exports ---

import type {
  LvstAccount,
  OptionsMarketSnapshot,
  OptionsNftSnapshot,
  OptionsUserOptionsSnapshot,
  OptionsVaultSnapshot
} from "../../model/index.js";
import { totalVaultPool, priceOf } from "../../model/index.js";
import type { OptionsVaultSide } from "../../model/vault.js";
import type {
  OptionsControlsView,
  OptionsFunctionTarget,
  OptionsFunctionView,
  OptionsLanePanel,
  OptionsLvstPanel,
  OptionsMarketPanel,
  OptionsNftPanel,
  OptionsPanel,
  OptionsVaultPanel
} from "./types.js";

export const projectOptionsPanel = (snapshot: OptionsUserOptionsSnapshot): OptionsPanel => ({
  account: snapshot.account,
  markets: snapshot.markets.map((marketSnapshot) =>
    projectMarketPanel(marketSnapshot, snapshot.vaults)
  ),
  nfts: snapshot.nfts.map((entry) => projectNftPanel(entry)),
  lvst: projectLvstPanel(snapshot.lvstAccount),
  ...(snapshot.protocol === undefined ? {} : { protocol: snapshot.protocol }),
  user: {
    account: snapshot.account,
    ...(snapshot.marketId === undefined ? {} : { marketId: snapshot.marketId }),
    ...(snapshot.usdcBalance === undefined
      ? {}
      : { usdcBalanceUSDC: snapshot.usdcBalance.toString() })
  }
});

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
    label: "Stop all",
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
  const activeMarketId = panel.user.marketId;
  if (activeMarketId === undefined) {
    return;
  }

  const target: OptionsFunctionTarget = { kind: "market", marketId: activeMarketId };
  const hasNft = panel.nfts.some((nft) => nft.marketId === activeMarketId);

  functions.push(
    hasNft
      ? disabledFunction(CATALOG.mint, target, "Already entered this market")
      : enabledFunction(CATALOG.mint, target)
  );
};

const projectLvstFunctions = (panel: OptionsPanel, functions: OptionsFunctionView[]): void => {
  const target: OptionsFunctionTarget = { kind: "lvst" };
  const unstaked = BigInt(panel.lvst.unstakedLVST);
  const staked = BigInt(panel.lvst.stakedLVST);
  const pendingDividends = BigInt(panel.lvst.pendingDividendsUSDC);

  functions.push(
    unstaked > 0n
      ? enabledFunction(CATALOG.stakeLvst, target)
      : disabledFunction(CATALOG.stakeLvst, target, "No unstaked LVST")
  );
  functions.push(
    staked > 0n
      ? enabledFunction(CATALOG.unstakeLvst, target)
      : disabledFunction(CATALOG.unstakeLvst, target, "Nothing staked")
  );
  functions.push(
    pendingDividends > 0n
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

  const hasActiveLane = nft.lanes.some(isActiveLane);
  functions.push(
    hasActiveLane
      ? enabledFunction(CATALOG.stopAllFunding, target)
      : disabledFunction(CATALOG.stopAllFunding, target, "No active streams")
  );

  const hasWinningClaim = nft.lanes.some((lane) => lane.canClaimWin === true);
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

  const hasWinningClaim = lanesOnVault.some((lane) => lane.canClaimWin === true);
  functions.push(
    hasWinningClaim
      ? enabledFunction(CATALOG.withdraw, vaultTarget)
      : disabledFunction(CATALOG.withdraw, vaultTarget, "No winnings to claim")
  );

  const hasLosingClaim = lanesOnVault.some((lane) => lane.canClaimLoss === true);
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

const isActiveLane = (lane: OptionsLanePanel): boolean =>
  BigInt(lane.rate) > 0n && lane.depleted === false;

const projectMarketPanel = (
  marketSnapshot: OptionsMarketSnapshot,
  vaultSnapshots: readonly OptionsVaultSnapshot[]
): OptionsMarketPanel => {
  const vaultPanels = marketSnapshot.vaults.map((vault) => {
    const enriched = vaultSnapshots.find((entry) => entry.vault.vaultId === vault.vaultId);
    return projectVaultPanel(vault, enriched);
  });

  const totalPooled = marketSnapshot.vaults.reduce(
    (sum, vault) => sum + totalVaultPool(vault.pools),
    0n
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
      pooledUSDC: totalPooled.toString(),
      totalPooledUSDC: totalPooled.toString(),
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
  snapshot?: OptionsVaultSnapshot
): OptionsVaultPanel => {
  const pools = snapshot?.pools ?? vault.pools;
  const total = totalVaultPool(pools);
  const odds = computeOdds(pools.yes, pools.no, total);

  return {
    vaultId: vault.vaultId,
    marketId: vault.marketId,
    question: vault.question,
    type: vault.type,
    creator: vault.creator,
    status: vault.status,
    outcome: vault.outcome,
    pools: {
      yesUSDC: pools.yes.toString(),
      noUSDC: pools.no.toString(),
      totalUSDC: total.toString(),
      sharePriceYes: priceOf(pools.yes).toString(),
      sharePriceNo: priceOf(pools.no).toString()
    },
    shareTotals: {
      yes: (snapshot?.shareTotals.yes ?? 0n).toString(),
      no: (snapshot?.shareTotals.no ?? 0n).toString()
    },
    odds,
    timing: vault.timing,
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

const projectNftPanel = (entry: OptionsNftSnapshot): OptionsNftPanel => ({
  tokenId: entry.nft.tokenId.toString(),
  marketId: entry.nft.marketId,
  laneCount: entry.nft.laneCount,
  lanes: entry.nft.lanes.map(projectLanePanel),
  owner: entry.nft.owner,
  ...(entry.nft.approved === undefined ? {} : { approved: entry.nft.approved }),
  ...(entry.nft.isOperator === undefined ? {} : { isOperator: entry.nft.isOperator }),
  ...(entry.nft.balance === undefined ? {} : { balanceUSDC: entry.nft.balance.toString() }),
  ...(entry.nft.runwayEndMs === undefined ? {} : { runwayEndMs: entry.nft.runwayEndMs })
});

const projectLanePanel = (lane: OptionsNftSnapshot["nft"]["lanes"][number]): OptionsLanePanel => {
  const claimable = lane.claimable ?? 0n;
  const lossClaimable = lane.lossClaimable ?? 0n;

  return {
    vaultId: lane.vaultId,
    side: lane.side,
    rate: lane.rate.toString(),
    sharesAccrued: lane.sharesAccrued.toString(),
    depleted: lane.depleted,
    ...(lane.maxEndMs === undefined ? {} : { maxEndMs: lane.maxEndMs }),
    ...(lane.claimable === undefined ? {} : { claimableUSDC: claimable.toString() }),
    ...(lane.lossClaimable === undefined
      ? {}
      : { lossClaimableLVST: lossClaimable.toString() }),
    ...(lane.won === undefined ? {} : { won: lane.won }),
    ...(lane.claimable === undefined ? {} : { canClaimWin: claimable > 0n }),
    ...(lane.lossClaimable === undefined ? {} : { canClaimLoss: lossClaimable > 0n })
  };
};

const projectLvstPanel = (account: LvstAccount): OptionsLvstPanel => {
  // O3: staking REMOVES LVST from the wallet (Treasury._stake pulls it), so the reader's `balance`
  // (wallet balanceOf / getBalance) already excludes staked — it IS the stakeable amount. The old
  // `balance - staked` double-subtracted and under-reported (often 0) the unstaked total.
  const unstaked = account.balance;

  return {
    account: account.account,
    balanceLVST: account.balance.toString(),
    stakedLVST: account.staked.toString(),
    unstakedLVST: unstaked.toString(),
    pendingDividendsUSDC: account.pendingDividends.toString(),
    ...(account.totalEarned === undefined
      ? {}
      : { totalEarnedLVST: account.totalEarned.toString() }),
    actions: {
      canStake: unstaked > 0n,
      canUnstake: account.staked > 0n,
      canClaimDividends: account.pendingDividends > 0n
    }
  };
};

const computeOdds = (
  yesPool: bigint,
  noPool: bigint,
  total: bigint
): OptionsVaultPanel["odds"] => {
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
