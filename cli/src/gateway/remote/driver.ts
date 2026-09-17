import { defaultFileExportConfigure } from "@livestreak/observe";
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

export const readMarketIdFromBoard = (board: unknown): string | undefined => {
  if (board === null || typeof board !== "object") {
    return undefined;
  }
  const cells = (board as { cells?: Record<string, unknown> }).cells;
  const market = cells?.market;
  if (market === null || typeof market !== "object") {
    return undefined;
  }
  const readonly = (market as { readonly?: Record<string, unknown> }).readonly;
  const marketId = readonly?.marketId;
  return typeof marketId === "string" && marketId.length > 0 ? marketId : undefined;
};

const runObserveLeg = async (
  client: RemoteUiClient,
  chain: string,
  title: string,
  record: (step: RemoteDriveStep) => void
): Promise<string> => {
  const configureResult = await client.call(
    "observe",
    "configure",
    defaultFileExportConfigure({ chain })
  );
  record({ target: "observe", action: "configure", ok: configureResult.ok, error: configureResult.error });
  if (!configureResult.ok) {
    throw new Error(configureResult.error ?? "observe configure failed");
  }

  const registerResult = await client.call("observe", "register", { title });
  record({ target: "observe", action: "register", ok: registerResult.ok, error: registerResult.error });
  if (!registerResult.ok) {
    throw new Error(registerResult.error ?? "observe register failed");
  }

  const marketId = readMarketIdFromBoard(client.boards().observe);
  if (marketId === undefined) {
    throw new Error("marketId not found on observe board after register");
  }
  return marketId;
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

    const marketId =
      input.marketId ??
      (await runObserveLeg(
        client,
        settings.defaultChain,
        input.observeTitle ?? `remote-drive-${input.sessionId}`,
        record
      ));
    log(`marketId: ${marketId}`);

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
