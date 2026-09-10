import { type UserAddress } from "@livestreak/options";
import type { PackageRuntimeInit } from "@livestreak/schema";
import { bridgeActionScope, type CallActionEnvelope, type FunctionDescriptor } from "@livestreak/schema";
import {
  createOptionsBridge,
  createOptionsChain,
  createOptionsRuntime,
  createOptionsRuntimeBootstrap,
  optionsChainConfigFromPackageInit,
  projectOptionsDescriptors,
  projectOptionsPanel,
  readUserOptionsSnapshot
} from "@livestreak/options";
import { localOperatorCaller } from "../gateway/auth/caller.js";
import type { ConsoleEdge } from "../gateway/console/edge.js";

export interface CreateOptionsConsoleEdgeInput {
  readonly packageInit: PackageRuntimeInit;
  readonly readRpcUrl: string;
  readonly userAddress: UserAddress;
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

  const chain = createOptionsChain(chainConfig);
  const runtime = createOptionsRuntime({ chain, chainConfig, config: runtimeConfig });
  const bridge = createOptionsBridge({ runtime });
  const caller = localOperatorCaller();

  return {
    package: "options",

    describeFunctions: async (): Promise<readonly FunctionDescriptor[]> => {
      const snapshot = await readUserOptionsSnapshot(chain.reader, input.userAddress, undefined);
      return projectOptionsDescriptors(projectOptionsPanel(snapshot));
    },

    dispatch: async (_remoteCaller, envelope: CallActionEnvelope) => {
      const bridgeEnvelope: CallActionEnvelope = {
        scope: bridgeActionScope,
        action: envelope.action,
        args: envelope.args
      };
      const result = await bridge.callAction(caller, bridgeEnvelope);
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

    refresh: async () => {
      await runtime.refresh();
    },

    readBoard: () => bridge.readBoard(caller)
  };
};
