// --- exports ---

import type {
  LvstAccount,
  OptionsMarketSnapshot,
  OptionsNftSnapshot,
  OptionsUserOptionsSnapshot,
  OptionsVaultSnapshot
} from "../../model/index.js";
import { totalVaultPool } from "../../model/index.js";
import type {
  OptionsControlsView,
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

export const projectOptionsControls = (panel: OptionsPanel): OptionsControlsView => {
  const hasClaimableWin = panel.nfts.some((nft) =>
    nft.lanes.some((lane) => lane.canClaimWin === true)
  );
  const hasClaimableLoss = panel.nfts.some((nft) =>
    nft.lanes.some((lane) => lane.canClaimLoss === true)
  );
  const activeMarketId = panel.user.marketId;
  const canMint =
    activeMarketId !== undefined &&
    !panel.nfts.some((nft) => nft.marketId === activeMarketId);

  return {
    account: panel.account,
    actions: {
      canMint,
      canFund: panel.nfts.length > 0,
      canWithdraw: hasClaimableWin,
      canClaimLoss: hasClaimableLoss,
      canStakeLvst: panel.lvst.actions.canStake,
      canUnstakeLvst: panel.lvst.actions.canUnstake,
      canClaimDividends: panel.lvst.actions.canClaimDividends,
      canTransferNft: panel.nfts.length > 0
    }
  };
};

// --- helpers ---

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
    vaults: vaultPanels
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
      totalUSDC: total.toString()
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
  ...(entry.nft.isOperator === undefined ? {} : { isOperator: entry.nft.isOperator })
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
  const unstaked =
    account.balance > account.staked ? account.balance - account.staked : 0n;

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
