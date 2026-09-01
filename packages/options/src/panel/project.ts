// --- exports ---

import type {
  LvstAccount,
  OptionsFundingStream,
  OptionsMarketSnapshot,
  OptionsUserOptionsSnapshot,
  OptionsUserVaultPosition,
  OptionsVault,
  OptionsVaultSnapshot
} from "../model/index.js";
import { isFundingStreamPaused, totalVaultPool } from "../model/index.js";
import type {
  OptionsLvstPanel,
  OptionsMarketPanel,
  OptionsPanel,
  OptionsSidePanel,
  OptionsVaultPanel,
  OptionsVaultUserPanel
} from "./types.js";

export const projectOptionsPanel = (snapshot: OptionsUserOptionsSnapshot): OptionsPanel => ({
  account: snapshot.account,
  markets: snapshot.markets.map((marketSnapshot) =>
    projectMarketPanel(marketSnapshot, snapshot.vaults)
  ),
  lvst: projectLvstPanel(snapshot.lvstAccount),
  ...(snapshot.protocol === undefined ? {} : { protocol: snapshot.protocol }),
  user: {
    account: snapshot.account,
    ...(snapshot.marketId === undefined ? {} : { marketId: snapshot.marketId })
  }
});

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
  vault: OptionsVault,
  snapshot?: OptionsVaultSnapshot
): OptionsVaultPanel => {
  const pools = vault.pools;
  const total = totalVaultPool(pools);
  const odds = computeOdds(pools.yes, pools.no, total);
  const winningSide =
    vault.outcome === "yes" || vault.outcome === "no" ? vault.outcome : null;

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
    odds,
    timing: vault.timing,
    steward: {
      hot: vault.steward.hot,
      ...(vault.steward.hotUntilMs === undefined
        ? {}
        : { hotUntilMs: vault.steward.hotUntilMs }),
      ...(vault.steward.hotReason === undefined ? {} : { hotReason: vault.steward.hotReason }),
      ...(vault.steward.disputeId === undefined ? {} : { disputeId: vault.steward.disputeId })
    },
    ...(snapshot?.userPosition === undefined && snapshot?.funding === undefined
      ? {}
      : {
          user: projectVaultUserPanel(
            snapshot?.userPosition,
            snapshot?.funding,
            winningSide,
            vault.status
          )
        })
  };
};

const projectVaultUserPanel = (
  position: OptionsUserVaultPosition | undefined,
  funding: { readonly yes: OptionsFundingStream; readonly no: OptionsFundingStream } | undefined,
  winningSide: "yes" | "no" | null,
  vaultStatus: OptionsVault["status"]
): OptionsVaultUserPanel | undefined => {
  if (position === undefined) {
    return undefined;
  }

  const yes = projectSidePanel(
    position.positions.yes,
    funding?.yes,
    winningSide,
    vaultStatus
  );
  const no = projectSidePanel(position.positions.no, funding?.no, winningSide, vaultStatus);

  const streamed = position.positions.yes.streamed + position.positions.no.streamed;
  const shares = position.positions.yes.shares + position.positions.no.shares;
  const currentValue =
    position.positions.yes.currentValue + position.positions.no.currentValue;
  const claimable = position.positions.yes.claimable + position.positions.no.claimable;
  const lossClaimable =
    (position.positions.yes.lossClaimable ?? 0n) + (position.positions.no.lossClaimable ?? 0n);

  const yesRate = funding?.yes.ratePerMinute ?? 0n;
  const noRate = funding?.no.ratePerMinute ?? 0n;
  const yesActive = funding?.yes.active === true && !isFundingStreamPaused(funding.yes);
  const noActive = funding?.no.active === true && !isFundingStreamPaused(funding.no);

  return {
    account: position.account,
    positions: { yes, no },
    totals: {
      streamedUSDC: streamed.toString(),
      shares: shares.toString(),
      currentValueUSDC: currentValue.toString(),
      claimableUSDC: claimable.toString(),
      lossClaimableLVST: lossClaimable.toString()
    },
    activeFunding: {
      yesRatePerMinuteUSDC: yesRate.toString(),
      noRatePerMinuteUSDC: noRate.toString(),
      totalRatePerMinuteUSDC: (yesRate + noRate).toString(),
      anyActive: yesActive || noActive,
      allPaused: !yesActive && !noActive
    }
  };
};

const projectSidePanel = (
  position: OptionsUserVaultPosition["positions"]["yes"],
  funding: OptionsFundingStream | undefined,
  winningSide: "yes" | "no" | null,
  vaultStatus: OptionsVault["status"]
): OptionsSidePanel => {
  const ratePerMinute = funding?.ratePerMinute ?? 0n;
  const paused =
    funding === undefined || isFundingStreamPaused(funding) || funding.active === false;
  const resolved = vaultStatus === "resolved" || vaultStatus === "disputed";

  return {
    side: position.side,
    streamedUSDC: position.streamed.toString(),
    shares: position.shares.toString(),
    currentValueUSDC: position.currentValue.toString(),
    claimableUSDC: position.claimable.toString(),
    lossClaimableLVST: (position.lossClaimable ?? 0n).toString(),
    fundingRatePerMinuteUSDC: ratePerMinute.toString(),
    fundingActive: funding?.active === true && !isFundingStreamPaused(funding),
    streamPaused: paused,
    isWinningSide: resolved && winningSide !== null ? position.side === winningSide : null,
    released: position.released
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
    lossClaims: {
      claimableLVST: account.lossClaims.claimable.toString(),
      claimedLVST: account.lossClaims.claimed.toString(),
      stakedFromClaimsLVST: account.lossClaims.stakedFromClaims.toString()
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
