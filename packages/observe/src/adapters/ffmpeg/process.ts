import { Effect } from "effect";
import {
  LiveStreakConfigError,
  LiveStreakRuntimeError,
  type LiveStreakError
} from "@livestreak/core";
import { bytesToUtf8, concatBytes } from "./bytes.js";

// --- exports ---

export interface FfmpegBinaries {
  readonly ffmpegPath?: string;
  readonly ffprobePath?: string;
}

export interface ChildResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number | null;
  readonly signal: string | null;
}

export interface NodeWritable {
  readonly write: (chunk: Uint8Array) => boolean;
  readonly end: () => void;
  readonly on: (
    event: "drain" | "error",
    listener: (...arguments_: never[]) => void
  ) => void;
  readonly removeListener: (
    event: "drain" | "error",
    listener: (...arguments_: never[]) => void
  ) => void;
}

export interface NodeChildProcess {
  readonly stdin: NodeWritable;
  readonly stdout: NodeReadable;
  readonly stderr: NodeReadable;
  readonly killed: boolean;
  readonly exitCode: number | null;
  readonly signalCode: string | null;
  readonly kill: (signal: string) => boolean;
  readonly on: {
    (event: "error", listener: (cause: NodeErrnoException) => void): void;
    (event: "close", listener: (code: number | null, signal: string | null) => void): void;
    (event: "spawn", listener: () => void): void;
  };
}

export const runChild = (
  binary: string,
  commandArguments: readonly string[]
): Effect.Effect<ChildResult, LiveStreakError> =>
  Effect.flatMap(
    Effect.tryPromise({
      try: childProcessModule,
      catch: (cause) => runtimeFailure("Could not load Node child_process", String(cause))
    }),
    ({ spawn }) =>
      Effect.async<ChildResult, LiveStreakError>((resume) => {
        const child = spawn(binary, commandArguments, {
          stdio: ["ignore", "pipe", "pipe"]
        });
        const stdout: Uint8Array[] = [];
        const stderr: Uint8Array[] = [];
        let settled = false;

        const settle = (effect: Effect.Effect<ChildResult, LiveStreakError>) => {
          if (settled) {
            return;
          }
          settled = true;
          resume(effect);
        };

        child.on("error", (cause) => {
          if (cause.code === "ENOENT") {
            settle(Effect.fail(missingDependency(binary, cause)));
            return;
          }
          settle(Effect.fail(runtimeFailure(`${binary} failed to start`, cause.message)));
        });
        child.stdout.on("data", (chunk) => stdout.push(chunk));
        child.stderr.on("data", (chunk) => stderr.push(chunk));
        child.on("close", (code, signal) =>
          settle(
            Effect.succeed({
              stdout: bytesToUtf8(concatBytes(stdout)),
              stderr: bytesToUtf8(concatBytes(stderr)),
              code,
              signal
            })
          )
        );
      })
  );

export const spawnChild = (
  binary: string,
  commandArguments: readonly string[],
  stdio: "pipe" | "ignore-stdout" = "pipe"
): Effect.Effect<NodeChildProcess, LiveStreakError> =>
  Effect.flatMap(
    Effect.tryPromise({
      try: childProcessModule,
      catch: (cause) => runtimeFailure("Could not load Node child_process", String(cause))
    }),
    ({ spawn }) =>
      Effect.async<NodeChildProcess, LiveStreakError>((resume) => {
        const child = spawn(
          binary,
          commandArguments,
          stdio === "pipe"
            ? { stdio: ["pipe", "pipe", "pipe"] }
            : { stdio: ["ignore", "pipe", "pipe"] }
        );

        // O9: Node delivers spawn failures (ENOENT, EACCES) ASYNCHRONOUSLY on the
        // "error" event AFTER spawn() returns. Resuming success synchronously here
        // would hand callers a broken child and lose the real config error (the
        // later error resume hits a dead continuation). Node guarantees exactly
        // one of "spawn"/"error" fires — resume success on "spawn", failure on
        // "error", both behind a settled guard.
        let settled = false;
        const settle = (effect: Effect.Effect<NodeChildProcess, LiveStreakError>) => {
          if (settled) {
            return;
          }
          settled = true;
          resume(effect);
        };

        child.on("error", (cause) => {
          if (cause.code === "ENOENT") {
            settle(Effect.fail(missingDependency(binary, cause)));
            return;
          }
          settle(Effect.fail(runtimeFailure(`${binary} failed to start`, cause.message)));
        });

        child.on("spawn", () => settle(Effect.succeed(child)));
      })
  );

