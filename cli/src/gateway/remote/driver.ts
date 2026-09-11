import { defaultFileExportConfigure } from "@livestreak/observe";
import { defaultSettingsPath, ensureSettings } from "../../prefs/settings.js";
import { createRemoteUiClient, type RemoteDriveTarget, type RemoteUiClient } from "./ui-client.js";

export interface RemoteDriveInput {
  readonly sessionId: string;
  readonly pairingPassword: string;
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

  const steps: RemoteDriveStep[] = [];
  const record = (step: RemoteDriveStep): void => {
    steps.push(step);
  };

  try {
    await client.connect();

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

    const fund = await client.call("options", "fund", {
      deposit: input.fundDeposit ?? "1000000"
    });
    record({ target: "options", action: "fund", ok: fund.ok, error: fund.error });
    if (!fund.ok) {
      throw new Error(fund.error ?? "fund failed");
    }

    const resolve = await client.call("steward", "resolve", {
      outcome: input.resolveOutcome ?? "yes"
    });
    record({ target: "steward", action: "resolve", ok: resolve.ok, error: resolve.error });
    if (!resolve.ok) {
      throw new Error(resolve.error ?? "steward resolve failed");
    }

    const withdraw = await client.call("options", "withdraw", {});
    record({ target: "options", action: "withdraw", ok: withdraw.ok, error: withdraw.error });
    if (!withdraw.ok) {
      throw new Error(withdraw.error ?? "withdraw failed");
    }

    return { marketId, steps };
  } finally {
    client.close();
  }
};
