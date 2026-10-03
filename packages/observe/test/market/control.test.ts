import { describe, expect, it, vi } from "vitest";
import { Effect, Exit } from "effect";
import { LiveStreakRuntimeError } from "@livestreak/core";
import { buildControlCatalog } from "#run/control/index.js";
import { createControlBus } from "#run/control/bus/index.js";
import { createInitialBoard } from "#run/control/board/index.js";
import { createObserveControlSurfaces } from "#run/control/surfaces.js";
import {
  marketCatalogFunctions,
  marketGoLiveScope,
  marketRegisterScope,
  marketSetEndedScope
} from "#market/control.js";
import { NO_RECORDING_POINTER_ID, RECORDING_POINTER_KEY } from "#market/keys.js";
import type { MarketLifecycleInput, MarketStorageScheme } from "#market/types.js";
import type { Board } from "#run/control/board/index.js";
import { extendBoardForMarketTests } from "#test/helpers/board.js";
import {
  createFakeMarketRegistrar,
  defaultFakeRegisterResult
} from "#test/helpers/fake-market-registrar.js";

// 0x + 64 hex — the bytes32 shape marketId has on EVM, Sui AND Solana.
const MARKET = `0x${"ab".repeat(32)}`;

const testSessionInit = {
  package: "observe",
  chain: "eip155:31337",
  contracts: { marketRegistry: "0x00000000000000000000000000000000000000aa" },
  wallet: {
    chain: "eip155:31337",
    seed: "0xseed",
    walletInit: { chain: "evm", seedSource: "raw", config: {} as never },
    operatorAddress: "0x0000000000000000000000000000000000000001"
  },
  hostUrl: "http://127.0.0.1:8787"
} as const;

const marketBoardWith = (runId: string, readonly: Record<string, unknown>): Board => {
  const base = extendBoardForMarketTests(createInitialBoard({ runId, nowMs: 1 }), runId);
  const market = base.cells.market!;
  return {
    ...base,
    cells: { ...base.cells, market: { ...market, readonly: { ...market.readonly, ...readonly } } }
  };
};

/** Drive one lifecycle verb over the bus and capture what reached the registrar. */
const callLifecycle = async (input: {
  readonly scope: typeof marketGoLiveScope | typeof marketSetEndedScope | "market:recording" | "market:retryRecording";
  readonly payload?: unknown;
  readonly marketReadonly?: Record<string, unknown>;
  readonly defaultPointerScheme?: MarketStorageScheme;
  readonly producerStatus?: string;
  readonly hostApiToken?: string;
}) => {
  const runId = "run_lifecycle";
  const seen: MarketLifecycleInput[] = [];

  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const bus = yield* createControlBus({
        runId,
        board: (() => {
          const board = marketBoardWith(runId, input.marketReadonly ?? { registrationState: "registered", marketId: MARKET });
          if (input.producerStatus === undefined) return board;
          const runCell = board.cells["system:run"]!;
          return { ...board, cells: { ...board.cells, "system:run": { ...runCell, status: [input.producerStatus, null, 1] as const } } };
        })(),
        catalog: buildControlCatalog(),
        surfaces: createObserveControlSurfaces({
          sessionInit: {...testSessionInit, ...(input.hostApiToken ? {hostApiToken:input.hostApiToken} : {})},
          market: {
            ...(input.defaultPointerScheme === undefined
              ? {}
              : { defaultPointerScheme: input.defaultPointerScheme }),
            resolveRegistrar: () =>
              Effect.succeed(
                createFakeMarketRegistrar({
                  onGoLive: (i) => seen.push({ marketId: i.marketId, scheme: i.scheme, id: i.id }),
                  onSetEnded: (i) => seen.push({ marketId: i.marketId, scheme: i.scheme, id: i.id })
                })
              )
          }
        })
      });

      yield* bus.callFunction({
        callId: "lc-1",
        runId,
        scope: input.scope,
        ...(input.payload === undefined ? {} : { payload: input.payload })
      });

      return yield* bus.readBoard();
    })
  );

  return { exit, seen };
};

describe("market board controls", () => {
  it("market.register patches board to registered via bus call", async () => {
    const runId = "run_market_control";
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const bus = yield* createControlBus({
          runId,
          board: extendBoardForMarketTests(createInitialBoard({ runId, nowMs: 1 }), runId),
          catalog: buildControlCatalog(),
          surfaces: createObserveControlSurfaces({
            sessionInit: {
              package: "observe",
              chain: "eip155:31337",
              contracts: { marketRegistry: "0x00000000000000000000000000000000000000aa" },
              wallet: {
                chain: "eip155:31337",
                seed: "0xseed",
                walletInit: { chain: "evm", seedSource: "raw", config: {} as never },
                operatorAddress: "0x0000000000000000000000000000000000000001"
              },
              hostUrl: "http://127.0.0.1:8787"
            },
            market: {
              resolveRegistrar: () =>
                Effect.succeed(
                  createFakeMarketRegistrar({
                    result: defaultFakeRegisterResult({ runId, title: "demo" })
                  })
                )
            }
          })
        });

        yield* bus.callFunction({
          callId: "reg-1",
          runId,
          scope: marketRegisterScope,
          payload: { title: "demo" }
        });

        return yield* bus.readBoard();
      })
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.cells.market?.status[0]).toBe("registered");
      expect(exit.value.cells.market?.readonly).toMatchObject({
        registrationState: "registered"
      });
    }
  });
});

