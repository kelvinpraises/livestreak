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

        child.on("error", (cause) => {
          if (cause.code === "ENOENT") {
            resume(Effect.fail(missingDependency(binary, cause)));
            return;
          }
          resume(Effect.fail(runtimeFailure(`${binary} failed to start`, cause.message)));
        });

        resume(Effect.succeed(child));
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
    child.on("close", (code, signal) => {
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
    });
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
