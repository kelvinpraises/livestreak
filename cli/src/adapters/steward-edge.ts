import {
  bridgeActionScope,
  createActionPlanSink,
  createStewardBridge,
  createStewardContractExecutor,
  createStewardRuntime,
  createStewardRuntimeBootstrap,
  projectStewardDescriptors,
  stewardChainConfigFromPackageInit,
  type BridgeCaller,
  type CallActionEnvelope,
  type StewardActionPlanSink,
  type StewardBridge,
  type StewardRuntime,
  type StewardSubject
} from "@livestreak/steward";
import type { FunctionDescriptor, PackageRuntimeInit } from "@livestreak/schema";
import type { ConsoleEdge } from "../gateway/console/edge.js";

const noopFacts = async () => [] as readonly unknown[];
const noopMemorySink = { remember: () => {} };
const CONSOLE_CALLER: BridgeCaller = { id: "remote-console", trusted: true };

export interface CreateStewardConsoleEdgeInput {
  readonly packageInit: PackageRuntimeInit;
}

const readConfigure = (args: unknown): { marketId?: string; vaultId?: string } => {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return {};
  }
  const record = args as Record<string, unknown>;
  return {
    ...(typeof record.marketId === "string" && record.marketId.trim().length > 0
      ? { marketId: record.marketId.trim() }
      : {}),
    ...(typeof record.vaultId === "string" && record.vaultId.trim().length > 0
      ? { vaultId: record.vaultId.trim() }
      : {})
  };
};

export const createStewardConsoleEdge = (input: CreateStewardConsoleEdgeInput): ConsoleEdge => {
  const stewardId = input.packageInit.wallet.operatorAddress ?? "remote-console";

  // The on-chain executor + sink are stable for the session; only the watched subjects change on
  // configure, so the runtime/bridge are rebuilt over the new subjects (executor reused).
  const executor = createStewardContractExecutor(stewardChainConfigFromPackageInit(input.packageInit));
  const actionPlanSink: StewardActionPlanSink = createActionPlanSink({
    contract: executor,
    host: { runHostAction: () => {} }
  });

  let watched: { marketId?: string; vaultId?: string } = {};
  const boardListeners = new Set<(board: unknown) => void>();
  let boardUnsub: (() => void) | undefined;

  const watchedSubjects = (): readonly StewardSubject[] => {
    const subjects: StewardSubject[] = [{ kind: "steward", id: stewardId }];
    if (watched.marketId !== undefined) {
      subjects.push({ kind: "market", id: watched.marketId, marketId: watched.marketId });
    }
    if (watched.vaultId !== undefined) {
      subjects.push({
        kind: "vault",
        id: watched.vaultId,
        vaultId: watched.vaultId,
        ...(watched.marketId === undefined ? {} : { marketId: watched.marketId })
      });
    }
    return subjects;
  };

  const buildRuntime = (): StewardRuntime =>
    createStewardRuntime({
      config: createStewardRuntimeBootstrap(input.packageInit, {
        runtimeId: "cli-steward-remote",
        stewardId,
        watchedSubjects: watchedSubjects()
      }).runtimeConfig,
      contractFactSource: { readFacts: noopFacts },
      hostFactSource: { readFacts: noopFacts },
      observeFactSource: { readFacts: noopFacts },
      memoryFactSource: { readFacts: noopFacts },
      memorySink: noopMemorySink,
      actionPlanSink
    });

  let runtime = buildRuntime();
  let bridge: StewardBridge = createStewardBridge({ runtime });

  const resubscribeBoard = (): void => {
    boardUnsub?.();
    boardUnsub = bridge.subscribeBoard(CONSOLE_CALLER, (board) => {
      for (const listener of boardListeners) {
        listener(board);
      }
    });
  };

  return {
    package: "steward",

    describeFunctions: async (): Promise<readonly FunctionDescriptor[]> =>
      projectStewardDescriptors(runtime.readSnapshot()),

    dispatch: async (remoteCaller: BridgeCaller, envelope: CallActionEnvelope) => {
      // Board-first: configure seeds the watched market/vault subject(s) so their actions (resolve)
      // light up in the function tree, then rebuilds the runtime/bridge over the new subjects.
      if (envelope.action === "configure") {
        watched = readConfigure(envelope.args);
        runtime = buildRuntime();
        bridge = createStewardBridge({ runtime });
        if (boardListeners.size > 0) {
          resubscribeBoard();
        }
        return { txId: `configured-${watched.vaultId ?? watched.marketId ?? "steward"}` };
      }
      const txId = await bridge.callAction(remoteCaller, {
        scope: bridgeActionScope,
        action: envelope.action,
        args: envelope.args
      });
      return { txId: String(txId) };
    },

    subscribeBoard: (listener) => {
      boardListeners.add(listener);
      if (boardUnsub === undefined) {
        resubscribeBoard();
      }
      return () => {
        boardListeners.delete(listener);
      };
    },

    readBoard: async () => bridge.readBoard(CONSOLE_CALLER)
  };
};
