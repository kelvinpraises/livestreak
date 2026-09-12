import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect, Scope } from "effect";
import {
  buildControlCatalog,
  createObserveBridge,
  createObserveRuntime,
  defaultFileExportConfigure,
  descriptorId,
  fileCaptureRunConfig,
  makeObserveRun,
  mountObserveT0Bus,
  projectObserveDescriptors,
  systemConfigConfigureScope,
  systemRunPrepareScope,
  systemRunStartScope,
  systemRunStopScope,
  type ObserveRuntime,
  type SystemConfigConfigurePayload
} from "@livestreak/observe";
import type { PackageRuntimeInit } from "@livestreak/schema";
import type { BridgeCaller, CallActionEnvelope, FunctionDescriptor } from "@livestreak/schema";
import { localOperatorCaller } from "../gateway/auth/caller.js";
import type { ConsoleEdge } from "../gateway/console/edge.js";

// Internal bridge scopes for every observe control, indexed from the static catalog (which already
// enumerates all capture/sink/system cells). Two indexes: `byId` keys on the cell-qualified descriptor id
// (unique — the console sends this), `byAction` on the bare name (collides across cells, so last-write
// wins; only used as the legacy fallback for the programmatic driver, which touches just system:config).
const buildObserveScopes = (): {
  readonly byId: ReadonlyMap<string, string>;
  readonly byAction: ReadonlyMap<string, string>;
} => {
  const catalog = buildControlCatalog();
  const byId = new Map<string, string>();
  const byAction = new Map<string, string>();
  for (const [cellId, cell] of Object.entries(catalog.cells)) {
    for (const [name, fn] of Object.entries(cell.functions)) {
      byId.set(descriptorId(cellId, name), fn.scope);
      byAction.set(name, fn.scope);
    }
  }
  return { byId, byAction };
};

const OBSERVE_SCOPES = buildObserveScopes();

export interface CreateObserveConsoleEdgeInput {
  readonly packageInit: PackageRuntimeInit;
  readonly runId: string;
  /** Host relay base URL (e.g. http://127.0.0.1:8787) — the local WebRTC sink signals through it. */
  readonly hostBaseUrl: string;
}

// Shell ObserveRunConfig (temp paths) for store identity only — T0 board stays system:config until
// configure; kernel prepareRun / drivers mount after configure, not at edge construction.
const stubRunConfig = async (runId: string) => {
  const base = join(tmpdir(), `livestreak-remote-${runId}`);
  await mkdir(base, { recursive: true });
  return fileCaptureRunConfig(runId, join(base, "capture.mp4"), join(base, "output"), "file-export");
};

export const createObserveConsoleEdge = (input: CreateObserveConsoleEdgeInput): ConsoleEdge => {
  const { packageInit, runId, hostBaseUrl } = input;
  const { byId: scopeById, byAction: scopeByAction } = OBSERVE_SCOPES;
  let runtimePromise: Promise<ObserveRuntime> | undefined;

  const bridgeCaller = (): BridgeCaller => localOperatorCaller();

  // The runtime lives in a process-lifetime scope (NOT a per-call Effect.scoped that would close
  // immediately) so the streaming worker forked by startRun survives across dispatch calls.
  const getRuntime = (): Promise<ObserveRuntime> => {
    if (runtimePromise === undefined) {
      runtimePromise = Effect.runPromise(Scope.make()).then((scope) =>
        Effect.runPromise(
          createObserveRuntime({ sessionInit: packageInit }).pipe(
            Effect.provideService(Scope.Scope, scope)
          )
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

  // Run-execution lifecycle (prepare/start/stop) is OBSERVE's domain: the runtime derives the run config
  // from the configured board and wires the local WebRTC sink itself. The edge supplies only the host base
  // URL it owns (for the sink's signaling) and routes the scope — no observe board/config/sink knowledge.
  const prepareLiveRun = async (runtime: ObserveRuntime): Promise<{ txId: string }> => {
    await ensureT0Run(runtime);
    await Effect.runPromise(runtime.prepareConfiguredRun(runId, { hostBaseUrl }));
    return { txId: `prepare-${runId}` };
  };

  const startLiveRun = async (runtime: ObserveRuntime): Promise<{ txId: string }> => {
    await Effect.runPromise(runtime.startRun(runId));
    return { txId: `start-${runId}` };
  };

  const stopLiveRun = async (runtime: ObserveRuntime, args: unknown): Promise<{ txId: string }> => {
    const reason =
      typeof args === "object" && args !== null && typeof (args as { reason?: unknown }).reason === "string"
        ? (args as { reason: string }).reason
        : undefined;
    await Effect.runPromise(runtime.stopRun(runId, reason === undefined ? undefined : { reason }));
    return { txId: `stop-${runId}` };
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
      // Console path: the cell-qualified descriptor id resolves to exactly one cell (so capture:file /
      // sink:local / sink:file-export `configure` no longer collide). Legacy path (no id): bare action
      // name — `configure` is pinned to system:config, every other observe action name is unique.
      const internalScope =
        envelope.id !== undefined
          ? scopeById.get(envelope.id)
          : envelope.action === "configure"
            ? systemConfigConfigureScope
            : scopeByAction.get(envelope.action);
      if (internalScope === undefined) {
        throw new Error(`Unknown observe action "${envelope.id ?? envelope.action}"`);
      }

      // Run-execution lifecycle drives the kernel directly (the board-first T0 bus only wires config +
      // market lifecycle). prepare/start build & run the producer from the configured board.
      if (internalScope === systemRunPrepareScope) {
        return withRuntime(prepareLiveRun);
      }
      if (internalScope === systemRunStartScope) {
        return withRuntime(startLiveRun);
      }
      if (internalScope === systemRunStopScope) {
        return withRuntime((runtime) => stopLiveRun(runtime, envelope.args));
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