export const killProcess = (child: NodeChildProcess): void => {
  if (child.killed) {
    return;
  }
  if (child.exitCode !== null) {
    return;
  }
  if (child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  const timer = setTimeout(() => {
    if (child.killed) {
      return;
    }
    if (child.exitCode !== null) {
      return;
    }
    if (child.signalCode !== null) {
      return;
    }
    child.kill("SIGKILL");
  }, 250);

  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    (timer as { readonly unref: () => void }).unref();
  }
};

export const writeStdinWithBackpressure = (
  stdin: NodeWritable,
  chunk: Uint8Array,
  label: string
): Effect.Effect<void, LiveStreakError> =>
  Effect.async<void, LiveStreakError>((resume) => {
    let settled = false;

    const finish = (effect: Effect.Effect<void, LiveStreakError>) => {
      if (settled) {
        return;
      }
      settled = true;
      stdin.removeListener("error", onError);
      stdin.removeListener("drain", onDrain);
      resume(effect);
    };

    const onError = (cause: Error) => {
      finish(Effect.fail(runtimeFailure(`${label} stdin write failed`, cause.message)));
    };

    const onDrain = () => {
      finish(Effect.void);
    };

    stdin.on("error", onError);

    const accepted = stdin.write(chunk);
    if (accepted) {
      finish(Effect.void);
      return;
    }

    stdin.on("drain", onDrain);
  });

export const waitForProcessClose = (
  child: NodeChildProcess,
  stderrChunks: readonly Uint8Array[],
  label: string
): Effect.Effect<void, LiveStreakError> =>
  Effect.async<void, LiveStreakError>((resume) => {
    // O3: mirror the `settled`-guard idiom used by runChild/writeStdinWithBackpressure.
    let settled = false;

    const settleClose = (code: number | null, signal: string | null) => {
      if (settled) {
        return;
      }
      settled = true;

      if (code === 0) {
        resume(Effect.void);
        return;
      }

      resume(
        Effect.fail(
          runtimeFailure(
            `${label} failed`,
            bytesToUtf8(concatBytes(stderrChunks)).trim() ||
              `exit=${code ?? signal ?? "unknown"}`
          )
        )
      );
    };

    // If ffmpeg already exited before we attached the listener (bad codec, disk
    // full, killed during drain), the "close" event has already fired and would
    // never call resume → the Effect (and thus the draining loop / finalize)
    // hangs forever and the mp4 is truncated. Resolve immediately from the
    // captured exit/signal code instead.
    if (child.exitCode !== null || child.signalCode !== null) {
      settleClose(child.exitCode, child.signalCode);
      return;
    }

    // A spawn/runtime error can also arrive on the "error" channel; treat it as
    // a failure rather than waiting for a "close" that may never come.
    child.on("error", (cause) => {
      if (settled) {
        return;
      }
      settled = true;
      resume(Effect.fail(runtimeFailure(`${label} failed`, cause.message)));
    });

    child.on("close", (code, signal) => settleClose(code, signal));
  });

// --- helpers ---

interface NodeReadable {
  readonly on: (event: "data", listener: (chunk: Uint8Array) => void) => void;
}

interface NodeErrnoException extends Error {
  readonly code?: string;
}

interface NodeChildProcessModule {
  readonly spawn: (
    binary: string,
    commandArguments: readonly string[],
    options: { readonly stdio: readonly ["pipe", "pipe", "pipe"] | readonly ["ignore", "pipe", "pipe"] }
  ) => NodeChildProcess;
}

const importNode = (specifier: string): Promise<unknown> => import(/* @vite-ignore */ specifier);

const childProcessModule = async (): Promise<NodeChildProcessModule> =>
  importNode("node:child_process") as Promise<NodeChildProcessModule>;

const missingDependency = (binary: string, cause: unknown): LiveStreakConfigError =>
  new LiveStreakConfigError({
    message: `${binary} is required for ffmpeg media operations`,
    metadata: {
      details: `Install ${binary} or configure a compatible binary on PATH.`,
      cause
    }
  });

const runtimeFailure = (message: string, details?: string): LiveStreakRuntimeError =>
  new LiveStreakRuntimeError({
    message,
    metadata: details === undefined ? undefined : { details }
  });
