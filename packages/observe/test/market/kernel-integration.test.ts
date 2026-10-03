import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { prepareObserveRun, startObserveRun } from "#run/kernel.js";
import { createSyntheticKernelOptions } from "#test/helpers/runtime.js";
import { createFakeMarketRegistrar } from "#test/helpers/fake-market-registrar.js";
import { minimalEvmMarketRegistrationConfig } from "#test/helpers/market-config.js";
import { createControlBus } from "#run/control/bus/index.js";
import { buildControlCatalog } from "#run/control/index.js";
import { createObserveControlSurfaces } from "#run/control/surfaces.js";
import { makeObserveRunSync } from "#test/helpers/observe-run.js";
import { syntheticCaptureRunConfig } from "#test/helpers/run-config.js";

describe("market registration kernel integration", () => {
  it("does not block the media worker when registration never resolves", async () => {
    const { options } = createSyntheticKernelOptions(3);
    const run = makeObserveRunSync(
      syntheticCaptureRunConfig("run_market_nonblocking", "/tmp/out.mp4")
    );

    const kernelOptions = {
      ...options,
      market: {
        registration: minimalEvmMarketRegistrationConfig("run_market_nonblocking"),
        registrar: createFakeMarketRegistrar({ hang: true })
      }
    };

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const prepared = yield* prepareObserveRun(run, kernelOptions);
        return yield* startObserveRun(prepared, kernelOptions);
      })
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.outcome).toBe("stopped");
      expect(exit.value.board.cells["market"]?.readonly?.registrationState).toBe("none");
    }
  });
});

describe("terminal market producer guard", () => {
  for (const pending of [false, true]) {
    it(`refuses prepare and start for ${pending ? "a pending end" : "an ended market"}`, async () => {
      const { options, delivered } = createSyntheticKernelOptions(3);
      const base = await Effect.runPromise(prepareObserveRun(makeObserveRunSync(syntheticCaptureRunConfig("terminal_guard", "/tmp/out.mp4")), options));
      const marketId = `0x${"ab".repeat(32)}`;
      const board = { ...base.board, cells: { ...base.board.cells,
        market: { ...base.board.cells.market!, status: [pending ? "live" : "ended", null, 1] as const,
          readonly: { marketId, registrationState: pending ? "live" : "ended",
            ...(pending ? { endSubmission: { marketId, hash: "original" } } : {}) } }
      } };
      const bus = await Effect.runPromise(createControlBus({ runId: base.config.runId, board, catalog: buildControlCatalog(), surfaces: createObserveControlSurfaces() }));
      const run = { ...base, board, bus };
      await expect(Effect.runPromise(prepareObserveRun(run, options))).rejects.toThrow(pending ? "pending stream end" : "market has ended");
      await expect(Effect.runPromise(startObserveRun({ ...run, prepared: true }, options))).rejects.toThrow(pending ? "pending stream end" : "market has ended");
      await expect(Effect.runPromise(prepareObserveRun({ ...run, bus: undefined }, options))).rejects.toThrow(pending ? "pending stream end" : "market has ended");
      expect(delivered).toEqual([]);
      expect(run.board.cells.market.readonly.registrationState).toBe(pending ? "live" : "ended");
    });
  }
});
