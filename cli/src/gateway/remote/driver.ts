import { Effect } from "effect";
import { canonicalMandateBytes } from "@livestreak/schema";
import { assertWatchableProof } from "@livestreak/observe";
import { defaultSettingsPath, ensureSettings } from "../../prefs/settings.js";
import { createRemoteUiClient, type RemoteDriveTarget, type RemoteUiClient } from "./ui-client.js";

export interface RemoteDriveInput {
  readonly sessionId: string;
  readonly pairingPassword: string;
  /** Steward-role session for the resolve leg — on-chain resolution is authorized to the
   *  registered steward address, so it cannot run from the primary session's wallet. */
  readonly stewardSessionId?: string;
  readonly stewardPairingPassword?: string;
  readonly hostUrl?: string;
  readonly settingsPath?: string;
  readonly marketId?: string;
  readonly observeTitle?: string;
  readonly fundDeposit?: string;
  readonly resolveOutcome?: string;
  readonly observeOnly?: boolean;
  /** When set, drive the DIRECT video lane too: publish=direct + this capture file, go live in
   *  lan mode, then connect to the broadcaster's announced door and assert real bytes flow. */
  readonly directVideoPath?: string;
  readonly directPort?: number;
  /** One total budget shared by announce + watch proof (default 30s; tests pass a short budget). */
  readonly directTimeoutMs?: number;
  /** Bot-fed ingest lane: capture kind switch + frame-contract configure, then the
   *  pump POSTs `frames` to the gateway loopback endpoint while the watch proof runs.
   *  Needs `bridge:action:captureKind` in the grant next to the configure scope. */
  readonly ingest?: IngestDriveInput;
  /** Media-only proof: vault + fund + re-probe, then return without steward legs.
   *  Requires `ingest`; generic settlement is not ready. */
  readonly mediaOnly?: boolean;
  /** Complete explicit judging terms for the newly registered market; never inferred from a title. */
  readonly mandate?: import("@livestreak/schema").VaultMandate;
  readonly mandateForMarket?: (marketId: string) => import("@livestreak/schema").VaultMandate | Promise<import("@livestreak/schema").VaultMandate>;
  readonly operationId?: string;
  readonly log?: (line: string) => void;
}

export interface RemoteDriveStep {
  readonly target: RemoteDriveTarget;
  readonly action: string;
  readonly ok: boolean;
  readonly error?: string;
}

export interface RemoteDriveResult {
  readonly marketId?: string;
  readonly steps: readonly RemoteDriveStep[];
  /** Bot-fed pump, still posting on return. Stop it after truthful end. Absent for file/no-video drives. */
  readonly pump?: IngestPump;
}

const boardCells = (board: unknown): Record<string, unknown> =>
  board !== null && typeof board === "object"
    ? ((board as { cells?: Record<string, unknown> }).cells ?? {})
    : {};

const cellReadonly = (cell: unknown): Record<string, unknown> =>
  cell !== null && typeof cell === "object"
    ? ((cell as { readonly?: Record<string, unknown> }).readonly ?? {})
    : {};

/** The newest observation on the family board (the one this drive just created). */
export const readObservationIdFromBoard = (board: unknown): string | undefined => {
  const config = boardCells(board)["system:config"];
  const observations = cellReadonly(config).observations;
  if (observations === null || typeof observations !== "object") {
    return undefined;
  }
  const entries = Object.entries(observations as Record<string, { createdAtMs?: number }>);
  entries.sort((a, z) => (a[1]?.createdAtMs ?? 0) - (z[1]?.createdAtMs ?? 0));
  return entries[entries.length - 1]?.[0];
};

export const readMarketIdFromBoard = (board: unknown, obsId?: string): string | undefined => {
  const cells = boardCells(board);
  const family = obsId ?? readObservationIdFromBoard(board);
  const market = family !== undefined ? cells[`obs:${family}:market`] : cells.market;
  const marketId = cellReadonly(market).marketId;
  return typeof marketId === "string" && marketId.length > 0 ? marketId : undefined;
};

