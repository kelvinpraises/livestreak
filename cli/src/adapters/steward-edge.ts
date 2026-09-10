import {
  bridgeActionScope,
  createStewardBridge,
  createStewardRuntime,
  createStewardRuntimeBootstrap,
  projectStewardDescriptors,
  type BridgeCaller,
  type CallActionEnvelope
} from "@livestreak/steward";
import type { FunctionDescriptor, PackageRuntimeInit } from "@livestreak/schema";
import type { ConsoleEdge } from "../gateway/console/edge.js";

const noopFacts = async () => [] as readonly unknown[];
const noopMemorySink = { remember: () => {} };
const noopActionSink = { submit: () => {} };

export interface CreateStewardConsoleEdgeInput {
  readonly packageInit: PackageRuntimeInit;
}

export const createStewardConsoleEdge = (input: CreateStewardConsoleEdgeInput): ConsoleEdge => {
  const runtimeConfig = createStewardRuntimeBootstrap(input.packageInit, {
    runtimeId: "cli-steward-remote",
    stewardId: input.packageInit.wallet.operatorAddress
  }).runtimeConfig;

  const runtime = createStewardRuntime({
    config: runtimeConfig,
    contractFactSource: { readFacts: noopFacts },
    hostFactSource: { readFacts: noopFacts },
    observeFactSource: { readFacts: noopFacts },
    memoryFactSource: { readFacts: noopFacts },
    memorySink: noopMemorySink,
    actionPlanSink: noopActionSink
  });
  const bridge = createStewardBridge({ runtime });

  return {
    package: "steward",

    describeFunctions: async (): Promise<readonly FunctionDescriptor[]> => {
      const snapshot = runtime.readSnapshot();
      return projectStewardDescriptors(snapshot);
    },

    dispatch: async (remoteCaller: BridgeCaller, envelope: CallActionEnvelope) => {
      const bridgeEnvelope: CallActionEnvelope = {
        scope: bridgeActionScope,
        action: envelope.action,
        args: envelope.args
      };
      const txId = await bridge.callAction(remoteCaller, bridgeEnvelope);
      return { txId: String(txId) };
    },

    subscribeBoard: (listener) =>
      bridge.subscribeBoard({ id: "remote-console", trusted: true }, (board) => {
        listener(board);
      }),

    readBoard: async () => bridge.readBoard({ id: "remote-console", trusted: true })
  };
};
