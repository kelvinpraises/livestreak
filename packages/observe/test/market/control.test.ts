import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { buildControlCatalog } from "#run/control/index.js";
import { createControlBus } from "#run/control/bus/index.js";
import { createInitialBoard } from "#run/control/board/index.js";
import { createObserveControlSurfaces } from "#run/control/surfaces.js";
import { marketRegisterScope } from "#market/control.js";
import { extendBoardForMarketTests } from "#test/helpers/board.js";
import {
  createFakeMarketRegistrar,
  defaultFakeRegisterResult
} from "#test/helpers/fake-market-registrar.js";

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