const runObserveLeg = async (
  client: RemoteUiClient,
  chain: string,
  title: string,
  record: (step: RemoteDriveStep) => void,
  publish?: "direct"
): Promise<{ marketId: string; obsId: string | undefined }> => {
  // Add observation: title + chain only — the board saves them; kinds live on the family cells.
  const configureResult = await client.call("observe", "configure", { title, chain });
  record({ target: "observe", action: "configure", ok: configureResult.ok, error: configureResult.error });
  if (!configureResult.ok) {
    throw new Error(configureResult.error ?? "observe configure failed");
  }

  const obsId = readObservationIdFromBoard(client.boards().observe);
  if (obsId === undefined) {
    throw new Error("observation not found on observe board after configure");
  }

  if (publish === "direct") {
    const kindResult = await client.call("observe", "publishKind", { obsId, kind: "direct" });
    record({ target: "observe", action: "publishKind", ok: kindResult.ok, error: kindResult.error });
    if (!kindResult.ok) {
      throw new Error(kindResult.error ?? "observe publishKind failed");
    }
  }

  // Register takes NO title — the board carries it from Add observation.
  const registerResult = await client.call(
    "observe",
    "register",
    {},
    `observe.obs.${obsId}.market.register`
  );
  record({ target: "observe", action: "register", ok: registerResult.ok, error: registerResult.error });
  if (!registerResult.ok) {
    throw new Error(registerResult.error ?? "observe register failed");
  }

  const marketId = readMarketIdFromBoard(client.boards().observe, obsId);
  if (marketId === undefined) {
    throw new Error("marketId not found on observe board after register");
  }
  return { marketId, obsId };
};

// --- direct video leg -------------------------------------------------------

const DIRECT_FRAME_INIT = 0x01;
const DIRECT_FRAME_FRAGMENT = 0x02;

const pollDirectAnnounce = async (
  hostBaseUrl: string,
  streamId: string,
  timeoutMs: number
): Promise<string> => {
  const base = hostBaseUrl.replace(/\/+$/, "");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/live/direct/${encodeURIComponent(streamId)}`);
      if (response.ok) {
        const body = (await response.json()) as { watchUrl?: unknown };
        if (typeof body.watchUrl === "string") {
          return body.watchUrl;
        }
      }
    } catch {
      /* host not ready for this poll — keep waiting */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no direct announce for ${streamId} within ${timeoutMs}ms`);
};

/** Connect to the broadcaster's door as a real viewer; resolve once init + 2 fragments arrive. */
const consumeDirectFrames = async (
  watchUrl: string,
  timeoutMs: number
): Promise<{ initBytes: number; fragments: number }> => {
  const { default: WebSocket } = await import("ws");
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(watchUrl);
    let initBytes = 0;
    let fragments = 0;
    ws.binaryType = "nodebuffer";
    let settled = false;
    const fail = (message: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      ws.close();
      reject(new Error(message));
    };
    const timer = setTimeout(() => {
      fail(`direct watch got init=${initBytes}b fragments=${fragments} within ${timeoutMs}ms`);
    }, timeoutMs);
    ws.on("close", () => {
      fail(`direct door closed with init=${initBytes}b fragments=${fragments}`);
    });
    ws.on("message", (data, isBinary) => {
      if (!isBinary) return;
      const buf = data as Buffer;
      if (buf.length === 0) return;
      if (buf[0] === DIRECT_FRAME_INIT) initBytes = buf.length - 1;
      // Fragments before a nonempty init never satisfied a viewer; ignore them.
      if (buf[0] === DIRECT_FRAME_FRAGMENT && initBytes > 0) fragments += 1;
      if (initBytes > 0 && fragments >= 2) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        ws.close();
        resolve({ initBytes, fragments });
      }
    });
    ws.on("error", (err) => {
      fail(
        `direct watch error: ${err instanceof Error ? err.message : String(err)} ` +
          `(init=${initBytes}b fragments=${fragments})`
      );
    });
  });
};

// Go live on the direct lane (lan mode — the e2e stack is one box) and PROVE the byte plane:
// a real second viewer dials the broadcaster's announced door and receives init + media
// fragments that never transited the host. `goLive` is forbidden until that proof passes.
// The producer stays running on every post-live path; flow-06 owns the later stop.
// ponytail: one total announce+proof budget per leg; per-lane knobs only if a lane needs its own.
const summarizeSteps = (steps: readonly RemoteDriveStep[]): string =>
  steps.map((s) => `${s.target}:${s.action}=${s.ok ? "ok" : "fail"}`).join(" ");

// Shared direct-media verification: announce, then fresh viewer sockets judged by B's
// guard against ONE total budget (announce time counts toward the proof).
const verifyDirectMedia = async (
  input: { readonly hostBaseUrl: string; readonly marketId: string; readonly timeoutMs: number },
  log: (line: string) => void
): Promise<{ readonly initBytes: number; readonly fragments: number }> => {
  const startedAt = Date.now();
  const watchUrl = await pollDirectAnnounce(input.hostBaseUrl, input.marketId, input.timeoutMs);
  log(`direct door: ${watchUrl}`);
  const remaining = input.timeoutMs - (Date.now() - startedAt);
  if (remaining < 1000) {
    throw new Error(
      `watch budget exhausted after announce (${input.timeoutMs}ms total); increase directTimeoutMs and retry`
    );
  }
  const dialTimeoutMs = Math.max(1000, Math.min(8000, Math.floor(remaining / 4)));
  const singleDial = (): Effect.Effect<{ readonly initBytes: number; readonly fragments: number }> =>
    Effect.orElseSucceed(
      Effect.tryPromise(() => consumeDirectFrames(watchUrl, dialTimeoutMs)),
      () => ({ initBytes: 0, fragments: 0 })
    );
  return await Effect.runPromise(
    assertWatchableProof({ probe: singleDial(), minFragments: 2, timeoutMs: remaining })
  );
};


