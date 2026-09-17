import type { UserAddress } from "@livestreak/options";
import type { PackageRuntimeInit } from "@livestreak/schema";
import { bridgeActionScope, type BridgeCaller, type CallActionEnvelope, type FunctionDescriptor } from "@livestreak/schema";
import {
  createOptionsBridge,
  createOptionsChain,
  createOptionsRuntime,
  createOptionsRuntimeBootstrap,
  optionsChainConfigFromPackageInit,
  projectOptionsDescriptors
} from "@livestreak/options";
import type { OptionsChain, PausedLanesPort } from "@livestreak/options";
import { localOperatorCaller } from "../gateway/auth/caller.js";
import type { ConsoleEdge } from "../gateway/console/edge.js";

export interface CreateOptionsConsoleEdgeInput {
  readonly packageInit: PackageRuntimeInit;
  readonly readRpcUrl: string;
  readonly userAddress: UserAddress;
  /** File-backed persistence for the paused-lane registry (survives a gateway restart). */
  readonly pausedLanes?: PausedLanesPort;
  /** Test seam: substitute the reader/writer so the operator flow can be driven without a live chain. */
  readonly chain?: OptionsChain;
}

export const createOptionsConsoleEdge = (input: CreateOptionsConsoleEdgeInput): ConsoleEdge => {
  const chainConfig = optionsChainConfigFromPackageInit(input.packageInit, {
    readRpcUrl: input.readRpcUrl
  });
  const { runtimeConfig } = createOptionsRuntimeBootstrap(input.packageInit, {
    runtimeId: "cli-options-remote",
    readRpcUrl: input.readRpcUrl,
    user: input.userAddress
  });

  const chain = input.chain ?? createOptionsChain(chainConfig);
  // pausedLanes is a top-level runtime input, NOT a config key — inside config it validates away
  // silently and pause persistence never engages.
  const runtime = createOptionsRuntime({
    chain,
    chainConfig,
    config: runtimeConfig,
    ...(input.pausedLanes === undefined ? {} : { pausedLanes: input.pausedLanes })
  });
  const bridge = createOptionsBridge({ runtime });
  const caller = localOperatorCaller();

  return {
    package: "options",

    describeFunctions: async (): Promise<readonly FunctionDescriptor[]> =>
      projectOptionsDescriptors(runtime.readPanel()),

    dispatch: async (remoteCaller: BridgeCaller, envelope: CallActionEnvelope) => {
      const result = await bridge.callAction(remoteCaller, {
        scope: bridgeActionScope,
        action: envelope.action,
        args: envelope.args
      });
      if (typeof result === "object" && result !== null) {
        const r = result as { txId?: unknown; tokenId?: unknown };
        return {
          ...(r.txId === undefined ? {} : { txId: String(r.txId) }),
          ...(r.tokenId === undefined ? {} : { tokenId: String(r.tokenId) })
        };
      }
      return { txId: String(result) };
    },

    subscribeBoard: (listener) => bridge.subscribeBoard(caller, listener),

    readBoard: () => bridge.readBoard(caller)
  };
};
