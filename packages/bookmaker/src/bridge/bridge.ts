// --- exports ---

import { authorizeBridgeCaller, LiveStreakConfigError } from "@livestreak/core";

import type { BookmakerActionResult } from "./types.js";
import type { CreateVaultIntent } from "../model/write-intent.js";
import { asTxId } from "../chains/types.js";
import { validateCreateVaultIntent } from "../model/validate.js";
import type {
  BookmakerBridge,
  CreateBookmakerBridgeInput
} from "./types.js";
import {
  bridgeActionScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  bridgeControlsReadScope
} from "./types.js";

export type {
  BookmakerActionResult,
  BookmakerBridge,
  BridgeCaller,
  CallActionEnvelope,
  CapabilityGrant,
  CapabilityScope,
  CreateBookmakerBridgeInput,
  CreateVaultActionResult
} from "./types.js";

export {
  bridgeActionScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  bridgeControlsReadScope
} from "./types.js";

export { authorizeBridgeCaller, requireAnyScope } from "./scope.js";

const DAY_MS = 86_400_000;

export const createBookmakerBridge = (input: CreateBookmakerBridgeInput): BookmakerBridge => {
  const { runtime, now } = input;

  return {
    runtime,

    readBoard: async (caller) => {
      authorizeBridgeCaller(caller, bridgeBoardReadScope, now());
      return runtime.readPanel();
    },

    readControls: async (caller) => {
      authorizeBridgeCaller(caller, bridgeControlsReadScope, now());
      const panel = runtime.readPanel();
      return {
        runtimeId: panel.runtimeId,
        marketContext: panel.marketContext,
        ...(panel.watchSource === undefined ? {} : { watchSource: panel.watchSource }),
        ...(panel.latestDetection === undefined ? {} : { latestDetection: panel.latestDetection }),
        ...(panel.currentDraft === undefined ? {} : { currentDraft: panel.currentDraft }),
        ...(panel.lastDecision === undefined ? {} : { lastDecision: panel.lastDecision }),
        pendingWriteIntents: panel.writeIntents,
        completedVaultCreations: panel.completedVaultCreations,
        ...(panel.lastError === undefined ? {} : { lastError: panel.lastError }),
        updatedAtMs: panel.updatedAtMs
      };
    },

    callAction: async (caller, envelope) => {
      authorizeBridgeCaller(caller, bridgeActionScope, now());

      if (envelope.scope !== bridgeActionScope) {
        throw new LiveStreakConfigError({
          message: "Bookmaker bridge callAction requires bridge:action scope",
          metadata: { details: envelope.scope }
        });
      }

      return dispatchWriterAction(runtime, envelope.action, envelope.args, now());
    },

    subscribeBoard: (caller, listener) => {
      authorizeBridgeCaller(caller, bridgeBoardSubscribeScope, now());
      return runtime.subscribeSnapshots(() => {
        listener(runtime.readPanel());
      });
    }
  };
};

// --- helpers ---

const dispatchWriterAction = async (
  runtime: CreateBookmakerBridgeInput["runtime"],
  action: string,
  args: unknown,
  nowMs: number
): Promise<BookmakerActionResult> => {
  if (action === "configure") {
    const marketId = readConfigureMarketId(args);
    runtime.configure({ marketId });
    return { txId: asTxId(`configured-${marketId === "" ? "bookmaker" : marketId}`) };
  }
  if (action === "close") {
    runtime.close();
    return { txId: asTxId("closed") };
  }

  if (action !== "createVault") {
    throw new LiveStreakConfigError({
      message: `Unsupported bookmaker bridge action: ${action}`,
      metadata: { details: action }
    });
  }

  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new LiveStreakConfigError({
      message: "createVault bridge action requires object args",
      metadata: { details: String(args) }
    });
  }

  const intent = parseCreateVaultIntentFromArgs(args as Record<string, unknown>, nowMs);
  const result = await runtime.createVaultOnce(intent, nowMs);
  return { txId: result.result.txId, vaultId: result.result.vaultId };
};

const readConfigureMarketId = (args: unknown): string => {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return "";
  }
  const marketId = (args as Record<string, unknown>).marketId;
  return typeof marketId === "string" ? marketId.trim() : "";
};

// A non-coercible field is DROPPED (undefined) so the intent validator reports it as missing —
// bookmaker's validation flow, distinct from options' throw-at-the-walker.
const coerceBigIntArg = (value: unknown): bigint | undefined => {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    try {
      return BigInt(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
};

const parseCreateVaultIntentFromArgs = (args: Record<string, unknown>, nowMs: number): CreateVaultIntent => {
  const creatorStake = coerceBigIntArg(args.creatorStake);
  const seedRate = coerceBigIntArg(args.seedRate);

  // Console auto-form defaults: blank resolution source → "manual"; blank/invalid window → +24h.
  const source =
    typeof args.resolutionSource === "string" && args.resolutionSource.trim().length > 0
      ? args.resolutionSource.trim()
      : "manual";
  const rawWindow = args.resolutionWindowExpiresAtMs;
  const windowNumber =
    typeof rawWindow === "number"
      ? rawWindow
      : typeof rawWindow === "string" && rawWindow.trim().length > 0
        ? Number(rawWindow)
        : Number.NaN;
  const expiresAt = Number.isFinite(windowNumber) && windowNumber > 0 ? windowNumber : nowMs + DAY_MS;

  const validated = validateCreateVaultIntent(
    {
      action: "createVault",
      marketId: args.marketId,
      question: args.question,
      creatorSide: args.creatorSide,
      ...(creatorStake === undefined ? {} : { creatorStake }),
      ...(seedRate === undefined ? {} : { seedRate }),
      resolutionSource: source,
      resolutionWindowExpiresAtMs: expiresAt
    },
    nowMs
  );

  if (validated.ok === false) {
    throw new LiveStreakConfigError({
      message: validated.issues.join("; "),
      metadata: { details: JSON.stringify(validated.issues) }
    });
  }

  return validated.value;
};
