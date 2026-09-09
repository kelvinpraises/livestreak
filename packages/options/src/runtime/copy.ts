// --- exports ---

import type {
  OptionsMarketSnapshot,
  OptionsNftSnapshot,
  OptionsUserOptionsSnapshot,
  OptionsVaultSnapshot
} from "../model/snapshot.js";
import type { OptionsRuntimeLastError, OptionsRuntimeState } from "./store.js";

export const copyMarketSnapshot = (
  snapshot: OptionsMarketSnapshot
): OptionsMarketSnapshot => ({
  market: {
    ...snapshot.market,
    vaultIds: [...snapshot.market.vaultIds],
    ...(snapshot.market.timing === undefined ? {} : { timing: { ...snapshot.market.timing } })
  },
  vaults: snapshot.vaults.map((vault) => ({
    ...vault,
    pools: { ...vault.pools },
    steward: { ...vault.steward },
    timing: { ...vault.timing }
  })),
  ...(snapshot.streamState === undefined ? {} : { streamState: { ...snapshot.streamState } })
});

export const copyVaultSnapshot = (snapshot: OptionsVaultSnapshot): OptionsVaultSnapshot => ({
  vault: {
    ...snapshot.vault,
    pools: { ...snapshot.vault.pools },
    steward: { ...snapshot.vault.steward },
    timing: { ...snapshot.vault.timing }
  },
  pools: { ...snapshot.pools },
  shareTotals: { ...snapshot.shareTotals },
  boards: {
    yes: { ...snapshot.boards.yes },
    no: { ...snapshot.boards.no }
  },
  pendingBoundaries: { ...snapshot.pendingBoundaries },
  hot: { ...snapshot.hot },
  dispute: { ...snapshot.dispute }
});

export const copyNftSnapshot = (snapshot: OptionsNftSnapshot): OptionsNftSnapshot => ({
  nft: {
    ...snapshot.nft,
    lanes: snapshot.nft.lanes.map((lane) => ({ ...lane })),
    ...(snapshot.nft.balance === undefined ? {} : { balance: snapshot.nft.balance }),
    ...(snapshot.nft.runwayEndMs === undefined ? {} : { runwayEndMs: snapshot.nft.runwayEndMs })
  }
});

export const copyUserOptionsSnapshot = (
  snapshot: OptionsUserOptionsSnapshot
): OptionsUserOptionsSnapshot => ({
  account: snapshot.account,
  ...(snapshot.marketId === undefined ? {} : { marketId: snapshot.marketId }),
  markets: snapshot.markets.map(copyMarketSnapshot),
  vaults: snapshot.vaults.map(copyVaultSnapshot),
  nfts: snapshot.nfts.map(copyNftSnapshot),
  lvstAccount: { ...snapshot.lvstAccount },
  ...(snapshot.usdcBalance === undefined ? {} : { usdcBalance: snapshot.usdcBalance }),
  ...(snapshot.protocol === undefined ? {} : { protocol: { ...snapshot.protocol } })
});

export const copyRuntimeState = (state: OptionsRuntimeState): OptionsRuntimeState => ({
  runtimeId: state.runtimeId,
  revision: state.revision,
  ...(state.userSnapshot === undefined
    ? {}
    : { userSnapshot: copyUserOptionsSnapshot(state.userSnapshot) }),
  markets: state.markets.map(copyMarketSnapshot),
  vaults: state.vaults.map(copyVaultSnapshot),
  memory: { ...state.memory },
  ...(state.lastError === undefined
    ? {}
    : { lastError: copyRuntimeLastError(state.lastError) })
});

// --- helpers ---

const copyRuntimeLastError = (error: OptionsRuntimeLastError): OptionsRuntimeLastError => ({
  message: error.message,
  ...(error.details === undefined ? {} : { details: error.details })
});
