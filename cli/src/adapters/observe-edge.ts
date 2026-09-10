import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { Effect } from "effect";
import {
  createObserveBridge,
  createObserveRuntime,
  fileCaptureRunConfig,
  projectControlPanelControls,
  projectObserveDescriptors,
  buildControlCatalog,
  type ObserveRuntime
} from "@livestreak/observe";
import type { PackageRuntimeInit } from "@livestreak/schema";
import type { BridgeCaller, CallActionEnvelope, FunctionDescriptor } from "@livestreak/schema";
import { localOperatorCaller } from "../gateway/auth/caller.js";
import type { ConsoleEdge } from "../gateway/console/edge.js";

const buildObserveScopeByAction = (): ReadonlyMap<string, string> => {
  const catalog = buildControlCatalog();
  const map = new Map<string, string>();
  for (const cell of Object.values(catalog.cells)) {
    for (const [name, fn] of Object.entries(cell.functions)) {
      map.set(name, fn.scope);
    }
  }
  return map;
};

const OBSERVE_SCOPE_BY_ACTION = buildObserveScopeByAction();

export interface CreateObserveConsoleEdgeInput {
  readonly packageInit: PackageRuntimeInit;
  readonly runId: string;
}

const placeholderRunConfig = async (runId: string) => {
  const base = join(tmpdir(), `livestreak-remote-${runId}`);
  await mkdir(base, { recursive: true });
  const capturePath = join(base, "capture.mp4");
  await writeFile(capturePath, "");
  return fileCaptureRunConfig(runId, capturePath, join(base, "output"), "file-export");
};

export const createObserveConsoleEdge = (input: CreateObserveConsoleEdgeInput): ConsoleEdge => {
  const { packageInit, runId } = input;
  const scopeByAction = OBSERVE_SCOPE_BY_ACTION;
  let runtimePromise: Promise<ObserveRuntime> | undefined;

  const bridgeCaller = (): BridgeCaller => localOperatorCaller();

  const getRuntime = (): Promise<ObserveRuntime> => {
    if (runtimePromise === undefined) {
      runtimePromise = Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const runtime = yield* createObserveRuntime({ sessionInit: packageInit });
            const config = yield* Effect.promise(() => placeholderRunConfig(runId));
            yield* runtime.prepareRun(config, { sessionInit: packageInit });
            return runtime;
          })
        )
      );
    }
    return runtimePromise;
  };

  const withRuntime = async <A>(fn: (runtime: ObserveRuntime) => Promise<A>): Promise<A> =>
    fn(await getRuntime());

  return {
    package: "observe",

    describeFunctions: async (): Promise<readonly FunctionDescriptor[]> =>
      withRuntime(async (runtime) => {
        const bridge = createObserveBridge({ runtime, sessionInit: packageInit });
        const board = await Effect.runPromise(runtime.readBoard(runId));
        const controls = await Effect.runPromise(bridge.readControls({ caller: bridgeCaller(), runId }));
        return projectObserveDescriptors(controls, board);
      }).catch(() => {
        const catalog = buildControlCatalog();
        const controls = projectControlPanelControls({
          board: { revision: 1, catalogVersion: "0.1.0", cells: {} },
          catalog
        });
        return projectObserveDescriptors(controls);
      }),

    dispatch: async (_remoteCaller: BridgeCaller, envelope: CallActionEnvelope) => {
      const internalScope = scopeByAction.get(envelope.action);
      if (internalScope === undefined) {
        throw new Error(`Unknown observe action "${envelope.action}"`);
      }
      return withRuntime(async (runtime) => {
        const bridge = createObserveBridge({ runtime, sessionInit: packageInit });
        const result = await Effect.runPromise(
          bridge.callFunction({
            caller: bridgeCaller(),
            envelope: {
              callId: `remote-${Date.now()}`,
              runId,
              scope: internalScope,
              payload: envelope.args
            }
          })
        );
        return {
          txId: result.callId,
          ...(result.artifactId === undefined ? {} : { tokenId: result.artifactId })
        };
      });
    },

    subscribeBoard: (listener) => {
      let unsub: (() => void) | undefined;
      void withRuntime(async (runtime) => {
        const bridge = createObserveBridge({ runtime, sessionInit: packageInit });
        const subscription = await Effect.runPromise(
          bridge.subscribeBoard({
            caller: bridgeCaller(),
            runId,
            listener: (board) => listener(board)
          })
        );
        unsub = () => subscription.unsubscribe();
      }).catch(() => {
        /* runtime init failed */
      });
      return () => unsub?.();
    },

    readBoard: () =>
      withRuntime(async (runtime) => {
        const bridge = createObserveBridge({ runtime, sessionInit: packageInit });
        return Effect.runPromise(bridge.readBoard({ caller: bridgeCaller(), runId }));
      })
  };
};
