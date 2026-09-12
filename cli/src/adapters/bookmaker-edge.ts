import {
  bridgeActionScope,
  createBookmakerBridge,
  createBookmakerRuntime,
  createBookmakerRuntimeBootstrap,
  projectBookmakerDescriptors,
  type BridgeCaller,
  type CallActionEnvelope
} from "@livestreak/bookmaker";
import type { FunctionDescriptor, PackageRuntimeInit } from "@livestreak/schema";
import { localOperatorCaller } from "../gateway/auth/caller.js";
import type { ConsoleEdge } from "../gateway/console/edge.js";

export interface CreateBookmakerEdgeInput {
  readonly packageInit: PackageRuntimeInit;
  readonly readRpcUrl: string;
  readonly userAddress: string;
  readonly usdcAddress: `0x${string}`;
}

// The bookmaker runtime REQUIRES a non-empty marketId, so we seed this sentinel just to construct it.
// describeFunctions treats the sentinel as "no market" so createVault stays hidden until a real
// `configure` sets one (board-first reveal, like observe register).
const PLACEHOLDER_MARKET = `0x${"00".repeat(31)}01` as const;
const nowMs = (): number => Date.now();

const DAY_MS = 86_400_000;

// createVault requires resolutionSource (non-empty string) + resolutionWindowExpiresAtMs (finite number > 0).
// The auto-form sends strings (and the window is optional), so default + coerce here: blank source → "manual",
// blank/invalid window → now + 24h, string window → number. Without this the bridge rejects every createVault.
const coerceCreateVaultArgs = (args: unknown): unknown => {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return args;
  }
  const record = args as Record<string, unknown>;
  const source =
    typeof record.resolutionSource === "string" && record.resolutionSource.trim().length > 0
      ? record.resolutionSource.trim()
      : "manual";
  const raw = record.resolutionWindowExpiresAtMs;
  const asNumber =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim().length > 0
        ? Number(raw)
        : Number.NaN;
  const expiresAt = Number.isFinite(asNumber) && asNumber > 0 ? asNumber : nowMs() + DAY_MS;
  return { ...record, resolutionSource: source, resolutionWindowExpiresAtMs: expiresAt };
};

const readConfigure = (args: unknown): { marketId: string } => {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return { marketId: "" };
  }
  const record = args as Record<string, unknown>;
  return {
    marketId:
      typeof record.marketId === "string" && record.marketId.trim().length > 0
        ? record.marketId.trim()
        : ""
  };
};

export const createBookmakerEdge = (input: CreateBookmakerEdgeInput): ConsoleEdge => {
  const observeRunId = input.packageInit.runId ?? "remote";
  const caller = localOperatorCaller();

  let marketId: string = PLACEHOLDER_MARKET;
  const buildBridge = () =>
    createBookmakerBridge({
      runtime: createBookmakerRuntime({
        config: createBookmakerRuntimeBootstrap(input.packageInit, {
          runtimeId: "cli-bookmaker-remote",
          readRpcUrl: input.readRpcUrl,
          marketId,
          observeRunId,
          watchSource: {
            marketId,
            watchUrl: "http://127.0.0.1/remote",
            webrtcUrl: "http://127.0.0.1/remote"
          }
        }).runtimeConfig
      })
    });

  let bridge = buildBridge();
  const boardListeners = new Set<(board: unknown) => void>();
  let boardUnsub: (() => void) | undefined;

  const resubscribeBoard = (): void => {
    boardUnsub?.();
    boardUnsub = bridge.subscribeBoard(
      caller,
      (panel) => {
        for (const listener of boardListeners) {
          listener(panel);
        }
      },
      nowMs()
    );
  };

  const emitBoard = async (): Promise<void> => {
    const panel = await bridge.readBoard(caller, nowMs());
    for (const listener of boardListeners) {
      listener(panel);
    }
  };

  // Rebuild the bridge over a new market and emit a board so the gateway re-projects the catalog.
  // configure sets a real market (createVault reveals); close resets to the sentinel (createVault
  // hides, board clears) — Close is the exact inverse of Configure.
  const applyMarket = async (next: string): Promise<void> => {
    marketId = next;
    bridge = buildBridge();
    if (boardListeners.size > 0) {
      resubscribeBoard();
    }
    await emitBoard();
  };

  return {
    package: "bookmaker",

    describeFunctions: async (): Promise<readonly FunctionDescriptor[]> => {
      const panel = await bridge.readBoard(caller, nowMs());
      // Sentinel market = "not configured yet" → present an empty marketId so createVault stays hidden.
      const shown =
        marketId === PLACEHOLDER_MARKET ? { ...panel, marketId: "" } : panel;
      return projectBookmakerDescriptors(shown);
    },

    dispatch: async (remoteCaller: BridgeCaller, envelope: CallActionEnvelope) => {
      if (envelope.action === "configure") {
        await applyMarket(readConfigure(envelope.args).marketId || PLACEHOLDER_MARKET);
        const configured = marketId === PLACEHOLDER_MARKET ? "bookmaker" : marketId;
        return { txId: `configured-${configured}` };
      }
      // Close = deconfigure: reset to the sentinel so createVault hides and the board clears.
      if (envelope.action === "close") {
        await applyMarket(PLACEHOLDER_MARKET);
        return { txId: "closed" };
      }
      const args =
        envelope.action === "createVault" ? coerceCreateVaultArgs(envelope.args) : envelope.args;
      const result = await bridge.callAction(
        remoteCaller,
        { scope: bridgeActionScope, action: envelope.action, args },
        nowMs()
      );
      return { txId: String(result.txId), tokenId: String(result.vaultId) };
    },

    subscribeBoard: (listener) => {
      boardListeners.add(listener);
      if (boardUnsub === undefined) {
        resubscribeBoard();
      }
      return () => {
        boardListeners.delete(listener);
      };
    },

    readBoard: () => bridge.readBoard(caller, nowMs())
  };
};
