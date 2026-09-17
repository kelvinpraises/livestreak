import {
  bridgeActionScope,
  createBookmakerBridge,
  createBookmakerRuntime,
  createBookmakerRuntimeBootstrap,
  projectBookmakerDescriptors,
  type BridgeCaller,
  type CallActionEnvelope
} from "@livestreak/bookmaker";
import type { BookmakerChain, IdempotencyPersistencePort } from "@livestreak/bookmaker";
import type { FunctionDescriptor, PackageRuntimeInit } from "@livestreak/schema";
import { localOperatorCaller } from "../gateway/auth/caller.js";
import type { ConsoleEdge } from "../gateway/console/edge.js";

export interface CreateBookmakerEdgeInput {
  readonly packageInit: PackageRuntimeInit;
  readonly readRpcUrl: string;
  readonly userAddress: string;
  readonly usdcAddress: `0x${string}`;
  /** File-backed persistence for settled + pending-userOp state (survives a gateway restart). */
  readonly idempotencyPersistence?: IdempotencyPersistencePort;
  /** Test seam: substitute the on-chain writer so the operator flow can be driven without a live chain. */
  readonly chain?: BookmakerChain;
}

export const createBookmakerEdge = (input: CreateBookmakerEdgeInput): ConsoleEdge => {
  const observeRunId = input.packageInit.runId ?? "remote";
  const caller = localOperatorCaller();

  // Starts UNCONFIGURED (empty marketId): createVault stays hidden until configure supplies a
  // market; the runtime lens swaps markets in place (configure/close are bridge actions).
  const runtime = createBookmakerRuntime({
    config: createBookmakerRuntimeBootstrap(input.packageInit, {
      runtimeId: "cli-bookmaker-remote",
      readRpcUrl: input.readRpcUrl,
      marketId: "",
      observeRunId,
      watchSource: { marketId: "" }
    }).runtimeConfig,
    ...(input.chain === undefined ? {} : { chain: input.chain }),
    ...(input.idempotencyPersistence === undefined
      ? {}
      : { idempotencyPersistence: input.idempotencyPersistence })
  });
  const bridge = createBookmakerBridge({ runtime, now: () => Date.now() });

  return {
    package: "bookmaker",

    describeFunctions: async (): Promise<readonly FunctionDescriptor[]> =>
      projectBookmakerDescriptors(await bridge.readBoard(caller)),

    dispatch: async (remoteCaller: BridgeCaller, envelope: CallActionEnvelope) => {
      const result = await bridge.callAction(remoteCaller, {
        scope: bridgeActionScope,
        action: envelope.action,
        args: envelope.args
      });
      return {
        txId: String(result.txId),
        ...(result.vaultId === undefined ? {} : { tokenId: String(result.vaultId) })
      };
    },

    subscribeBoard: (listener) => bridge.subscribeBoard(caller, listener),

    readBoard: () => bridge.readBoard(caller)
  };
};