const runDirectVideoLeg = async (
  client: RemoteUiClient,
  input: {
    marketId: string;
    obsId: string;
    videoPath: string;
    port?: number;
    hostBaseUrl: string;
    timeoutMs: number;
  },
  record: (step: RemoteDriveStep) => void,
  log: (line: string) => void
): Promise<{
  readonly mediaRunning: true;
  readonly proof: { readonly initBytes: number; readonly fragments: number };
}> => {
  const step = async (
    label: string,
    action: string,
    args: unknown,
    id: string
  ): Promise<void> => {
    const result = await client.call("observe", action, args, id);
    record({ target: "observe", action: label, ok: result.ok, error: result.error });
    if (!result.ok) {
      throw new Error(result.error ?? `observe ${label} failed`);
    }
  };

  const family = (cell: string, fn: string): string => `observe.obs.${input.obsId}.${cell}.${fn}`;
  // Best-effort stop request: an `ok` reply means the gateway accepted the request,
  // never that the producer has terminated (only a terminal run observation proves that).
  const requestStop = async (): Promise<"accepted" | "unconfirmed"> => {
    try {
      const stop = await client.call("observe", "stop", {}, family("run", "stop"));
      record({ target: "observe", action: "stop", ok: stop.ok, error: stop.error });
      return stop.ok ? "accepted" : "unconfirmed";
    } catch {
      return "unconfirmed";
    }
  };

  let startAttempted = false;
  try {
    await step("captureConfigure", "configure", { path: input.videoPath }, family("capture", "configure"));
    await step(
      "directConfigure",
      "configure",
      {
        streamId: input.marketId,
        reachability: "lan",
        ...(input.port === undefined ? {} : { port: input.port })
      },
      family("publish", "configure")
    );
    await step("prepare", "prepare", {}, family("run", "prepare"));
    startAttempted = true;
    await step("start", "start", {}, family("run", "start"));
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (startAttempted) {
      const stopNote = await requestStop();
      throw new Error(
        `direct setup failed for market ${input.marketId} after start was attempted (${detail}); ` +
          `producer state unknown — the start may have dispatched; ` +
          `requested cleanup stop (${stopNote}) while market remains registered (not live); ` +
          "read back run state before retry"
      );
    }
    throw new Error(
      `direct setup failed for market ${input.marketId}: ${detail}; ` +
        "market remains registered (not live); producer not started (start never attempted); fix and retry"
    );
  }

  let proof: { readonly initBytes: number; readonly fragments: number };
  try {
    proof = await verifyDirectMedia(
      { hostBaseUrl: input.hostBaseUrl, marketId: input.marketId, timeoutMs: input.timeoutMs },
      log
    );
    log(`direct watch: init=${proof.initBytes}b fragments=${proof.fragments}`);
    record({ target: "observe", action: "directWatch", ok: true });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    record({ target: "observe", action: "directWatch", ok: false, error: detail });
    const stopNote = await requestStop();
    throw new Error(
      `watch proof failed for market ${input.marketId}: ${detail}; ` +
        `market remains registered (not live); stop request ${stopNote}; fix capture/publish and retry`
    );
  }

  // Explicit chain goLive only after the proof. Board carries the payload (empty here).
  // Every failure is chain-uncertain: free text cannot prove the write was blocked
  // pre-dispatch, so media stays alive for readback and nothing asserts registered.
  let goLiveOutcome;
  try {
    goLiveOutcome = await client.call(
      "observe",
      "goLive",
      {},
      `observe.obs.${input.obsId}.market.goLive`
    );
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    record({ target: "observe", action: "goLive", ok: false, error: detail });
    throw new Error(
      `market ${input.marketId} goLive uncertain (${detail}); chain phase unknown — ` +
        "the write may or may not have landed; media still running for readback; " +
        "read back chain phase before retrying; no rollback claimed"
    );
  }
  record({ target: "observe", action: "goLive", ok: goLiveOutcome.ok, error: goLiveOutcome.error });
  if (!goLiveOutcome.ok) {
    const msg = goLiveOutcome.error ?? "observe goLive failed";
    throw new Error(
      `market ${input.marketId} goLive uncertain (${msg}); chain phase unknown — ` +
        "the write may or may not have landed; media still running for readback; " +
        "read back chain phase before retrying; no rollback claimed"
    );
  }
  log(`live: market ${input.marketId} confirmed live; producer stays running (flow-06 owns the later stop)`);
  return { mediaRunning: true, proof };
};

