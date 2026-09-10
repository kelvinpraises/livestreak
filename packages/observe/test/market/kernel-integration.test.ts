import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { prepareObserveRun, startObserveRun } from "#run/kernel.js";
import { createSyntheticKernelOptions } from "#test/helpers/runtime.js";
import { createFakeMarketRegistrar } from "#test/helpers/fake-market-registrar.js";
import { minimalEvmMarketRegistrationConfig } from "#test/helpers/market-config.js";
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
