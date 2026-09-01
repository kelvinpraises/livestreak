import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Option } from "effect";
import {
  serializeLiveStreakError,
  type LiveStreakConfigError
} from "@livestreak/core";
import {
  browserCaptureRunConfig,
  createObserveRuntime,
  fileCaptureRunConfig,
  makeObserveRun,
  validateObserveRunConfig,
  type ObserveRunConfig
} from "#index.js";

const canonicalFileConfig = {
  runId: "run_01",
  capture: {
    driverId: "file",
    config: { path: "/input.mp4" }
  },
  // eslint-disable-next-line unicorn/no-null -- passthrough signal
  process: null,
  sink: {
    driverId: "file",
    instanceId: "file-export",
    config: { path: "/output.mp4" }
  }
} as const;

describe("observe run config contract", () => {
  it("accepts canonical file config", async () => {
    const exit = await Effect.runPromiseExit(validateObserveRunConfig(canonicalFileConfig));

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual(canonicalFileConfig);
    }
  });

  it("accepts canonical browser config helper output", async () => {
    const config = browserCaptureRunConfig(
      "run_browser",
      {
        url: "https://example.com/live",
        captureFps: 30,
        viewport: { width: 640, height: 480 },
        encoding: "jpeg"
      },
      { path: "/output.mp4", instanceId: "file-export" }
    );

    const exit = await Effect.runPromiseExit(validateObserveRunConfig(config));

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.capture.driverId).toBe("browser");
      expect(exit.value.sink.driverId).toBe("file");
      expectPassthroughProcess(exit.value.process);
    }
  });

  it("accepts fileCaptureRunConfig helper output", () => {
    const config = fileCaptureRunConfig("run_file", "/input.mp4", "/output.mp4", "file-export");
    expect(config.capture.driverId).toBe("file");
    expect(config.sink.instanceId).toBe("file-export");
    expectPassthroughProcess(config.process);
  });

  it("tolerates unknown top-level fields for forward compatibility", async () => {
    const exit = await Effect.runPromiseExit(
      validateObserveRunConfig({
        ...canonicalFileConfig,
        futureField: "ignored"
      })
    );

    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("rejects missing top-level object", async () => {
    // eslint-disable-next-line unicorn/no-null -- invalid input fixture
    await expectConfigError(null, "observe run config must be a plain object");
    await expectConfigError("run_01", "observe run config must be a plain object");
    await expectConfigError([], "observe run config must be a plain object");
  });

  it("rejects blank runId", async () => {
    await expectConfigError(
      { ...canonicalFileConfig, runId: " ".repeat(3) },
      "runId must be a non-empty string"
    );
    await expectConfigError(
      { ...canonicalFileConfig, runId: 1 },
      "runId must be a non-empty string"
    );
  });

  it("rejects missing capture", async () => {
    await expectConfigError(withoutKey(canonicalFileConfig, "capture"), "capture must be a plain object");
  });

  it("rejects capture as null, array, or string", async () => {
    // eslint-disable-next-line unicorn/no-null -- invalid input fixture
    await expectConfigError({ ...canonicalFileConfig, capture: null }, "capture must be a plain object");
    await expectConfigError({ ...canonicalFileConfig, capture: [] }, "capture must be a plain object");
    await expectConfigError({ ...canonicalFileConfig, capture: "file" }, "capture must be a plain object");
  });

  it("rejects missing or blank capture.driverId", async () => {
    await expectConfigError(
      {
        ...canonicalFileConfig,
        capture: { config: { path: "/input.mp4" } }
      },
      "capture.driverId must be a non-empty string"
    );
    await expectConfigError(
      {
        ...canonicalFileConfig,
        capture: { driverId: " ".repeat(2), config: { path: "/input.mp4" } }
      },
      "capture.driverId must be a non-empty string"
    );
  });

  it("rejects missing capture.config", async () => {
    await expectConfigError(
      {
        ...canonicalFileConfig,
        capture: { driverId: "file" }
      },
      "capture.config is required"
    );
  });

  it("rejects missing process", async () => {
    await expectConfigError(withoutKey(canonicalFileConfig, "process"), "process is required");
  });

  it("accepts process null", async () => {
    const exit = await Effect.runPromiseExit(validateObserveRunConfig(canonicalFileConfig));
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expectPassthroughProcess(exit.value.process);
    }
  });

  it("accepts process object with packId and config", async () => {
    const exit = await Effect.runPromiseExit(
      validateObserveRunConfig({
        ...canonicalFileConfig,
        process: {
          packId: "overlay",
          config: { opacity: 0.5 }
        }
      })
    );

    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(exit.value.process).toEqual({
        packId: "overlay",
        config: { opacity: 0.5 }
      });
    }
  });

  it("rejects process object with missing or blank packId", async () => {
    await expectConfigError(
      {
        ...canonicalFileConfig,
        process: { config: {} }
      },
      "process.packId must be a non-empty string"
    );
    await expectConfigError(
      {
        ...canonicalFileConfig,
        process: { packId: " ".repeat(2), config: {} }
      },
      "process.packId must be a non-empty string"
    );
  });

  it("rejects process object with missing config", async () => {
    await expectConfigError(
      {
        ...canonicalFileConfig,
        process: { packId: "overlay" }
      },
      "process.config is required"
    );
  });

  it("rejects missing sink", async () => {
    await expectConfigError(withoutKey(canonicalFileConfig, "sink"), "sink must be a plain object");
  });

  it("rejects sink as null, array, or string", async () => {
    // eslint-disable-next-line unicorn/no-null -- invalid input fixture
    await expectConfigError({ ...canonicalFileConfig, sink: null }, "sink must be a plain object");
    await expectConfigError({ ...canonicalFileConfig, sink: [] }, "sink must be a plain object");
    await expectConfigError({ ...canonicalFileConfig, sink: "file" }, "sink must be a plain object");
  });

  it("rejects missing or blank sink.driverId", async () => {
    await expectConfigError(
      {
        ...canonicalFileConfig,
        sink: { config: { path: "/output.mp4" } }
      },
      "sink.driverId must be a non-empty string"
    );
    await expectConfigError(
      {
        ...canonicalFileConfig,
        sink: { driverId: " ".repeat(2), config: { path: "/output.mp4" } }
      },
      "sink.driverId must be a non-empty string"
    );
  });

  it("rejects blank sink.instanceId", async () => {
    await expectConfigError(
      {
        ...canonicalFileConfig,
        sink: { ...canonicalFileConfig.sink, instanceId: " ".repeat(2) }
      },
      "sink.instanceId must be a non-empty string"
    );
  });

  it("rejects missing sink.config", async () => {
    await expectConfigError(
      {
        ...canonicalFileConfig,
        sink: { driverId: "file" }
      },
      "sink.config is required"
    );
  });

  it("helper constructors do not validate or throw", async () => {
    const config = fileCaptureRunConfig(" ", "", "");
    expect(config.runId).toBe(" ");
    expect(config.capture.config).toEqual({ path: "" });

    const exit = await Effect.runPromiseExit(validateObserveRunConfig(config));
    expect(Exit.isFailure(exit)).toBe(true);
    expectConfigFailureMessage(exit, "runId must be a non-empty string");
  });

  it("makeObserveRun returns an Effect blueprint", async () => {
    const exit = await Effect.runPromiseExit(makeObserveRun(canonicalFileConfig));
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  it("runtime.prepareRun returns LiveStreakConfigError for malformed config", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* createObserveRuntime();
          return yield* runtime.prepareRun(malformedConfig({ runId: " ".repeat(3) }));
        })
      )
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expectConfigFailureMessage(exit, "runId must be a non-empty string");
  });

  it("serializeLiveStreakError produces CLI-safe JSON for malformed config failure", async () => {
    const exit = await Effect.runPromiseExit(
      validateObserveRunConfig({ ...canonicalFileConfig, sink: { driverId: "file" } })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const error = configErrorFromExit(exit);
    expect(error).toBeDefined();

    const serialized = serializeLiveStreakError(error!);
    expect(serialized).toMatchObject({
      tag: "LiveStreakConfigError",
      shortName: "config",
      message: "sink.config is required"
    });
    expect(JSON.stringify(serialized)).not.toContain("stack");
  });
});