// --- bot-fed ingest leg ------------------------------------------------------
// Same watch/goLive/retain shape as the file leg, but frames come from an outside
// bot POSTing to the gateway loopback ingest endpoint (B's accepted configure
// contract). The drive pumps the provided frames concurrently; the watch proof —
// never the pump — judges watchability.

export interface IngestDriveInput {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  /** Loopback TCP port the bot POSTs to (server default 48710). */
  readonly port?: number;
  /** Ingest path the bot POSTs to (server default "/frames"). */
  readonly path?: string;
  /** Changing frames the pump POSTs until the drive ends. Yield on a bounded
   *  interval: the pump stops between frames, so an idle-forever iterable would
   *  stall drive teardown. */
  readonly frames: AsyncIterable<Uint8Array>;
}

/** Proof-only changing frames (counter bytes, rgba-sized). C's bot replaces this. */
export async function* generateCounterFrames(
  width: number,
  height: number,
  count: number
): AsyncGenerator<Uint8Array> {
  const size = width * height * 4;
  for (let seq = 0; seq < count; seq += 1) {
    const frame = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) {
      frame[i] = (seq + i) % 256;
    }
    yield frame;
  }
}

const pumpSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface IngestPump {
  /** Resolves when the pump loop exits (never rejects; failures are recorded). */
  readonly done: Promise<void>;
  readonly stop: () => void;
  readonly posted: () => number;
  readonly dropped: () => number;
  readonly failure: () => unknown;
  /** True once the frame iterable ended naturally (continuity beyond buffered frames unproven). */
  readonly exhausted: () => boolean;
}

/** Post-start drive failure that hands the still-posting pump to the caller.
 *  Stop it after truthful end; the producer was never stopped here. */
export class IngestPumpError extends Error {
  readonly pump: IngestPump;
  constructor(message: string, pump: IngestPump) {
    super(message);
    this.name = "IngestPumpError";
    this.pump = pump;
  }
}

// POST frames until stopped. 429 backpressures (drop + slow down); anything else
// is recorded for the leg to report with posted/dropped counts.
const startIngestPump = (
  input: {
    readonly port: number;
    readonly path: string;
    readonly expectedBytes: number;
    readonly frames: AsyncIterable<Uint8Array>;
  },
  log: (line: string) => void
): IngestPump => {
  let active = true;
  let posted = 0;
  let dropped = 0;
  let exhausted = false;
  let failure: unknown;
  let stopResolve: (() => void) | undefined;
  const stopped = new Promise<void>((resolve) => {
    stopResolve = resolve;
  });
  const url = `http://127.0.0.1:${input.port}${input.path}`;
  const done = (async (): Promise<void> => {
    try {
      const it = input.frames[Symbol.asyncIterator]();
      // Abandon a hung iterable on stop instead of stalling teardown.
      const nextFrame = async (): Promise<IteratorResult<Uint8Array> | undefined> =>
        Promise.race([it.next(), stopped.then((): undefined => undefined)]);
      let next = await nextFrame();
      while (next !== undefined && !next.done) {
        if (!active) {
          break;
        }
        const frame = next.value;
        if (frame.length !== input.expectedBytes) {
          throw new Error(
            `ingest frame is ${frame.length}b, contract expects ${input.expectedBytes}b; fix the bot frame size`
          );
        }
        let res: Response;
        try {
          res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/octet-stream" },
            body: new Blob([Buffer.from(frame)])
          });
        } catch (cause) {
          if (posted === 0 && dropped === 0) {
            await pumpSleep(250); // server not listening yet — retry the same frame
            continue;
          }
          throw cause;
        }
        if (res.status === 429) {
          dropped += 1;
          await pumpSleep(200);
          next = await nextFrame();
          continue;
        }
        if (!res.ok) {
          throw new Error(`ingest POST failed (${res.status}) after ${posted} frames accepted`);
        }
        posted += 1;
        if (posted === 1) {
          log(`ingest: first frame accepted at ${url}`);
        }
        next = await nextFrame();
      }
      if (active) {
        exhausted = true;
        log(
          `ingest: frame supply exhausted after ${posted} posted/${dropped} dropped — ` +
            "continuity beyond buffered frames unproven"
        );
      }
    } catch (cause) {
      failure = cause;
    }
  })();
  return {
    done,
    stop: () => {
      active = false;
      stopResolve?.();
    },
    posted: () => posted,
    dropped: () => dropped,
    failure: () => failure,
    exhausted: () => exhausted
  };
};

