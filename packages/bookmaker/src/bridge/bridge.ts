// --- exports ---

import { LiveStreakConfigError } from "@livestreak/core";

import type { CreateVaultActionResult } from "./types.js";
import type { CreateVaultIntent } from "../model/write-intent.js";
import { validateCreateVaultIntent } from "../model/validate.js";
import { authorizeBridgeCaller } from "./scope.js";
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
  BookmakerBridge,
  BridgeCaller,
  CallActionEnvelope,
  CapabilityGrant,
  CapabilityScope,
  CreateBookmakerBridgeInput
} from "./types.js";

export {
  bridgeActionScope,
  bridgeBoardReadScope,
  bridgeBoardSubscribeScope,
  bridgeControlsReadScope
} from "./types.js";

export { authorizeBridgeCaller, requireAnyScope } from "./scope.js";

export const createBookmakerBridge = (input: CreateBookmakerBridgeInput): BookmakerBridge => {
  const { runtime } = input;

  return {
    runtime,

    readBoard: async (caller, nowMs) => {
      authorizeBridgeCaller(caller, bridgeBoardReadScope, nowMs);
      return runtime.readPanel();
    },

    readControls: async (caller, nowMs) => {
      authorizeBridgeCaller(caller, bridgeControlsReadScope, nowMs);
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

    callAction: async (caller, envelope, nowMs) => {
      authorizeBridgeCaller(caller, bridgeActionScope, nowMs);

      if (envelope.scope !== bridgeActionScope) {
        throw new LiveStreakConfigError({
          message: "Bookmaker bridge callAction requires bridge:action scope",
          metadata: { details: envelope.scope }
        });
      }

      return dispatchWriterAction(runtime, envelope.action, envelope.args, nowMs);
    },

    subscribeBoard: (caller, listener, nowMs) => {
      authorizeBridgeCaller(caller, bridgeBoardSubscribeScope, nowMs);
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
): Promise<CreateVaultActionResult> => {
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
  // P1: return the vaultId the runtime already produced (previously dropped).
  return { txId: result.result.txId, vaultId: result.result.vaultId };
};

const parseCreateVaultIntentFromArgs = (args: Record<string, unknown>, nowMs: number): CreateVaultIntent => {
  const validated = validateCreateVaultIntent(
    {
      action: "createVault",
      marketId: args.marketId,
      question: args.question,
      creatorSide: args.creatorSide,
      creatorStake: args.creatorStake,
      seedRate: args.seedRate,
      resolutionSource: args.resolutionSource,
      resolutionWindowExpiresAtMs: args.resolutionWindowExpiresAtMs
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