// --- helpers ---

const expectPassthroughProcess = (process: ObserveRunConfig["process"]): void => {
  // eslint-disable-next-line unicorn/no-null -- passthrough signal
  expect(process).toBe(null);
};

const withoutKey = <T extends Record<string, unknown>, K extends keyof T>(
  value: T,
  key: K
): Omit<T, K> => {
  const copy = { ...value };
  delete copy[key];
  return copy;
};

const malformedConfig = (patch: Record<string, unknown>): ObserveRunConfig =>
  ({
    ...canonicalFileConfig,
    ...patch
  }) as ObserveRunConfig;

const expectConfigError = async (input: unknown, message: string): Promise<void> => {
  const exit = await Effect.runPromiseExit(validateObserveRunConfig(input));
  expect(Exit.isFailure(exit)).toBe(true);
  expectConfigFailureMessage(exit, message);
};

const expectConfigFailureMessage = (exit: Exit.Exit<unknown, unknown>, message: string): void => {
  const error = configErrorFromExit(exit);
  expect(error?.message).toBe(message);
};

const configErrorFromExit = (exit: Exit.Exit<unknown, unknown>): LiveStreakConfigError | undefined => {
  if (Exit.isFailure(exit) === false) {
    return undefined;
  }

  const failure = Cause.failureOption(exit.cause);
  if (Option.isNone(failure)) {
    return undefined;
  }

  const error = failure.value;
  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "LiveStreakConfigError"
  ) {
    return error as LiveStreakConfigError;
  }

  return undefined;
};