const runIngestVideoLeg = async (
  client: RemoteUiClient,
  input: {
    marketId: string;
    obsId: string;
    ingest: IngestDriveInput;
    hostBaseUrl: string;
    timeoutMs: number;
  },
  record: (step: RemoteDriveStep) => void,
  log: (line: string) => void
): Promise<{
  readonly mediaRunning: true;
  readonly proof: { readonly initBytes: number; readonly fragments: number };
  readonly pump: IngestPump;
}> => {
  const family = (cell: string, fn: string): string => `observe.obs.${input.obsId}.${cell}.${fn}`;
  const step = async (label: string, action: string, args: unknown, id: string): Promise<void> => {
    const result = await client.call("observe", action, args, id);
    record({ target: "observe", action: label, ok: result.ok, error: result.error });
    if (!result.ok) {
      throw new Error(result.error ?? `observe ${label} failed`);
    }
  };
  const requestStop = async (): Promise<"accepted" | "unconfirmed"> => {
    try {
      const stop = await client.call("observe", "stop", {}, family("run", "stop"));
      record({ target: "observe", action: "stop", ok: stop.ok, error: stop.error });
      return stop.ok ? "accepted" : "unconfirmed";
    } catch {
      return "unconfirmed";
    }
  };

  // Kind switch first: same cell, new catalog (file details reset by the switch).
  const kindResult = await client.call("observe", "captureKind", { obsId: input.obsId, kind: "ingest" });
  record({ target: "observe", action: "captureKind", ok: kindResult.ok, error: kindResult.error });
  if (!kindResult.ok) {
    throw new Error(
      `ingest captureKind failed for market ${input.marketId}: ${kindResult.error ?? "unknown"}; ` +
        "market remains registered (not live); producer not started; fix scopes and retry"
    );
  }

  // Publish kind switch: without this the direct configure below lands on the
  // mounted live surface (ignored) and no direct door is ever announced.
  const pubKindResult = await client.call("observe", "publishKind", { obsId: input.obsId, kind: "direct" });
  record({ target: "observe", action: "publishKind", ok: pubKindResult.ok, error: pubKindResult.error });
  if (!pubKindResult.ok) {
    throw new Error(
      `ingest publishKind failed for market ${input.marketId}: ${pubKindResult.error ?? "unknown"}; ` +
        "market remains registered (not live); producer not started; fix scopes and retry"
    );
  }

  let startAttempted = false;
  try {
    await step(
      "captureConfigure",
      "configure",
      {
        width: input.ingest.width,
        height: input.ingest.height,
        fps: input.ingest.fps,
        ...(input.ingest.port === undefined ? {} : { port: input.ingest.port }),
        ...(input.ingest.path === undefined ? {} : { path: input.ingest.path })
      },
      family("capture", "configure")
    );
    await step(
      "directConfigure",
      "configure",
      { streamId: input.marketId, reachability: "lan" },
      family("publish", "configure")
    );
    await step("prepare", "prepare", {}, family("run", "prepare"));
    startAttempted = true;
    await step("start", "start", {}, family("run", "start"));
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    if (startAttempted) {
      const stopNote = await requestStop();
      throw new Error(
        `ingest setup failed for market ${input.marketId} after start was attempted (${detail}); ` +
          "producer state unknown — the start may have dispatched; " +
          `requested cleanup stop (${stopNote}) while market remains registered (not live); ` +
          "read back run state before retry"
      );
    }
    throw new Error(
      `ingest setup failed for market ${input.marketId}: ${detail}; ` +
        "market remains registered (not live); producer not started (start never attempted); fix and retry"
    );
  }

  // Endpoint the bot POSTs to: our configure args, server defaults otherwise.
  // byteFormat rides the board when preset; the server default is rgba.
  const captureCell = boardCells(client.boards().observe)[`obs:${input.obsId}:capture`] as
    | { settings?: { byteFormat?: unknown } }
    | undefined;
  const yuv = captureCell?.settings?.byteFormat === "yuv420p";
  const expectedBytes = yuv
    ? Math.floor((input.ingest.width * input.ingest.height * 3) / 2)
    : input.ingest.width * input.ingest.height * 4;
  const pump = startIngestPump(
    {
      port: input.ingest.port ?? 48710,
      path: input.ingest.path ?? "/frames",
      expectedBytes,
      frames: input.ingest.frames
    },
    log
  );
  const stopPump = async (): Promise<void> => {
    pump.stop();
    await pump.done;
  };
  const pumpDetail = (): string | undefined => {
    const failure = pump.failure();
    return failure === undefined ? undefined : failure instanceof Error ? failure.message : String(failure);
  };

  let proof: { readonly initBytes: number; readonly fragments: number };
  try {
    proof = await verifyDirectMedia(
      { hostBaseUrl: input.hostBaseUrl, marketId: input.marketId, timeoutMs: input.timeoutMs },
      log
    );
    log(`direct watch: init=${proof.initBytes}b fragments=${proof.fragments}`);
    record({ target: "observe", action: "directWatch", ok: true });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    record({ target: "observe", action: "directWatch", ok: false, error: detail });
    await stopPump();
    const stopNote = await requestStop();
    const pumpNote = pumpDetail();
    throw new Error(
      `watch proof failed for market ${input.marketId}: ${detail}; ` +
        `market remains registered (not live); stop request ${stopNote};` +
        `${pumpNote === undefined ? "" : ` pump also failed: ${pumpNote};`} fix capture/publish/frames and retry`
    );
  }
  // Frames must actually be flowing into the producer: require one accepted POST
  // (or a recorded pump failure) before goLive. The watch proof alone cannot tell
  // producer bytes from a coincidental door.
  const pumpSettledAt = Date.now() + 5000;
  while (pump.posted() === 0 && pumpDetail() === undefined) {
    if (Date.now() >= pumpSettledAt) {
      break;
    }
    await pumpSleep(100);
  }
  const pumpFailure =
    pumpDetail() ??
    (pump.posted() === 0 ? "no ingest frame accepted within 5s of proof" : undefined);
  if (pumpFailure !== undefined) {
    await stopPump();
    const stopNote = await requestStop();
    throw new Error(
      `ingest pump failed for market ${input.marketId}: ${pumpFailure}; ` +
        `posted=${pump.posted()} dropped=${pump.dropped()}; ` +
        `market remains registered (not live); stop request ${stopNote}; fix frame contract and retry`
    );
  }

  // Explicit chain goLive only after the proof. Every failure is chain-uncertain:
  // free text cannot prove the write was blocked, so the pump keeps posting under
  // caller ownership (see IngestPumpError) and nothing asserts registered.
  let goLiveOutcome;
  try {
    goLiveOutcome = await client.call(
      "observe",
      "goLive",
      {},
      `observe.obs.${input.obsId}.market.goLive`
    );
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    record({ target: "observe", action: "goLive", ok: false, error: detail });
    throw new IngestPumpError(
      `market ${input.marketId} goLive uncertain (${detail}); chain phase unknown — ` +
        "the write may or may not have landed; pump still posting under your ownership; " +
        "stop it after truthful end; read back chain phase before retrying; no rollback claimed",
      pump
    );
  }
  record({ target: "observe", action: "goLive", ok: goLiveOutcome.ok, error: goLiveOutcome.error });
  if (!goLiveOutcome.ok) {
    const msg = goLiveOutcome.error ?? "observe goLive failed";
    throw new IngestPumpError(
      `market ${input.marketId} goLive uncertain (${msg}); chain phase unknown — ` +
        "the write may or may not have landed; pump still posting under your ownership; " +
        "stop it after truthful end; read back chain phase before retrying; no rollback claimed",
      pump
    );
  }
  log(`live: market ${input.marketId} confirmed live; producer stays running (flow-06 owns the later stop)`);
  return { mediaRunning: true, proof, pump };
};


