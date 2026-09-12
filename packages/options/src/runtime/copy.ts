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

// Deep-copy a vault snapshot for the immutable store. structuredClone copies EVERY field (bigints
// included) so the snapshot can't silently lose one the way the old hand-written spread did — it
// dropped `boundaries` (and `winningSide`/`pot`/`collected`), so the store served the projection
// a snapshot it couldn't cap the live pool from. One clone designs out the whole add-a-field-then-
// forget-to-copy class of bug.
export const copyVaultSnapshot = (snapshot: OptionsVaultSnapshot): OptionsVaultSnapshot =>
  structuredClone(snapshot);

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
