import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect } from "effect";
import {
  buildControlCatalog,
  createObserveBridge,
  createObserveRuntime,
  defaultFileExportConfigure,
  fileCaptureRunConfig,
  makeObserveRun,
  mountObserveT0Bus,
  projectObserveDescriptors,
  systemConfigConfigureScope,
  type ObserveRuntime,
  type SystemConfigConfigurePayload
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

// Shell ObserveRunConfig (temp paths) for store identity only — T0 board stays system:config until
// configure; kernel prepareRun / drivers mount after configure, not at edge construction.
const stubRunConfig = async (runId: string) => {
  const base = join(tmpdir(), `livestreak-remote-${runId}`);
  await mkdir(base, { recursive: true });
  return fileCaptureRunConfig(runId, join(base, "capture.mp4"), join(base, "output"), "file-export");
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
            return yield* createObserveRuntime({ sessionInit: packageInit });
          })
        )
      );
    }
    return runtimePromise;
  };

  const ensureT0Run = async (runtime: ObserveRuntime): Promise<void> => {
    const existing = await Effect.runPromise(runtime.store.get(runId));
    if (existing !== undefined) {
      return;
    }
    const config = await stubRunConfig(runId);
    const run = await Effect.runPromise(makeObserveRun(config));
    const mounted = await Effect.runPromise(
      mountObserveT0Bus(run, { sessionInit: packageInit })
    );
    await Effect.runPromise(runtime.store.put(mounted));
  };

  const withRuntime = async <A>(fn: (runtime: ObserveRuntime) => Promise<A>): Promise<A> =>
    fn(await getRuntime());

  const syncRunBoard = async (runtime: ObserveRuntime): Promise<void> => {
    const run = await Effect.runPromise(runtime.store.require(runId));
    const board = await Effect.runPromise(runtime.readBoard(runId));
    await Effect.runPromise(runtime.store.replace({ ...run, board }));
  };

  const configurePayloadFromArgs = (args: unknown): SystemConfigConfigurePayload => {
    if (typeof args === "object" && args !== null && !Array.isArray(args)) {
      const record = args as Record<string, unknown>;
      if (
        typeof record.chain === "string" &&
        typeof record.capture === "string" &&
        typeof record.publish === "string" &&
        record.process === null
      ) {
        return {
          chain: record.chain,
          capture: record.capture,
          process: null,
          publish: record.publish
        };
      }
    }
    return defaultFileExportConfigure({ chain: packageInit.chain });
  };

  return {
    package: "observe",

    describeFunctions: async (): Promise<readonly FunctionDescriptor[]> =>
      withRuntime(async (runtime) => {
        await ensureT0Run(runtime);
        const bridge = createObserveBridge({ runtime, sessionInit: packageInit });
        const board = await Effect.runPromise(runtime.readBoard(runId));
        const controls = await Effect.runPromise(bridge.readControls({ caller: bridgeCaller(), runId }));
        return projectObserveDescriptors(controls, board);
      }),

    dispatch: async (_remoteCaller: BridgeCaller, envelope: CallActionEnvelope) => {
      const internalScope =
        envelope.action === "configure" && envelope.scope === undefined
          ? systemConfigConfigureScope
          : scopeByAction.get(envelope.action);
      if (internalScope === undefined) {
        throw new Error(`Unknown observe action "${envelope.action}"`);
      }
      return withRuntime(async (runtime) => {
        await ensureT0Run(runtime);
        const bridge = createObserveBridge({ runtime, sessionInit: packageInit });
        const payload =
          internalScope === systemConfigConfigureScope
            ? configurePayloadFromArgs(envelope.args)
            : envelope.args;
        const result = await Effect.runPromise(
          bridge.callFunction({
            caller: bridgeCaller(),
            envelope: {
              callId: `remote-${Date.now()}`,
              runId,
              scope: internalScope,
              payload
            }
          })
        );
        await syncRunBoard(runtime);
        return {
          txId: result.callId,
          ...(result.artifactId === undefined ? {} : { tokenId: result.artifactId })
        };
      });
    },

    subscribeBoard: (listener) => {
      let unsub: (() => void) | undefined;
      void withRuntime(async (runtime) => {
        await ensureT0Run(runtime);
        const bridge = createObserveBridge({ runtime, sessionInit: packageInit });
        const subscription = await Effect.runPromise(
          bridge.subscribeBoard({
            caller: bridgeCaller(),
            runId,
            listener: (board) => listener(board)
          })
        );
        unsub = () => subscription.unsubscribe();
      });
      return () => unsub?.();
    },

    readBoard: () =>
      withRuntime(async (runtime) => {
        await ensureT0Run(runtime);
        const bridge = createObserveBridge({ runtime, sessionInit: packageInit });
        return Effect.runPromise(bridge.readBoard({ caller: bridgeCaller(), runId }));
      })
  };
};
