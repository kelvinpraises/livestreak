import {
  bridgeActionScope,
  createOptionsBridge,
  createOptionsChain,
  createOptionsRuntime,
  type CallActionEnvelope,
  type MarketId,
  type OptionsBoard,
  type OptionsBridge,
  type OptionsChain,
  type OptionsControlsView,
  type OptionsRuntime,
  type UserAddress
} from "@livestreak/options";
import type { WalletInit } from "@livestreak/schema";
import { localOperatorCaller } from "../gateway/caller.js";
import type { LivestreakInitDoc } from "../prefs/init-doc.js";

export interface CreateOptionsEdgeInput {
  readonly doc: LivestreakInitDoc;
  readonly walletInit: WalletInit;
  readonly seed: string | Uint8Array;
  readonly userAddress: UserAddress;
  readonly marketId?: MarketId;
}

export interface OptionsEdge {
  readonly runtime: OptionsRuntime;
  readonly bridge: OptionsBridge;
  readonly chain: OptionsChain;
  readBoard(): Promise<OptionsBoard>;
  readControls(): Promise<OptionsControlsView>;
  callAction(action: string, args: unknown): Promise<string>;
  subscribeBoard(listener: (board: OptionsBoard) => void): () => void;
  refresh(): Promise<void>;
}

export const createOptionsEdge = (input: CreateOptionsEdgeInput): OptionsEdge => {
  const marketId = input.marketId ?? input.doc.run?.marketId;
  const chainConfig = {
    walletInit: input.walletInit,
    seed: input.seed,
    addresses: {
      marketRegistry: input.doc.options.marketRegistry,
      vault: input.doc.options.vault,
      marketDriver: input.doc.options.marketDriver,
      stewardRegistry: input.doc.options.stewardRegistry,
      treasury: input.doc.options.treasury,
      lvstToken: input.doc.options.lvstToken,
      dripsStreaming: input.doc.options.dripsStreaming
    },
    readRpcUrl: input.doc.chain.rpc
  };

  const chain = createOptionsChain(chainConfig);
  const runtime = createOptionsRuntime({
    chain,
    chainConfig,
    config: {
      runtimeId: "cli-options",
      user: input.userAddress,
      ...(marketId === undefined
        ? {}
        : {
            marketIds: [marketId],
            defaultMarketId: marketId
          })
    }
  });

  const bridge = createOptionsBridge({ runtime });
  const caller = localOperatorCaller();

  return {
    runtime,
    bridge,
    chain,

    readBoard: () => bridge.readBoard(caller),

    readControls: () => bridge.readControls(caller),

    callAction: async (action, args) => {
      const envelope: CallActionEnvelope = {
        scope: bridgeActionScope,
        action,
        args
      };
      const txId = await bridge.callAction(caller, envelope);
      return String(txId);
    },

    subscribeBoard: (listener) => bridge.subscribeBoard(caller, listener),

    refresh: async () => {
      await runtime.refresh();
    }
  };
};

export const buildCallActionEnvelope = (
  action: string,
  args: unknown
): CallActionEnvelope => ({
  scope: bridgeActionScope,
  action,
  args
});
