import { Effect } from "effect";
import {
  createObserveRuntime,
  fileCaptureRunConfig,
  type Board,
  type ObserveRunMarketConfig
} from "@livestreak/observe";
import type { WalletInit } from "@livestreak/schema";

export interface RunProducerCaptureInput {
  readonly title: string;
  readonly videoPath: string;
  readonly sinkPath: string;
  readonly walletInit: WalletInit;
  readonly seed: string | Uint8Array;
  readonly marketRegistryAddress: `0x${string}`;
  readonly runId: string;
}

export interface RunProducerCaptureResult {
  readonly marketId: `0x${string}`;
  readonly streamId: `0x${string}`;
  readonly mp4Path: string;
}

export const readMarketIdFromBoard = (board: Board): RunProducerCaptureResult | undefined => {
  const readonly = board.cells["market"]?.readonly;
  if (readonly === undefined || typeof readonly !== "object") {
    return undefined;
  }

  const record = readonly as Record<string, unknown>;
  if (record["registrationState"] !== "registered") {
    return undefined;
  }

  const marketId = record["marketId"];
  const streamId = record["streamId"];
  if (typeof marketId !== "string" || typeof streamId !== "string") {
    return undefined;
  }

  return {
    marketId: marketId as `0x${string}`,
    streamId: streamId as `0x${string}`,
    mp4Path: ""
  };
};

const waitForMarketRegistration = (
  readBoard: () => Effect.Effect<Board, unknown, never>,
  maxAttempts = 200,
  delayMs = 100
): Effect.Effect<RunProducerCaptureResult, Error, never> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const board = yield* readBoard().pipe(
        Effect.mapError(
          (error) =>
            new Error(error instanceof Error ? error.message : String(error))
        )
      );
      const registered = readMarketIdFromBoard(board);
      if (registered !== undefined) {
        return registered;
      }

      const failed = board.cells["market"]?.readonly;
      if (
        failed !== undefined &&
        typeof failed === "object" &&
        (failed as Record<string, unknown>)["registrationState"] === "failed"
      ) {
        const reason = (failed as Record<string, unknown>)["reason"];
        return yield* Effect.fail(
          new Error(
            `Market registration failed: ${typeof reason === "string" ? reason : "unknown"}`
          )
        );
      }

      yield* Effect.sleep(`${delayMs} millis`);
    }

    return yield* Effect.fail(new Error("Timed out waiting for market registration"));
  });

export const runProducerCapture = async (
  input: RunProducerCaptureInput
): Promise<RunProducerCaptureResult> => {
  const registration: ObserveRunMarketConfig = {
    walletInit: input.walletInit,
    seed: input.seed,
    marketRegistryAddress: input.marketRegistryAddress,
    title: input.title
  };

  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const runtime = yield* createObserveRuntime();
        const config = fileCaptureRunConfig(
          input.runId,
          input.videoPath,
          input.sinkPath,
          "file-export"
        );

        yield* runtime.prepareRun(config, { market: { registration } });
        yield* runtime.startRun(input.runId, { market: { registration } });

        const registered = yield* waitForMarketRegistration(() =>
          runtime.readBoard(input.runId)
        );

        const result = yield* runtime.awaitRun(input.runId);
        const mp4Path = result.outputUri ?? input.sinkPath;

        return {
          marketId: registered.marketId,
          streamId: registered.streamId,
          mp4Path
        };
      })
    )
  );
};
