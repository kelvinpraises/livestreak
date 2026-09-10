import {
  bridgeActionScope,
  createBookmakerBridge,
  createBookmakerRuntime,
  createBookmakerRuntimeBootstrap,
  projectBookmakerDescriptors,
  type BridgeCaller,
  type CallActionEnvelope
} from "@livestreak/bookmaker";
import type { FunctionDescriptor, PackageRuntimeInit } from "@livestreak/schema";
import { localOperatorCaller } from "../gateway/auth/caller.js";
import type { ConsoleEdge } from "../gateway/console/edge.js";

export interface CreateBookmakerEdgeInput {
  readonly packageInit: PackageRuntimeInit;
  readonly readRpcUrl: string;
  readonly userAddress: string;
  readonly usdcAddress: `0x${string}`;
}

const PLACEHOLDER_MARKET = `0x${"00".repeat(31)}01` as const;
const nowMs = (): number => Date.now();

export const createBookmakerEdge = (input: CreateBookmakerEdgeInput): ConsoleEdge => {
  const observeRunId = input.packageInit.runId ?? "remote";

  const runtimeConfig = createBookmakerRuntimeBootstrap(input.packageInit, {
    runtimeId: "cli-bookmaker-remote",
    readRpcUrl: input.readRpcUrl,
    marketId: PLACEHOLDER_MARKET,
    observeRunId,
    watchSource: {
      marketId: PLACEHOLDER_MARKET,
      watchUrl: "http://127.0.0.1/remote",
      webrtcUrl: "http://127.0.0.1/remote"
    }
  }).runtimeConfig;

  const bridge = createBookmakerBridge({
    runtime: createBookmakerRuntime({ config: runtimeConfig })
  });
  const caller = localOperatorCaller();

  return {
    package: "bookmaker",

    describeFunctions: async (): Promise<readonly FunctionDescriptor[]> =>
      projectBookmakerDescriptors(await bridge.readBoard(caller, nowMs())),

    dispatch: async (remoteCaller: BridgeCaller, envelope: CallActionEnvelope) => {
      const bridgeEnvelope: CallActionEnvelope = {
        scope: bridgeActionScope,
        action: envelope.action,
        args: envelope.args
      };
      const result = await bridge.callAction(remoteCaller, bridgeEnvelope, nowMs());
      return { txId: String(result.txId), tokenId: String(result.vaultId) };
    },

    subscribeBoard: (listener) =>
      bridge.subscribeBoard(
        caller,
        (panel) => {
          listener(panel);
        },
        nowMs()
      ),

    readBoard: () => bridge.readBoard(caller, nowMs())
  };
};
