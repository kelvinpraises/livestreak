import {
  bridgeActionScope,
  createOptionsBridge,
  createOptionsChain,
  createOptionsRuntime,
  projectOptionsDescriptors,
  projectOptionsPanel,
  readUserOptionsSnapshot,
  type CallActionEnvelope,
  type MarketId,
  type OptionsBoard,
  type OptionsBridge,
  type OptionsChain,
  type OptionsControlsView,
  type OptionsRuntime,
  type UserAddress
} from "@livestreak/options";
import type { FunctionDescriptor, WalletInit } from "@livestreak/schema";
import { localOperatorCaller } from "../gateway/caller.js";
import type { LivestreakInitDoc } from "../prefs/init-doc.js";

export interface CreateOptionsEdgeInput {
  readonly doc: LivestreakInitDoc;
  readonly walletInit: WalletInit;
  readonly seed: string | Uint8Array;
  readonly userAddress: UserAddress;
  readonly marketId?: MarketId;
}

// The options bridge `mint`/`mintWithSalt` actions return a `MintResult {txId, tokenId}`; the CLI
// stringifies both for rendering/persistence. Lets the CLI route ALL mints through the bridge (no
// onchain TEMP).
export interface MintOutcome {
  readonly txId: string;
  readonly tokenId: string;
}

export interface OptionsEdge {
  readonly runtime: OptionsRuntime;
  readonly bridge: OptionsBridge;
  readonly chain: OptionsChain;
  readBoard(): Promise<OptionsBoard>;
  readControls(): Promise<OptionsControlsView>;
  // Canonical FunctionDescriptor[] for the Remote Bridge Console (the gateway projects these,
  // normalizes scopes, and forwards them to the host → UI). Reads a live user snapshot.
  describeFunctions(): Promise<readonly FunctionDescriptor[]>;
  callAction(action: string, args: unknown): Promise<string>;
  mint(args: { readonly marketId: MarketId; readonly to: UserAddress }): Promise<MintOutcome>;
  mintWithSalt(args: {
    readonly marketId: MarketId;
    readonly salt: bigint;
    readonly to: UserAddress;
  }): Promise<MintOutcome>;
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

  // mint / mintWithSalt both return a MintResult {txId, tokenId}; stringify for the CLI.
  const runMint = async (action: "mint" | "mintWithSalt", args: unknown): Promise<MintOutcome> => {
    const envelope: CallActionEnvelope = { scope: bridgeActionScope, action, args };
    const result = (await bridge.callAction(caller, envelope)) as {
      readonly txId: unknown;
      readonly tokenId: unknown;
    };
    return { txId: String(result.txId), tokenId: String(result.tokenId) };
  };

  return {
    runtime,
    bridge,
    chain,

    readBoard: () => bridge.readBoard(caller),

    readControls: () => bridge.readControls(caller),

    describeFunctions: async () => {
      const snapshot = await readUserOptionsSnapshot(
        chain.reader,
        input.userAddress,
        marketId as MarketId | undefined
      );
      return projectOptionsDescriptors(projectOptionsPanel(snapshot));
    },

    callAction: async (action, args) => {
      const envelope: CallActionEnvelope = {
        scope: bridgeActionScope,
        action,
        args
      };
      const txId = await bridge.callAction(caller, envelope);
      return String(txId);
    },

    mint: (args) => runMint("mint", args),

    mintWithSalt: (args) => runMint("mintWithSalt", args),

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