describe("market lifecycle pointer/scheme derivation", () => {
  it("goLive derives the pointer from the board market cell when the payload carries none", async () => {
    const { exit, seen } = await callLifecycle({ scope: marketGoLiveScope });

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ marketId: MARKET, scheme: 4, id: MARKET.slice(2) });
  });

  it("the derived pointer is exactly 64 chars — the length every registrar accepts", async () => {
    const { seen } = await callLifecycle({ scope: marketGoLiveScope });

    expect(seen[0]?.id).toHaveLength(64);
    expect(seen[0]?.id.startsWith("0x")).toBe(false);
  });

  it("a marketId that is not a bytes32 fails loudly instead of emitting a short pointer", async () => {
    const { exit, seen } = await callLifecycle({
      scope: marketGoLiveScope,
      marketReadonly: { registrationState: "registered", marketId: "0xabc" }
    });

    expect(Exit.isFailure(exit)).toBe(true);
    expect(seen).toHaveLength(0);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("exactly 64 chars");
      expect(String(exit.cause)).toContain("0xabc");
    }
  });

  it("an explicit pointerId and scheme still win over the derivation", async () => {
    const { seen } = await callLifecycle({
      scope: marketGoLiveScope,
      payload: { scheme: 2, pointerId: "bafyStoragePointerId" }
    });

    expect(seen[0]).toEqual({ marketId: MARKET, scheme: 2, id: "bafyStoragePointerId" });
  });

  // The seam is pinned through the SHARED constant, not a restated literal: if Slice-2's writer
  // and this reader ever disagreed on the key name, this test would go green while the feature
  // silently never wired up. Writing the cell via RECORDING_POINTER_KEY makes that impossible.
  it("unverified saved recording metadata cannot claim an archive", async () => {
    const { seen } = await callLifecycle({
      scope: marketSetEndedScope,
      marketReadonly: {
        registrationState: "live",
        marketId: MARKET,
        [RECORDING_POINTER_KEY]: { marketId: MARKET, id: "walrusBlobIdForTheRecording" }
      }
    });

    expect(seen[0]).toEqual({
      marketId: MARKET,
      scheme: 0,
      id: NO_RECORDING_POINTER_ID
    });
  });

  it("a recording bound to another market is ignored — the end stays honest", async () => {
    const { seen } = await callLifecycle({
      scope: marketSetEndedScope,
      marketReadonly: {
        registrationState: "live",
        marketId: MARKET,
        [RECORDING_POINTER_KEY]: { marketId: "0xprevMarket", id: "walrusBlobIdForRunN" }
      }
    });

    expect(seen[0]).toEqual({ marketId: MARKET, scheme: 0, id: NO_RECORDING_POINTER_ID });
  });

  it("a legacy bare-string recording is treated as unbound", async () => {
    const { seen } = await callLifecycle({
      scope: marketSetEndedScope,
      marketReadonly: {
        registrationState: "live",
        marketId: MARKET,
        [RECORDING_POINTER_KEY]: "walrusBlobIdForTheRecording"
      }
    });

    expect(seen[0]).toEqual({ marketId: MARKET, scheme: 0, id: NO_RECORDING_POINTER_ID });
  });

  it("a bare setEnded ends with the explicit no-recording marker, never the marketId formality", async () => {
    const { exit, seen } = await callLifecycle({
      scope: marketSetEndedScope,
      marketReadonly: { registrationState: "live", marketId: MARKET },
      defaultPointerScheme: 1
    });

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(seen[0]).toEqual({ marketId: MARKET, scheme: 0, id: NO_RECORDING_POINTER_ID });
    expect(seen[0]?.id).not.toBe(MARKET.slice(2));
  });

  it("a typed recording pointer is rejected until bytes can be verified", async () => {
    const { exit, seen } = await callLifecycle({ scope: marketSetEndedScope,
      payload: { scheme: 2, pointerId: "bafyRealRecordingBlob" } });
    expect(Exit.isFailure(exit)).toBe(true);
    expect(seen).toEqual([]);
    expect(String(exit)).toContain("unverified");
  });

  it("a lifecycle call before register still fails clearly on the missing marketId", async () => {
    const { exit, seen } = await callLifecycle({
      scope: marketGoLiveScope,
      marketReadonly: { registrationState: "none" }
    });

    expect(Exit.isFailure(exit)).toBe(true);
    expect(seen).toHaveLength(0);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain("requires marketId");
    }
  });

  it("goLive is fieldless and setEnded exposes only the explicit replay choice", () => {
    const catalog = marketCatalogFunctions();

    expect(catalog.goLive?.input).toBeUndefined();
    expect(catalog.setEnded?.input).toMatchObject({ type: "object", properties: [{ name: "publishReplay", value: { type: "boolean", default: false } }] });
    expect(catalog.register?.input).toBeDefined();
  });
});

 describe("end producer gate", () => {
  it.each(["starting", "running", "paused", "stopping", "draining"])("refuses %s before any chain submission", async producerStatus => {
    const { exit, seen } = await callLifecycle({ scope: marketSetEndedScope, producerStatus });
    expect(Exit.isFailure(exit)).toBe(true);
    expect(seen).toEqual([]);
  });
  it.each(["stopped", "failed"])("permits a terminal %s producer", async producerStatus => {
    const { exit, seen } = await callLifecycle({ scope: marketSetEndedScope, producerStatus });
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(seen).toEqual([{ marketId: MARKET, scheme: 0, id: "" }]);
  });
  it("rejects the old marketId-derived recording pointer", async () => {
    const { exit, seen } = await callLifecycle({ scope: marketSetEndedScope, payload: { pointerId: MARKET.slice(2) } });
    expect(Exit.isFailure(exit)).toBe(true);
    expect(seen).toEqual([]);
  });
 });

 describe("end submission checkpoint", () => {
  it("persists the original hash across a confirmation failure and restored board retry", async () => {
    let calls = 0;
    const makeBus = (board: Board) => createControlBus({ runId: "run_lifecycle", board,
      catalog: buildControlCatalog(), surfaces: createObserveControlSurfaces({ sessionInit: testSessionInit,
        market: { resolveRegistrar: () => Effect.succeed({ ...createFakeMarketRegistrar(),
          setEnded: input => Effect.gen(function* () {
            calls++;
            if (calls === 1) {
              yield* input.onSubmitted!("original-end-hash");
              return yield* Effect.fail(new LiveStreakRuntimeError({ message: "confirmation timed out" }));
            }
            expect(input.submittedHash).toBe("original-end-hash");
            return { userOpHash: input.submittedHash!, endedAtMs: 1234000 };
          })
        }) }
      }) });
    const first = await Effect.runPromise(makeBus(marketBoardWith("run_lifecycle", { marketId: MARKET, registrationState: "live" })));
    await expect(Effect.runPromise(first.callFunction({ callId: "first-end", runId: "run_lifecycle", scope: marketSetEndedScope }))).rejects.toThrow("timed out");
    const firstBoard = await Effect.runPromise(first.readBoard());
    expect(firstBoard.cells.market?.readonly?.endSubmission).toEqual({ marketId: MARKET, scheme: 0, id: "", hash: "original-end-hash" });
    expect(firstBoard.cells.market?.readonly?.registrationState).toBe("live");
    const restored = await Effect.runPromise(makeBus(JSON.parse(JSON.stringify(firstBoard))));
    await Effect.runPromise(restored.callFunction({ callId: "retry-end", runId: "run_lifecycle", scope: marketSetEndedScope }));
    const ended = await Effect.runPromise(restored.readBoard());
    expect(ended.cells.market?.readonly).toMatchObject({ registrationState: "ended", pointerId: "", endedAtMs: 1234000, userOpHash: "original-end-hash" });
  });
 });


