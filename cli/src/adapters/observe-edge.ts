import { Effect } from "effect";
import { createObserveBridge, projectObserveDescriptors } from "@livestreak/observe";
import type { ObserveRuntime } from "@livestreak/observe";
import type { PackageRuntimeInit } from "@livestreak/schema";
import type { BridgeCaller, CallActionEnvelope, FunctionDescriptor } from "@livestreak/schema";
import { localOperatorCaller } from "../gateway/auth/caller.js";
import type { ConsoleEdge } from "../gateway/console/edge.js";

export interface CreateObserveConsoleEdgeInput {
  readonly packageInit: PackageRuntimeInit;
  readonly runId: string;
  /** Opened via openObserveConsoleRuntime — the gateway shares it (e.g. steward's board facts). */
  readonly runtime: ObserveRuntime;
  /** Host relay base URL (e.g. http://127.0.0.1:8787) — the encode-once live sink signals through it. */
  readonly hostBaseUrl: string;
}

export const createObserveConsoleEdge = (input: CreateObserveConsoleEdgeInput): ConsoleEdge => {
  const { packageInit, runId, runtime, hostBaseUrl } = input;
  const bridge = createObserveBridge({ runtime, sessionInit: packageInit, hostBaseUrl });
  const caller = localOperatorCaller();

  return {
    package: "observe",

    describeFunctions: async (): Promise<readonly FunctionDescriptor[]> => {
      const board = await Effect.runPromise(runtime.readBoard(runId));
      const controls = await Effect.runPromise(bridge.readControls({ caller, runId }));
      return projectObserveDescriptors(controls, board);
    },

    dispatch: async (remoteCaller: BridgeCaller, envelope: CallActionEnvelope) =>
      Effect.runPromise(
        bridge.callConsoleAction({
          caller: remoteCaller,
          runId,
          ...(envelope.id === undefined ? {} : { id: envelope.id }),
          action: envelope.action,
          args: envelope.args
        })
      ),

    subscribeBoard: (listener) => {
      let unsub: (() => void) | undefined;
      void Effect.runPromise(
        bridge.subscribeBoard({ caller, runId, listener: (board) => listener(board) })
      ).then((subscription) => {
        unsub = () => subscription.unsubscribe();
      });
      return () => unsub?.();
    },

    readBoard: () => Effect.runPromise(bridge.readBoard({ caller, runId }))
  };
};
