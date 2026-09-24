import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
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
import { RECORDING_POINTER_KEY } from "#market/keys.js";
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
  readonly scope: typeof marketGoLiveScope | typeof marketSetEndedScope;
  readonly payload?: unknown;
  readonly marketReadonly?: Record<string, unknown>;
  readonly defaultPointerScheme?: MarketStorageScheme;
}) => {
  const runId = "run_lifecycle";
  const seen: MarketLifecycleInput[] = [];

  const exit = await Effect.runPromiseExit(
    Effect.gen(function* () {
      const bus = yield* createControlBus({
        runId,
        board: marketBoardWith(
          runId,
          input.marketReadonly ?? { registrationState: "registered", marketId: MARKET }
        ),
        catalog: buildControlCatalog(),
        surfaces: createObserveControlSurfaces({
          sessionInit: testSessionInit,
          market: {
            ...(input.defaultPointerScheme === undefined
              ? {}
              : { defaultPointerScheme: input.defaultPointerScheme }),
            resolveRegistrar: () =>
              Effect.succeed(
                createFakeMarketRegistrar({
                  onGoLive: (i) => seen.push(i),
                  onSetEnded: (i) => seen.push(i)
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
    expect(seen[0]).toEqual({ marketId: MARKET, scheme: 0, id: MARKET.slice(2) });
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
  it("a board-saved recordingPointer wins over the marketId formality", async () => {
    const { seen } = await callLifecycle({
      scope: marketSetEndedScope,
      marketReadonly: {
        registrationState: "live",
        marketId: MARKET,
        [RECORDING_POINTER_KEY]: "walrusBlobIdForTheRecording"
      }
    });

    expect(seen[0]).toEqual({
      marketId: MARKET,
      scheme: 0,
      id: "walrusBlobIdForTheRecording"
    });
  });

  it("setEnded derives exactly like goLive, and the deps default supplies the scheme", async () => {
    const { seen } = await callLifecycle({
      scope: marketSetEndedScope,
      marketReadonly: { registrationState: "live", marketId: MARKET },
      defaultPointerScheme: 1
    });

    expect(seen[0]).toEqual({ marketId: MARKET, scheme: 1, id: MARKET.slice(2) });
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

  it("goLive and setEnded expose no input fields for the console to render", () => {
    const catalog = marketCatalogFunctions();

    expect(catalog.goLive?.input).toBeUndefined();
    expect(catalog.setEnded?.input).toBeUndefined();
    expect(catalog.register?.input).toBeDefined();
  });
});