describe("verified replay publishing", () => {
  it("publishes only a ready receipt bound to this exact market/run", async () => {
    const pointer={scheme:"host",id:"a".repeat(64),url:"https://media.example/content/replay"};
    vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({status:"ready",marketId:MARKET,runId:"run_lifecycle",chain:"evm",pointer}))));
    try {
      const result=await callLifecycle({scope:marketSetEndedScope,payload:{publishReplay:true},marketReadonly:{registrationState:"ended",marketId:MARKET},hostApiToken:"private"});
      expect(result.seen).toEqual([{marketId:MARKET,scheme:4,id:pointer.id}]);
      vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({status:"ready",marketId:MARKET,runId:"another-run",chain:"evm",pointer}))));
      const wrong=await callLifecycle({scope:marketSetEndedScope,payload:{publishReplay:true},marketReadonly:{registrationState:"ended",marketId:MARKET},hostApiToken:"private"});
      expect(wrong.seen).toEqual([]);expect(Exit.isFailure(wrong.exit)).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });
  it("does not erase a previously published replay on a plain repeated end",async()=>{
    const result=await callLifecycle({scope:marketSetEndedScope,marketReadonly:{registrationState:"ended",marketId:MARKET,scheme:4,pointerId:"a".repeat(64)}});
    expect(result.seen).toEqual([{marketId:MARKET,scheme:4,id:"a".repeat(64)}]);
  });
});

it("recording progress is bound to this market and makes no chain submission", async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>new Response(JSON.stringify({id:"a".repeat(64),status:"processing",marketId:MARKET,runId:"run_lifecycle",chain:"evm",segments:3,bytes:12345,durationSeconds:12}))));
 try{const result=await callLifecycle({scope:"market:recording",marketReadonly:{registrationState:"ended",marketId:MARKET}});expect(result.seen).toEqual([]);expect(Exit.isSuccess(result.exit)).toBe(true);if(Exit.isSuccess(result.exit))expect(result.exit.value.cells.market?.readonly).toMatchObject({recordingState:"processing",recordingSegments:3,recordingDurationSeconds:12});}finally{vi.unstubAllGlobals();}
});
