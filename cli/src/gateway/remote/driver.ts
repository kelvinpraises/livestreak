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
    const timer = setTimeout(() => {
      ws.close();
      reject(
        new Error(`direct watch got init=${initBytes}b fragments=${fragments} within ${timeoutMs}ms`)
      );
    }, timeoutMs);
    ws.binaryType = "nodebuffer";
    ws.on("message", (data, isBinary) => {
      if (!isBinary) return;
      const buf = data as Buffer;
      if (buf.length === 0) return;
      if (buf[0] === DIRECT_FRAME_INIT) initBytes = buf.length - 1;
      if (buf[0] === DIRECT_FRAME_FRAGMENT) fragments += 1;
      if (initBytes > 0 && fragments >= 2) {
        clearTimeout(timer);
        ws.close();
        resolve({ initBytes, fragments });
      }
    });
    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
};

// Go live on the direct lane (lan mode — the e2e stack is one box) and PROVE the byte plane:
// a real viewer dials the broadcaster's announced door and receives init + media fragments
// that never transited the host.
const runDirectVideoLeg = async (
  client: RemoteUiClient,
  input: { marketId: string; obsId: string; videoPath: string; port?: number; hostBaseUrl: string },
  record: (step: RemoteDriveStep) => void,
  log: (line: string) => void
): Promise<void> => {
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
  await step("start", "start", {}, family("run", "start"));

  try {
    const watchUrl = await pollDirectAnnounce(input.hostBaseUrl, input.marketId, 30_000);
    log(`direct door: ${watchUrl}`);
    const consumed = await consumeDirectFrames(watchUrl, 30_000);
    log(`direct watch: init=${consumed.initBytes}b fragments=${consumed.fragments}`);
    record({ target: "observe", action: "directWatch", ok: true });
  } catch (cause) {
    record({
      target: "observe",
      action: "directWatch",
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause)
    });
    throw cause;
  } finally {
    // Best-effort stop either way so the producer never outlives the drive.
    const stop = await client.call("observe", "stop", {}, family("run", "stop"));
    record({ target: "observe", action: "stop", ok: stop.ok, error: stop.error });
  }
};

export const runRemoteDrive = async (input: RemoteDriveInput): Promise<RemoteDriveResult> => {
  const log = input.log ?? ((line: string) => process.stderr.write(`[remote drive] ${line}\n`));
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

    if (input.directVideoPath !== undefined) {
      if (observed.obsId === undefined) {
        throw new Error("direct video leg needs the observation this drive created");
      }
      await runDirectVideoLeg(
        client,
        {
          marketId,
          obsId: observed.obsId,
          videoPath: input.directVideoPath,
          ...(input.directPort === undefined ? {} : { port: input.directPort }),
          hostBaseUrl
        },
        record,
        log
      );
    }

    if (input.observeOnly === true) {
      return { marketId, steps };
    }

    // Bookmaker: seed a vault on the fresh market; the result's tokenId IS the vaultId.
    const bmConfigure = await client.call("bookmaker", "configure", { marketId });
    record({ target: "bookmaker", action: "configure", ok: bmConfigure.ok, error: bmConfigure.error });
    if (!bmConfigure.ok) {
      throw new Error(bmConfigure.error ?? "bookmaker configure failed");
    }

    const createVault = await client.call("bookmaker", "createVault", {
      marketId,
      question: `Will ${input.observeTitle ?? "the stream"} deliver?`,
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

    return { marketId, steps };
  } finally {
    stewardClient?.close();
    client.close();
  }
};