export const runRemoteDrive = async (input: RemoteDriveInput): Promise<RemoteDriveResult> => {
  const log = input.log ?? ((line: string) => process.stderr.write(`[remote drive] ${line}\n`));
  if (input.directVideoPath !== undefined && input.ingest !== undefined) {
    throw new Error("choose one producer: directVideoPath (file) or ingest (bot-fed)");
  }
  if (input.mediaOnly === true && input.ingest === undefined) {
    throw new Error("mediaOnly requires the ingest block (bot-fed drive)");
  }
  const settingsPath = input.settingsPath ?? defaultSettingsPath();
  const settings = await ensureSettings(settingsPath);
  const hostBaseUrl = input.hostUrl ?? settings.host.url;

  const client = createRemoteUiClient({
    hostBaseUrl,
    sessionId: input.sessionId,
    pairingPassword: input.pairingPassword,
    log
  });

  const stewardClient =
    input.stewardSessionId === undefined
      ? undefined
      : createRemoteUiClient({
          hostBaseUrl,
          sessionId: input.stewardSessionId,
          pairingPassword: input.stewardPairingPassword ?? "",
          log
        });

  const steps: RemoteDriveStep[] = [];
  // The bot pump is ours to tear down on drive exit; the producer is never stopped here.
  // Both live outside the try so the finally below can see them.
  let ingestPump: IngestPump | undefined;
  let pumpHandedOver = false;
  const record = (step: RemoteDriveStep): void => {
    steps.push(step);
  };

  try {
    await client.connect();
    if (stewardClient !== undefined) {
      await stewardClient.connect();
    }
    const stewardLeg = stewardClient ?? client;

    const observed =
      input.marketId !== undefined
        ? { marketId: input.marketId, obsId: undefined }
        : await runObserveLeg(
            client,
            settings.defaultChain,
            input.observeTitle ?? `remote-drive-${input.sessionId}`,
            record,
            input.directVideoPath === undefined ? undefined : "direct"
          );
    const marketId = observed.marketId;
    log(`marketId: ${marketId}`);

    // Direct-video gate: watch proof before goLive; the producer outlives this drive.
    // A no-video drive claims no watchable market (separate gap, not a flow-02 pass).
    let chainPhase: "registered" | "live" = "registered";
    // Stop-ownership flag only: true once this drive started a producer it never
    // asked to stop. It is NOT current delivery state — never print it as one.
    let mediaRunning = false;
    let lastVerifiedMedia = "none";
    // Honest media wording: last successful proof plus an explicit unverified
    // present (fresh bytes were not just observed at print time).
    const mediaNote = (): string =>
      lastVerifiedMedia === "none"
        ? "producer not started"
        : `last verified ${lastVerifiedMedia}; current delivery unverified; no stop was sent (flow-06 owns stop)`;
    // Ownership handover: the still-posting pump leaves with the caller (result or
    // IngestPumpError). The finally below must not stop a handed-over pump.
    const handPumpOver = (): { readonly pump?: IngestPump } => {
      if (ingestPump === undefined) {
        return {};
      }
      pumpHandedOver = true;
      return { pump: ingestPump };
    };
    if (input.directVideoPath !== undefined) {
      if (observed.obsId === undefined) {
        throw new Error("direct video leg needs the observation this drive created");
      }
      const leg = await runDirectVideoLeg(
        client,
        {
          marketId,
          obsId: observed.obsId,
          videoPath: input.directVideoPath,
          ...(input.directPort === undefined ? {} : { port: input.directPort }),
          hostBaseUrl,
          timeoutMs: input.directTimeoutMs ?? 30_000
        },
        record,
        log
      );
      mediaRunning = leg.mediaRunning;
      lastVerifiedMedia = `init=${leg.proof.initBytes}b fragments=${leg.proof.fragments} (pre-goLive proof)`;
      chainPhase = "live";
    }
    if (input.ingest !== undefined) {
      if (observed.obsId === undefined) {
        throw new Error("ingest video leg needs the observation this drive created");
      }
      const leg = await runIngestVideoLeg(
        client,
        {
          marketId,
          obsId: observed.obsId,
          ingest: input.ingest,
          hostBaseUrl,
          timeoutMs: input.directTimeoutMs ?? 30_000
        },
        record,
        log
      );
      ingestPump = leg.pump;
      mediaRunning = leg.mediaRunning;
      lastVerifiedMedia = `init=${leg.proof.initBytes}b fragments=${leg.proof.fragments} (pre-goLive proof)`;
      chainPhase = "live";
    }

    if (input.observeOnly === true) {
      if (mediaRunning) {
        log(
          `drive is not stopping the producer for market ${marketId} (flow-06 end owns stop); ` +
            mediaNote()
        );
      }
      return { marketId, steps, ...handPumpOver() };
    }

    // Post-live economy: never stop media here. Failures carry reconciling state
    // (steps are lost on throw) and never claim a rollback.
    try {

    // Bookmaker: seed a vault on the fresh market; the result's tokenId IS the vaultId.
    const mandate = input.mandate ?? await input.mandateForMarket?.(marketId);
    if (!mandate || !input.operationId) {
      throw new Error("Economy drive requires explicit mandate and operationId; use the public role client example or --observe-only for media");
    }
    canonicalMandateBytes(mandate);
    if (mandate.marketId !== marketId) throw new Error("Explicit mandate does not belong to the driven market");
    const bmConfigure = await client.call("bookmaker", "configure", { marketId });
    record({ target: "bookmaker", action: "configure", ok: bmConfigure.ok, error: bmConfigure.error });
    if (!bmConfigure.ok) {
      throw new Error(bmConfigure.error ?? "bookmaker configure failed");
    }

    const createVault = await client.call("bookmaker", "createVault", {
      marketId,
      question: mandate.question,
      mandate,
      operationId: input.operationId,
      creatorSide: "yes",
      creatorStake: "5000000",
      seedRate: "8333"
    });
    record({ target: "bookmaker", action: "createVault", ok: createVault.ok, error: createVault.error });
    const vaultId = createVault.result?.tokenId;
    if (!createVault.ok || vaultId === undefined) {
      throw new Error(createVault.error ?? "createVault failed (no vaultId)");
    }
    log(`vaultId: ${vaultId}`);

    const optionsConfigure = await client.call("options", "configure", { marketId });
    record({
      target: "options",
      action: "configure",
      ok: optionsConfigure.ok,
      error: optionsConfigure.error
    });
    if (!optionsConfigure.ok) {
      throw new Error(optionsConfigure.error ?? "options configure failed");
    }

    // Operator address off the live options board (the session wallet's account).
    const board = client.boards().options as
      | { snapshot?: { account?: string } }
      | undefined;
    const account = board?.snapshot?.account;
    if (account === undefined) {
      throw new Error("options board has no account after configure");
    }

    // operator omitted: the writer defaults it to the MarketDriver.
    const approval = await client.call("options", "setApprovalForAll", { approved: true });
    record({
      target: "options",
      action: "setApprovalForAll",
      ok: approval.ok,
      error: approval.error
    });
    if (!approval.ok) {
      throw new Error(approval.error ?? "setApprovalForAll failed");
    }

    const mint = await client.call("options", "mint", { marketId, to: account });
    record({ target: "options", action: "mint", ok: mint.ok, error: mint.error });
    const tokenId = mint.result?.tokenId;
    if (!mint.ok || tokenId === undefined) {
      throw new Error(mint.error ?? "mint failed (no tokenId)");
    }
    log(`tokenId: ${tokenId}`);

    const fund = await client.call("options", "fund", {
      tokenId,
      vaultId,
      side: "yes",
      rate: "1000",
      deposit: input.fundDeposit ?? "1000000"
    });
    record({ target: "options", action: "fund", ok: fund.ok, error: fund.error });
    if (!fund.ok) {
      throw new Error(fund.error ?? "fund failed");
    }

    // Continuity: a fresh viewer must still see bytes after funding. Failure reports
    // the last verified state; it never stops media or claims a rollback.
    if (mediaRunning) {
      try {
        const re = await verifyDirectMedia(
          { hostBaseUrl, marketId, timeoutMs: input.directTimeoutMs ?? 30_000 },
          log
        );
        lastVerifiedMedia = `init=${re.initBytes}b fragments=${re.fragments} (post-fund re-probe)`;
        record({ target: "options", action: "directWatchPostFund", ok: true });
        log(`post-fund watch: ${lastVerifiedMedia}; observed delivering at re-probe`);
      } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        record({ target: "options", action: "directWatchPostFund", ok: false, error: detail });
        throw new Error(
          `media re-probe failed after fund for market ${marketId}: ${detail}; ` +
            `last verified media: ${lastVerifiedMedia}; current delivery unverified; chain phase=${chainPhase}; ` +
            "fund already recorded — reconcile and end via flow-06; no rollback claimed"
        );
      }
    }

    // Media-only proof ends here: settlement legs are out of scope (generic mandate unresolved).
    if (input.mediaOnly === true) {
      if (mediaRunning) {
        log(
          `media-only drive complete for market ${marketId} (flow-06 end owns stop); ` + mediaNote()
        );
      }
      return { marketId, steps, ...handPumpOver() };
    }

    // Steward: watch the vault, then resolve it (via the steward-role session when provided).
    const stConfigure = await stewardLeg.call("steward", "configure", { marketId, vaultId });
    record({ target: "steward", action: "configure", ok: stConfigure.ok, error: stConfigure.error });
    if (!stConfigure.ok) {
      throw new Error(stConfigure.error ?? "steward configure failed");
    }

    const resolve = await stewardLeg.call("steward", "resolve", {
      subjectId: vaultId,
      subjectKind: "vault",
      vaultId,
      outcome: input.resolveOutcome ?? "yes"
    });
    record({ target: "steward", action: "resolve", ok: resolve.ok, error: resolve.error });
    if (!resolve.ok) {
      throw new Error(resolve.error ?? "steward resolve failed");
    }

    const withdraw = await client.call("options", "withdraw", { tokenId, vaultId, to: account });
    record({ target: "options", action: "withdraw", ok: withdraw.ok, error: withdraw.error });
    if (!withdraw.ok) {
      throw new Error(withdraw.error ?? "withdraw failed");
    }

    if (mediaRunning) {
      log(
        `drive is not stopping the producer for market ${marketId} (flow-06 end owns stop); ` +
          mediaNote()
      );
    }
    return { marketId, steps, ...handPumpOver() };
    } catch (cause) {
      if (cause instanceof IngestPumpError) {
        pumpHandedOver = true;
        throw cause;
      }
      const detail = cause instanceof Error ? cause.message : String(cause);
      const message =
        `drive failed for market ${marketId} ` +
        `(phase=${chainPhase}; ${mediaNote()}): ${detail}; ` +
        `steps: ${summarizeSteps(steps)}; reconcile the failed action and retry; ` +
        "no rollback claimed";
      if (ingestPump !== undefined) {
        pumpHandedOver = true;
        throw new IngestPumpError(message, ingestPump);
      }
      throw new Error(message);
    }
  } finally {
    if (!pumpHandedOver) {
      ingestPump?.stop();
      await ingestPump?.done;
    }
    stewardClient?.close();
    client.close();
  }
};
